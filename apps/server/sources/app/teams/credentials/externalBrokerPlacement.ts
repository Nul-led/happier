import { TeamCredentialSourceBindingV1Schema, type TeamCredentialSourceBindingV1 } from "@happier-dev/protocol/teams";

import type { MachineDaemonPresenceInventory } from "@/app/machines/machineDaemonPresence";
import { inTx, type Tx } from "@/storage/inTx";
import { resolveCurrentTeamCredentialExternalApiKeyAuthorityInTx } from "./externalApiKey";
import {
    resolveTeamCredentialBrokerPlacementInTx,
    type TeamCredentialBrokerPlacementResource,
} from "./brokerPlacementResolver";
import { resolveTeamCredentialResourceSourceInTx } from "./resourceSourceResolver";

/** The external-key question put to the canonical Pool source-eligibility reader. */
export type ExternalBrokerPoolSourceEligibilityReader = (input: Readonly<{
    custodianAccountId: string;
    machineIds: readonly string[];
    teamId: string;
    resourceId: string;
    resourceRevision: number;
    source: TeamCredentialSourceBindingV1;
    signal: AbortSignal;
}>) => Promise<Readonly<{ eligibleMachineIds: ReadonlySet<string> }>>;

type CurrentKeyAuthority = Extract<
    Awaited<ReturnType<typeof resolveCurrentTeamCredentialExternalApiKeyAuthorityInTx>>,
    { ok: true }
>;

type CurrentKeyAuthorityAndSource = Readonly<{
    authority: CurrentKeyAuthority;
    source: TeamCredentialSourceBindingV1;
}>;

export type ExternalBrokerPlacementResult =
    | Readonly<{ ok: true; custodianAccountId: string; brokerMachineId: string }>
    | Readonly<{ ok: false; error: "broker_unavailable" | "resource_unavailable" }>;

function unchangedAuthority(left: CurrentKeyAuthority, right: CurrentKeyAuthority): boolean {
    return left.keyId === right.keyId
        && left.resourceId === right.resourceId
        && left.teamId === right.teamId
        && left.custodianAccountId === right.custodianAccountId
        && left.brokerMachineId === right.brokerMachineId
        && left.brokerPoolId === right.brokerPoolId
        && left.resourceRevision === right.resourceRevision
        && left.sourceBindingJson === right.sourceBindingJson;
}

/**
 * The broker Machine this key's per-key operation was established on.
 *
 * L10/05:123 establishes one SVC09 operation per external key "on first
 * admitted inference", and the Home admission owner commits exactly that fact:
 * the immutable admission UsageEvent names the broker Machine that admitted
 * it. Reading the latest one is how the stateless public edge finds the exact
 * target of the key's open without a placement table or registry. Only a Pool
 * placement needs it; an exact placement names its one Machine.
 */
async function readEstablishedBrokerMachineIdInTx(tx: Tx, authority: CurrentKeyAuthority): Promise<string | null> {
    if (authority.brokerPoolId === null) return null;
    const admission = await tx.usageEvent.findFirst({
        where: {
            teamCredentialExternalApiKeyId: authority.keyId,
            teamCredentialResourceId: authority.resourceId,
            source: "team_credential_admission",
            requestCount: 1,
            brokerMachineId: { not: null },
        },
        orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
        select: { brokerMachineId: true },
    });
    return admission?.brokerMachineId ?? null;
}

async function readCurrentAuthorityAndSourceInTx(
    tx: Tx,
    keyId: string,
    observedAt: Date,
): Promise<CurrentKeyAuthorityAndSource | null> {
    const authority = await resolveCurrentTeamCredentialExternalApiKeyAuthorityInTx(
        tx,
        { kind: "admitted_key", keyId },
        observedAt,
    );
    if (!authority.ok) return null;
    let rawSource: unknown;
    try {
        rawSource = JSON.parse(authority.sourceBindingJson);
    } catch {
        return null;
    }
    const source = TeamCredentialSourceBindingV1Schema.safeParse(rawSource);
    if (!source.success) return null;
    const current = await resolveTeamCredentialResourceSourceInTx(tx, {
        custodianAccountId: authority.custodianAccountId,
        source: source.data,
    });
    return current.status === "current" ? { authority, source: source.data } : null;
}

function placementResource(authority: CurrentKeyAuthority): TeamCredentialBrokerPlacementResource {
    return {
        id: authority.resourceId,
        custodianAccountId: authority.custodianAccountId,
        brokerMachineId: authority.brokerMachineId,
        brokerPoolId: authority.brokerPoolId,
    };
}

/**
 * Resolves one external request to the exact broker Machine of its key's
 * operation through the one placement owner.
 *
 * - Exact placement: that Machine, revalidated for eligibility and presence.
 * - Pool placement with an established operation: the Machine it was
 *   established on, while that Machine is present, an eligible custodian
 *   broker and can still run the source. Tier reordering, disabling and
 *   removing members affect future opens only (L11/03:147 step 7), so the
 *   current member list is never reranked for it.
 * - Otherwise a new open: the Pool is ranked once under the key's stable
 *   request key and the chosen member rechecked before dispatch; a member that
 *   changes between ranking and the recheck fails this open rather than
 *   rotating (L10/05:194, B11-05).
 *
 * The selected Machine is request-local: it is not persisted or exposed
 * outside the server-to-broker carrier; the admission of the dispatched
 * request is what commits it as the operation's target.
 */
