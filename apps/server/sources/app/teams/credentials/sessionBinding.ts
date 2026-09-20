import {
    SessionTeamCredentialBindingIntentsV1Schema,
    encodeSessionTeamCredentialSlotKeyV1,
    type SessionTeamCredentialBindingIntentListV1,
    type SessionTeamCredentialBindingRejectionV1,
    type SessionTeamCredentialSlotV1,
    type TeamCredentialRouteV1,
} from "@happier-dev/protocol/teams";
import type { SessionTeamCredentialBindingConsequenceV1 } from "@happier-dev/protocol";
import type { Tx } from "@/storage/inTx";
import { isServerFeatureEnabledForRequest } from "@/app/features/catalog/serverFeatureGate";
import { assertSessionTeamReadableGrantInTx } from "@/app/session/access/sessionAccess";
import { putSessionAccessGrantInTx } from "@/app/session/access/sessionAccessGrantService";
import {
    qualifySessionTeamAuthenticationInTx,
    type SessionAccessAuthentication,
} from "@/app/session/access/sessionAccessAuthentication";
import { resolveTeamCredentialBrokerMachineForSaveInTx } from "./brokerMachineEligibility";
import {
    readTeamCredentialBrokerPlacement,
    admitTeamCredentialBrokerPoolForBrokeredUseInTx,
    isTeamCredentialBrokerPlacementBoundToMachineInTx,
} from "./brokerPlacementResolver";
import { resolveTeamCredentialEntitlementInTx, type TeamCredentialEntitlementDecision } from "./resourceAccess";
import { resolveTeamCredentialResourceSourceInTx, type TeamCredentialResourceSourceResolution } from "./resourceSourceResolver";

export type SessionTeamCredentialBindingRejection =
    SessionTeamCredentialBindingRejectionV1;

export type SessionTeamCredentialBindingWriteResult =
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; reason: SessionTeamCredentialBindingRejection }>;

function key(slot: SessionTeamCredentialSlotV1): Uint8Array {
    return encodeSessionTeamCredentialSlotKeyV1(slot);
}

function persistedSlotKind(slot: SessionTeamCredentialSlotV1, deliveryMode: TeamCredentialRouteV1): string {
    return `${slot.kind}:${deliveryMode}`;
}

