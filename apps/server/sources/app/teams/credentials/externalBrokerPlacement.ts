import { TeamCredentialSourceBindingV1Schema, type TeamCredentialSourceBindingV1 } from "@happier-dev/protocol/teams";

import type { MachineDaemonPresenceInventory } from "@/app/machines/machineDaemonPresence";
import { inTx, type Tx } from "@/storage/inTx";
import { resolveCurrentTeamCredentialExternalApiKeyAuthorityInTx } from "./externalApiKey";
import { resolveTeamCredentialBrokerPlacementInTx } from "./brokerPlacementResolver";
import { resolveTeamCredentialResourceSourceInTx } from "./resourceSourceResolver";

type PoolSourceEligibilityReader = (input: Readonly<{
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

async function readCurrentAuthorityAndSource(
    tx: Tx,
    keyId: string,
    observedAt: Date,
): Promise<Readonly<{ authority: CurrentKeyAuthority; source: TeamCredentialSourceBindingV1 }> | null> {
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

/**
 * Resolves one external request to an exact broker Machine through the one
 * placement owner: an exact placement is revalidated for eligibility and
 * presence, a Pool placement is ranked once per external key so a retried or
 * lost-response request lands on the same member while membership and
 * presence are unchanged. The selected Machine is request-local only: it is
 * not persisted or exposed outside the server-to-broker carrier.
 */
export async function resolveTeamCredentialExternalBrokerPlacement(input: Readonly<{
    externalApiKeyId: string;
    observedAt: Date;
    signal: AbortSignal;
    readCurrentPresence: (custodianAccountId: string) => Promise<MachineDaemonPresenceInventory>;
    readPoolSourceEligibility: PoolSourceEligibilityReader;
}>): Promise<ExternalBrokerPlacementResult> {
    const initial = await inTx((tx) => readCurrentAuthorityAndSource(tx, input.externalApiKeyId, input.observedAt));
    if (!initial) return { ok: false, error: "resource_unavailable" };
    if (input.signal.aborted) return { ok: false, error: "broker_unavailable" };

    let initialPresence: MachineDaemonPresenceInventory;
    try {
        initialPresence = await input.readCurrentPresence(initial.authority.custodianAccountId);
    } catch {
        return { ok: false, error: "broker_unavailable" };
    }
    const requestKey = [
        initial.authority.resourceId,
        "external_api_key",
        input.externalApiKeyId,
    ].join("\u0000");
    const candidates = await inTx((tx) => resolveTeamCredentialBrokerPlacementInTx(tx, {
        resource: {
            id: initial.authority.resourceId,
            custodianAccountId: initial.authority.custodianAccountId,
            brokerMachineId: initial.authority.brokerMachineId,
            brokerPoolId: initial.authority.brokerPoolId,
        },
        presence: initialPresence,
        requestKey,
    }));
    if (!candidates.ok) {
        return { ok: false, error: candidates.error === "resource_unavailable" ? "resource_unavailable" : "broker_unavailable" };
    }
    if (candidates.broker !== null) {
        return {
            ok: true,
            custodianAccountId: initial.authority.custodianAccountId,
            brokerMachineId: candidates.broker.machineId,
        };
    }
    if (candidates.poolSnapshot === null || candidates.candidateMachineIds.length === 0) {
        return { ok: false, error: "broker_unavailable" };
    }

    let eligibility: Awaited<ReturnType<PoolSourceEligibilityReader>>;
    try {
        eligibility = await input.readPoolSourceEligibility({
            custodianAccountId: initial.authority.custodianAccountId,
            machineIds: candidates.candidateMachineIds,
            teamId: initial.authority.teamId,
            resourceId: initial.authority.resourceId,
            resourceRevision: initial.authority.resourceRevision,
            source: initial.source,
            signal: input.signal,
        });
    } catch {
        return { ok: false, error: "broker_unavailable" };
    }
    if (input.signal.aborted) return { ok: false, error: "broker_unavailable" };

    const selected = await inTx((tx) => resolveTeamCredentialBrokerPlacementInTx(tx, {
        resource: {
            id: initial.authority.resourceId,
            custodianAccountId: initial.authority.custodianAccountId,
            brokerMachineId: initial.authority.brokerMachineId,
            brokerPoolId: initial.authority.brokerPoolId,
        },
        presence: initialPresence,
        requestKey,
        poolEligibleMachineIds: eligibility.eligibleMachineIds,
    }));
    if (!selected.ok || selected.broker === null) return { ok: false, error: "broker_unavailable" };

    let currentPresence: MachineDaemonPresenceInventory;
    try {
        currentPresence = await input.readCurrentPresence(initial.authority.custodianAccountId);
    } catch {
        return { ok: false, error: "broker_unavailable" };
    }
    const current = await inTx(async (tx) => {
        const authority = await readCurrentAuthorityAndSource(tx, input.externalApiKeyId, new Date());
        if (!authority || !unchangedAuthority(initial.authority, authority.authority)) return null;
        const placement = await resolveTeamCredentialBrokerPlacementInTx(tx, {
            resource: {
                id: authority.authority.resourceId,
                custodianAccountId: authority.authority.custodianAccountId,
                brokerMachineId: authority.authority.brokerMachineId,
                brokerPoolId: authority.authority.brokerPoolId,
            },
            presence: currentPresence,
            requestKey,
            poolEligibleMachineIds: eligibility.eligibleMachineIds,
            expectedPoolMachineId: selected.broker!.machineId,
        });
        return placement.ok ? placement.broker : null;
    });
    return current
        ? {
            ok: true,
            custodianAccountId: initial.authority.custodianAccountId,
            brokerMachineId: current.machineId,
        }
        : { ok: false, error: "broker_unavailable" };
}