export async function resolveTeamCredentialExternalBrokerPlacement(input: Readonly<{
    externalApiKeyId: string;
    observedAt: Date;
    signal: AbortSignal;
    readCurrentPresence: (custodianAccountId: string) => Promise<MachineDaemonPresenceInventory>;
    readPoolSourceEligibility: ExternalBrokerPoolSourceEligibilityReader;
}>): Promise<ExternalBrokerPlacementResult> {
    const initial = await inTx(async (tx) => {
        const current = await readCurrentAuthorityAndSourceInTx(tx, input.externalApiKeyId, input.observedAt);
        return current
            ? { ...current, establishedMachineId: await readEstablishedBrokerMachineIdInTx(tx, current.authority) }
            : null;
    });
    if (!initial) return { ok: false, error: "resource_unavailable" };
    if (input.signal.aborted) return { ok: false, error: "broker_unavailable" };
    const { authority } = initial;
    const resource = placementResource(authority);

    let initialPresence: MachineDaemonPresenceInventory;
    try {
        initialPresence = await input.readCurrentPresence(authority.custodianAccountId);
    } catch {
        return { ok: false, error: "broker_unavailable" };
    }
    const requestKey = [
        authority.resourceId,
        "external_api_key",
        input.externalApiKeyId,
    ].join("\u0000");
    const readEligibility = async (machineIds: readonly string[]) => {
        try {
            const eligibility = await input.readPoolSourceEligibility({
                custodianAccountId: authority.custodianAccountId,
                machineIds,
                teamId: authority.teamId,
                resourceId: authority.resourceId,
                resourceRevision: authority.resourceRevision,
                source: initial.source,
                signal: input.signal,
            });
            return input.signal.aborted ? null : eligibility.eligibleMachineIds;
        } catch {
            return null;
        }
    };
    /** Rereads key authority and presence and revalidates the one target immediately before dispatch. */
    const confirm = async (
        target: Readonly<{ pinnedMachineId: string } | { poolEligibleMachineIds: ReadonlySet<string>; expectedPoolMachineId: string }>,
    ): Promise<ExternalBrokerPlacementResult> => {
        let currentPresence: MachineDaemonPresenceInventory;
        try {
            currentPresence = await input.readCurrentPresence(authority.custodianAccountId);
        } catch {
            return { ok: false, error: "broker_unavailable" };
        }
        const current = await inTx(async (tx) => {
            const reread = await readCurrentAuthorityAndSourceInTx(tx, input.externalApiKeyId, new Date());
            if (!reread || !unchangedAuthority(authority, reread.authority)) return null;
            const placement = await resolveTeamCredentialBrokerPlacementInTx(tx, {
                resource: placementResource(reread.authority),
                presence: currentPresence,
                requestKey,
                ...target,
            });
            return placement.ok ? placement.broker : null;
        });
        return current
            ? { ok: true, custodianAccountId: authority.custodianAccountId, brokerMachineId: current.machineId }
            : { ok: false, error: "broker_unavailable" };
    };

    if (initial.establishedMachineId !== null) {
        const established = await inTx((tx) => resolveTeamCredentialBrokerPlacementInTx(tx, {
            resource,
            presence: initialPresence,
            requestKey,
            pinnedMachineId: initial.establishedMachineId,
        }));
        if (established.ok && established.broker !== null) {
            const eligible = await readEligibility([established.broker.machineId]);
            if (input.signal.aborted) return { ok: false, error: "broker_unavailable" };
            if (eligible?.has(established.broker.machineId)) {
                return await confirm({ pinnedMachineId: established.broker.machineId });
            }
        }
        // An established Machine that is gone, no longer an eligible broker or
        // can no longer run the source ended that operation; this request is a
        // new open over the current members. Nothing is replayed.
    }

    const candidates = await inTx((tx) => resolveTeamCredentialBrokerPlacementInTx(tx, {
        resource,
        presence: initialPresence,
        requestKey,
    }));
    if (!candidates.ok) {
        return { ok: false, error: candidates.error === "resource_unavailable" ? "resource_unavailable" : "broker_unavailable" };
    }
    if (candidates.broker !== null) {
        return {
            ok: true,
            custodianAccountId: authority.custodianAccountId,
            brokerMachineId: candidates.broker.machineId,
        };
    }
    if (candidates.poolSnapshot === null || candidates.candidateMachineIds.length === 0) {
        return { ok: false, error: "broker_unavailable" };
    }
    const eligibleMachineIds = await readEligibility(candidates.candidateMachineIds);
    if (eligibleMachineIds === null) return { ok: false, error: "broker_unavailable" };
    const selected = await inTx((tx) => resolveTeamCredentialBrokerPlacementInTx(tx, {
        resource,
        presence: initialPresence,
        requestKey,
        poolEligibleMachineIds: eligibleMachineIds,
    }));
    if (!selected.ok || selected.broker === null) return { ok: false, error: "broker_unavailable" };
    return await confirm({
        poolEligibleMachineIds: eligibleMachineIds,
        expectedPoolMachineId: selected.broker.machineId,
    });
}