/** Persist accepted Session selection intent in the same transaction as its owner. */
export async function writeSessionTeamCredentialBindingsInTx(
    tx: Tx,
    input: Readonly<{
        sessionId: string;
        accountId: string;
        intents: unknown;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialBindingWriteResult> {
    const parsed = SessionTeamCredentialBindingIntentsV1Schema.safeParse(input.intents);
    if (!parsed.success || !input.sessionId) return { ok: false, reason: "invalid_input" };
    return writeParsedSessionTeamCredentialBindingsInTx(tx, {
        sessionId: input.sessionId,
        accountId: input.accountId,
        intents: parsed.data,
        authentication: input.authentication,
    });
}

export async function writeParsedSessionTeamCredentialBindingsInTx(
    tx: Tx,
    input: Readonly<{
        sessionId: string;
        accountId: string;
        intents: SessionTeamCredentialBindingIntentListV1;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialBindingWriteResult> {
    if (!isServerFeatureEnabledForRequest("teams.credentialResources", process.env)) {
        return { ok: false, reason: "feature_disabled" };
    }
    const owner = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: { accountId: true },
    });
    if (!owner) return { ok: false, reason: "session_missing" };
    if (owner.accountId !== input.accountId) return { ok: false, reason: "session_owner_mismatch" };
    // Validate the complete batch before mutating any row. Callers may use a
    // successful transaction for other Session state, so a rejected binding
    // batch must never leave a partially-applied witness behind.
    for (const intent of input.intents) {
        if (intent.resourceId === null) continue;
        const resolved = await validateExistingSessionTeamCredentialResourceInTx(tx, {
            sessionId: input.sessionId,
            accountId: input.accountId,
            resourceId: intent.resourceId,
            expectedResourceRevision: intent.expectedResourceRevision,
            deliveryMode: intent.deliveryMode,
            authentication: input.authentication,
        });
        const admitted = validateResolvedSessionTeamCredentialBindingIntent(resolved, intent);
        if (!admitted.ok) return admitted;
    }
    for (const intent of input.intents) {
        const slotKey = Buffer.from(key(intent.slot));
        if (intent.resourceId === null) {
            await tx.sessionTeamCredentialBinding.deleteMany({
                where: { sessionId: input.sessionId, slotKey },
            });
        } else {
            await tx.sessionTeamCredentialBinding.upsert({
                where: { sessionId_slotKind_slotKey: { sessionId: input.sessionId, slotKind: persistedSlotKind(intent.slot, intent.deliveryMode), slotKey } },
                create: {
                    sessionId: input.sessionId,
                    slotKind: persistedSlotKind(intent.slot, intent.deliveryMode),
                    slotKey,
                    resourceId: intent.resourceId,
                    resourceRevision: intent.expectedResourceRevision,
                },
                update: {
                    resourceId: intent.resourceId,
                    resourceRevision: intent.expectedResourceRevision,
                },
            });
            await tx.sessionTeamCredentialBinding.deleteMany({
                where: {
                    sessionId: input.sessionId,
                    slotKey,
                    slotKind: persistedSlotKind(intent.slot, intent.deliveryMode === "brokered" ? "direct" : "brokered"),
                },
            });
        }
    }
    return { ok: true };
}

export async function readSessionTeamCredentialBindingInTx(
    tx: Tx,
    input: Readonly<{ sessionId: string; slot: SessionTeamCredentialSlotV1; deliveryMode: TeamCredentialRouteV1 }>,
): Promise<Readonly<{ resourceId: string; resourceRevision: number; deliveryMode: TeamCredentialRouteV1 } | null>> {
    const row = await tx.sessionTeamCredentialBinding.findUnique({
        where: { sessionId_slotKind_slotKey: {
            sessionId: input.sessionId, slotKind: persistedSlotKind(input.slot, input.deliveryMode), slotKey: Buffer.from(key(input.slot)),
        } },
        select: { resourceId: true, resourceRevision: true },
    });
    return row ? { ...row, deliveryMode: input.deliveryMode } : null;
}

export async function isSessionTeamCredentialBindingIntentCurrentInTx(
    tx: Tx,
    input: Readonly<{
        sessionId: string;
        intent: SessionTeamCredentialBindingIntentListV1[number];
    }>,
): Promise<boolean> {
    if (input.intent.resourceId === null) {
        const rows = await tx.sessionTeamCredentialBinding.count({
            where: { sessionId: input.sessionId, slotKey: Buffer.from(key(input.intent.slot)) },
        });
        return rows === 0;
    }
    const current = await readSessionTeamCredentialBindingInTx(tx, {
        sessionId: input.sessionId,
        slot: input.intent.slot,
        deliveryMode: input.intent.deliveryMode,
    });
    return current === null
        ? false
        : current?.resourceId === input.intent.resourceId
            && current.resourceRevision === input.intent.expectedResourceRevision;
}

export async function validateSessionTeamCredentialBindingIntentInTx(
    tx: Tx,
    input: Readonly<{
        sessionId: string;
        accountId: string;
        intent: SessionTeamCredentialBindingIntentListV1[number];
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialBindingWriteResult> {
    if (!isServerFeatureEnabledForRequest("teams.credentialResources", process.env)) {
        return { ok: false, reason: "feature_disabled" };
    }
    const session = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: { accountId: true },
    });
    if (!session) return { ok: false, reason: "session_missing" };
    if (session.accountId !== input.accountId) return { ok: false, reason: "session_owner_mismatch" };
    if (input.intent.resourceId === null) return { ok: true };
    const result = await validateExistingSessionTeamCredentialResourceInTx(tx, {
        sessionId: input.sessionId,
        accountId: input.accountId,
        resourceId: input.intent.resourceId,
        expectedResourceRevision: input.intent.expectedResourceRevision,
        deliveryMode: input.intent.deliveryMode,
        authentication: input.authentication,
    });
    return validateResolvedSessionTeamCredentialBindingIntent(result, input.intent);
}

function validateResolvedSessionTeamCredentialBindingIntent(
    result: SessionTeamCredentialResourceValidationResult,
    intent: SessionTeamCredentialBindingIntentListV1[number],
): SessionTeamCredentialBindingWriteResult {
    if (!result.ok) return result;
    if (intent.resourceId !== null && intent.teamId !== undefined && result.binding.teamId !== intent.teamId) {
        return { ok: false, reason: "invalid_input" };
    }
    return { ok: true };
}

/**
 * Composes the Lane 04 access owner with binding admission in one caller-owned
 * transaction. Consent is exact to the selected resource's Team; a mismatch
 * cannot grant access to either Team.
 */
export async function grantRequiredTeamVisibilityAndValidateBindingInTx(
    tx: Tx,
    input: Readonly<{
        sessionId: string;
        accountId: string;
        intent: SessionTeamCredentialBindingIntentListV1[number];
        consentTeamId: string;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialBindingWriteResult> {
    if (input.intent.resourceId === null) return { ok: false, reason: "invalid_input" };
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.intent.resourceId },
        select: { teamId: true, revision: true, sessionUsePolicy: true },
    });
    if (!resource) return { ok: false, reason: "resource_missing" };
    if (resource.revision !== input.intent.expectedResourceRevision) return { ok: false, reason: "resource_changed" };
    if (resource.teamId !== input.consentTeamId || resource.sessionUsePolicy !== "team_visibility_required") {
        return { ok: false, reason: "invalid_input" };
    }
    const grant = await putSessionAccessGrantInTx(tx, {
        actorAccountId: input.accountId,
        sessionId: input.sessionId,
        subject: { kind: "team", teamId: resource.teamId },
        grant: { accessLevel: "edit", canApprovePermissions: false },
        authentication: input.authentication,
    });
    if (!grant.ok) return { ok: false, reason: "access_removed" };
    return await validateSessionTeamCredentialBindingIntentInTx(tx, input);
}

type SessionTeamCredentialResourceValidationResult =
    | Readonly<{ ok: true; binding: Readonly<{ resourceId: string; resourceRevision: number; teamId: string; deliveryMode: TeamCredentialRouteV1 }>; entitlement: Extract<TeamCredentialEntitlementDecision, { ok: true }>; source: Extract<TeamCredentialResourceSourceResolution, { status: "current" }> }>
    | Readonly<{ ok: false; reason: SessionTeamCredentialBindingRejection }>;

export type SessionTeamCredentialAdmissionResult =
    | SessionTeamCredentialResourceValidationResult
    | Readonly<{ ok: false; reason: "binding_missing" }>;

export interface PlannedSessionTeamCredentialContext {
    readonly primaryTeamId: string | null;
    readonly teamVisibilityTeamIds: readonly string[];
}

type SessionTeamCredentialPolicyContext = Readonly<{
    primaryTeamId: string | null;
    isVisibleToTeam: (teamId: string) => Promise<boolean>;
}>;

async function validateSessionTeamCredentialResourceForContextInTx(
    tx: Tx,
    input: Readonly<{
        accountId: string;
        resourceId: string;
        expectedResourceRevision?: number;
        expectedBrokerMachineId?: string;
        deliveryMode: TeamCredentialRouteV1;
        policy: SessionTeamCredentialPolicyContext;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialResourceValidationResult> {
    if (!isServerFeatureEnabledForRequest("teams.credentialResources", process.env)) {
        return { ok: false, reason: "feature_disabled" };
    }
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.resourceId },
        select: {
            id: true, teamId: true, custodianAccountId: true, revision: true,
            sessionUsePolicy: true, sourceBindingJson: true, brokerMachineId: true, brokerPoolId: true,
            team: { select: { authenticationPolicy: true } },
        },
    });
    if (!resource) return { ok: false, reason: "resource_missing" };
    if (input.expectedResourceRevision !== undefined && resource.revision !== input.expectedResourceRevision) {
        return { ok: false, reason: "resource_changed" };
    }
    if (
        input.expectedBrokerMachineId !== undefined
        && !await isTeamCredentialBrokerPlacementBoundToMachineInTx(tx, {
            resource,
            machineId: input.expectedBrokerMachineId,
        })
    ) {
        return { ok: false, reason: "broker_unavailable" };
    }
    const entitlement = await resolveTeamCredentialEntitlementInTx(tx, { resourceId: resource.id, accountId: input.accountId });
    if (!entitlement.ok) return entitlement;
    const qualification = await qualifySessionTeamAuthenticationInTx(tx, {
        accountId: input.accountId,
        team: { id: resource.teamId, authenticationPolicy: resource.team.authenticationPolicy },
        authentication: input.authentication,
    });
    if (qualification.status !== "satisfied") {
        return {
            ok: false,
            reason: qualification.status === "unavailable"
                ? "authentication_unavailable"
                : "authentication_required",
        };
    }
    switch (resource.sessionUsePolicy) {
        case "personal_allowed":
            break;
        case "team_context_required":
            if (input.policy.primaryTeamId !== resource.teamId) {
                return { ok: false, reason: "team_context_required" };
            }
            break;
        case "team_visibility_required":
            if (!await input.policy.isVisibleToTeam(resource.teamId)) {
                return { ok: false, reason: "team_visibility_required" };
            }
            break;
        default:
            return { ok: false, reason: "resource_corrupt" };
    }
    let sourceValue: unknown;
    try {
        sourceValue = JSON.parse(resource.sourceBindingJson);
    } catch {
        return { ok: false, reason: "resource_corrupt" };
    }
    const source = await resolveTeamCredentialResourceSourceInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source: sourceValue,
    });
    if (source.status === "unavailable") {
        return { ok: false, reason: source.reason === "invalid_source_binding" ? "resource_corrupt" : "source_replaced_or_missing" };
    }
    if (input.deliveryMode === "brokered") {
        if (!entitlement.mayBroker) return { ok: false, reason: "access_removed" };
        const placement = readTeamCredentialBrokerPlacement(resource);
        if (!placement.ok || placement.placement === null) return { ok: false, reason: "resource_corrupt" };
        const broker = placement.placement.kind === "machine"
            ? await resolveTeamCredentialBrokerMachineForSaveInTx(tx, resource)
            : await admitTeamCredentialBrokerPoolForBrokeredUseInTx(tx, {
                custodianAccountId: resource.custodianAccountId,
                poolId: placement.placement.poolId,
            });
        if (!broker.ok) return { ok: false, reason: broker.error };
    } else if (!entitlement.mayReceiveDirect) {
        return { ok: false, reason: "access_removed" };
    }
    return { ok: true, binding: { resourceId: resource.id, resourceRevision: resource.revision, teamId: resource.teamId, deliveryMode: input.deliveryMode }, entitlement, source };
}

export async function validatePlannedSessionTeamCredentialResourceInTx(
    tx: Tx,
    input: Readonly<{
        accountId: string;
        resourceId: string;
        expectedResourceRevision: number;
        expectedBrokerMachineId?: string;
        deliveryMode: TeamCredentialRouteV1;
        plannedSession: PlannedSessionTeamCredentialContext;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialResourceValidationResult> {
    const visibleTeamIds = new Set(input.plannedSession.teamVisibilityTeamIds);
    return validateSessionTeamCredentialResourceForContextInTx(tx, {
        accountId: input.accountId,
        resourceId: input.resourceId,
        expectedResourceRevision: input.expectedResourceRevision,
        expectedBrokerMachineId: input.expectedBrokerMachineId,
        deliveryMode: input.deliveryMode,
        authentication: input.authentication,
        policy: {
            primaryTeamId: input.plannedSession.primaryTeamId,
            isVisibleToTeam: async (teamId) => visibleTeamIds.has(teamId),
        },
    });
}

/** Validate a fresh Session's exact resource intent before any Session row is written. */
export async function validatePlannedSessionTeamCredentialBindingIntentInTx(
    tx: Tx,
    input: Readonly<{
        accountId: string;
        intent: SessionTeamCredentialBindingIntentListV1[number];
        plannedSession: PlannedSessionTeamCredentialContext;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialBindingWriteResult> {
    if (input.intent.resourceId === null) return { ok: true };
    const result = await validatePlannedSessionTeamCredentialResourceInTx(tx, {
        accountId: input.accountId,
        resourceId: input.intent.resourceId,
        expectedResourceRevision: input.intent.expectedResourceRevision,
        deliveryMode: input.intent.deliveryMode,
        plannedSession: input.plannedSession,
        authentication: input.authentication,
    });
    return validateResolvedSessionTeamCredentialBindingIntent(result, input.intent);
}

/**
 * Canonical pre-Session producer for the Runner's reviewed credential binding.
 * It reuses the planned Session admission owner and reveals one exact broker
 * Machine: the resource's own placement when it names a Machine, and otherwise
 * the Pool member the placement owner already selected for this activation. No
 * Session or broker lease is created by this bounded read.
 */
export async function resolvePlannedRunnerCredentialSelectionBindingInTx(
    tx: Tx,
    input: Readonly<{
        accountId: string;
        resourceId: string;
        expectedResourceRevision: number;
        plannedSession: PlannedSessionTeamCredentialContext;
        authentication: SessionAccessAuthentication;
        /** Exact persistent Machine already selected for this activation before review. */
        selectedBrokerMachineId?: string;
    }>,
): Promise<
    | Readonly<{ ok: true; binding: Readonly<{ v: 1; resourceId: string; brokerMachineId: string; revision: number }> }>
    | Readonly<{ ok: false; reason: SessionTeamCredentialBindingRejection }>
> {
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.resourceId },
        select: { custodianAccountId: true, brokerMachineId: true, brokerPoolId: true },
    });
    if (!resource) return { ok: false, reason: "resource_missing" };
    const placement = readTeamCredentialBrokerPlacement(resource);
    if (!placement.ok) return { ok: false, reason: "resource_corrupt" };
    if (placement.placement === null) return { ok: false, reason: "broker_unavailable" };
    let brokerMachineId: string;
    if (placement.placement.kind === "machine") {
        brokerMachineId = placement.placement.machineId;
        if (input.selectedBrokerMachineId !== undefined && input.selectedBrokerMachineId !== brokerMachineId) {
            return { ok: false, reason: "broker_unavailable" };
        }
    } else {
        // A Pool placement names no single Machine of its own. The exact member
        // was selected once by the placement owner before review and travels in
        // this activation's binding; here it is revalidated as a current member,
        // never reranked, so membership edits after the freeze cannot move a
        // reviewed activation onto a different Machine.
        if (input.selectedBrokerMachineId === undefined) return { ok: false, reason: "broker_unavailable" };
        if (!await isTeamCredentialBrokerPlacementBoundToMachineInTx(tx, {
            resource,
            machineId: input.selectedBrokerMachineId,
        })) {
            return { ok: false, reason: "broker_unavailable" };
        }
        brokerMachineId = input.selectedBrokerMachineId;
    }
    const admitted = await validatePlannedSessionTeamCredentialResourceInTx(tx, {
        ...input,
        deliveryMode: "brokered",
        expectedBrokerMachineId: brokerMachineId,
    });
    if (!admitted.ok) return admitted;
    return {
        ok: true,
        binding: {
            v: 1,
            resourceId: admitted.binding.resourceId,
            brokerMachineId,
            revision: admitted.binding.resourceRevision,
        },
    };
}

export async function validateExistingSessionTeamCredentialResourceInTx(
    tx: Tx,
    input: Readonly<{
        sessionId: string;
        accountId: string;
        resourceId: string;
        expectedResourceRevision?: number;
        deliveryMode: TeamCredentialRouteV1;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialResourceValidationResult> {
    const session = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: { accountId: true, primaryTeamId: true },
    });
    if (!session) return { ok: false, reason: "session_missing" };
    if (session.accountId !== input.accountId) return { ok: false, reason: "session_owner_mismatch" };
    return validateSessionTeamCredentialResourceForContextInTx(tx, {
        accountId: input.accountId,
        resourceId: input.resourceId,
        expectedResourceRevision: input.expectedResourceRevision,
        authentication: input.authentication,
        deliveryMode: input.deliveryMode,
        policy: {
            primaryTeamId: session.primaryTeamId,
            isVisibleToTeam: async (teamId) => (
                await assertSessionTeamReadableGrantInTx({ tx, sessionId: input.sessionId, teamId })
            ).ok,
        },
    });
}

export type SessionTeamCredentialBindingConsequence = SessionTeamCredentialBindingConsequenceV1;

/** The two session-use policies a Session-level access edit can invalidate. */
const CONDITIONAL_SESSION_USE_POLICIES = ["team_visibility_required", "team_context_required"] as const;

/**
 * Read-only preview for the Session access editor: the credential selections
 * this Session keeps only while one of the named Teams still holds the standing
 * it currently has.
 *
 * Both conditional policies travel because the editor offers both edits that can
 * invalidate them: removing a Team's grant ends `team_visibility_required`, and
 * moving the Session's context off a Team ends that Team's
 * `team_context_required`. The row carries which policy it depends on so the
 * confirmation names only what the edit in hand actually breaks. It names
 * resources through their display names alone and guards nothing; the later
 * admission repeats every decision and still fails closed.
 *
 * The editor asks about every Team in one call, so the preview costs one query
 * rather than one per grant row.
 */
export async function listSessionTeamCredentialBindingConsequencesInTx(
    tx: Tx,
    input: Readonly<{ sessionId: string; teamIds: readonly string[] }>,
): Promise<readonly SessionTeamCredentialBindingConsequence[]> {
    if (input.teamIds.length === 0) return [];
    const rows = await tx.sessionTeamCredentialBinding.findMany({
        where: {
            sessionId: input.sessionId,
            resource: {
                teamId: { in: [...input.teamIds] },
                sessionUsePolicy: { in: [...CONDITIONAL_SESSION_USE_POLICIES] },
            },
        },
        select: { resource: { select: { id: true, displayName: true, teamId: true, sessionUsePolicy: true } } },
        orderBy: [{ resourceId: "asc" }],
    });
    const seen = new Set<string>();
    return rows.flatMap(({ resource }) => {
        if (seen.has(resource.id)) return [];
        seen.add(resource.id);
        const policy = CONDITIONAL_SESSION_USE_POLICIES
            .find((candidate) => candidate === resource.sessionUsePolicy);
        if (!policy) return [];
        return [{ resourceId: resource.id, displayName: resource.displayName, teamId: resource.teamId, policy }];
    });
}

/** Admit a bound resource using current Team authority; the binding is only a witness. */
export async function admitSessionTeamCredentialBindingInTx(
    tx: Tx,
    input: Readonly<{
        sessionId: string;
        accountId: string;
        slot: SessionTeamCredentialSlotV1;
        deliveryMode: TeamCredentialRouteV1;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<SessionTeamCredentialAdmissionResult> {
    const binding = await readSessionTeamCredentialBindingInTx(tx, input);
    if (!binding) return { ok: false, reason: "binding_missing" };
    return validateExistingSessionTeamCredentialResourceInTx(tx, {
        sessionId: input.sessionId,
        accountId: input.accountId,
        resourceId: binding.resourceId,
        expectedResourceRevision: binding.resourceRevision,
        deliveryMode: binding.deliveryMode,
        authentication: input.authentication,
    });
}
