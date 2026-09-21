import {
    pluginJsonValuesEqual,
    PROVIDER_BROKER_ROUTE_AUDIENCE_V1,
    DIRECT_ROUTE_GRANT_TTL_MS,
    ProviderBrokerOpenRequestV1Schema,
    ProviderBrokerRequestAdmissionV1Schema,
    SignedProviderBrokerRouteGrantV1Schema,
    readMachineIrohEndpointAuthorityV1,
    type ProviderBrokerAdmissionFailureCodeV1,
    type ProviderBrokerOpenRequestV1,
    type ProviderBrokerRequestAdmissionV1,
    type SignedProviderBrokerRouteGrantV1,
    type AuthTokenAuthenticationEvidenceV1,
} from '@happier-dev/protocol';
import {
    TeamCredentialRequestPolicyV1Schema,
    TeamCredentialSourceBindingV1Schema,
    type TeamCredentialSourceBindingV1,
    type TeamCredentialUsageLimitDenialV1,
} from '@happier-dev/protocol/teams';
import type { VerifiedEphemeralSessionRunnerPrincipal } from '@happier-dev/protocol/ephemeralRunner/principal';

import { hasCurrentSessionScopedMachineAccessInTx } from '@/app/api/socket/sessionScopedBinding';
import { assertSessionTeamReadableGrantInTx } from '@/app/session/access/sessionAccess';
import { classifyMachineAvailabilityState } from '@/app/machines/machineStateGuards';
import type { MachineDaemonPresenceInventory } from '@/app/machines/machineDaemonPresence';
import type { SessionAccessAuthentication } from '@/app/session/access/sessionAccessAuthentication';
import { inTx, type Tx } from '@/storage/inTx';
import { qualifyTeamOperationAuthenticationInTx, resolveTeamActorContextInTx } from '@/app/teams/actorContext';
import { resolveTeamCredentialBrokerMachineForOpenInTx } from './brokerMachineEligibility';
import { readTeamCredentialBrokerPlacement, resolveTeamCredentialBrokerPlacementInTx } from './brokerPlacementResolver';
import { resolveTeamCredentialEntitlementInTx } from './resourceAccess';
import {
    resolveTeamCredentialDirectSourceCurrentnessInTx,
    resolveTeamCredentialResourceSourceInTx,
} from './resourceSourceResolver';
import {
    admitSessionTeamCredentialBindingInTx,
    validatePlannedSessionTeamCredentialResourceInTx,
} from './sessionBinding';
import { admitTeamCredentialUsageInTx } from './teamCredentialUsageAdmission';
import { signProviderBrokerRouteGrantV1 } from '@/app/machines/peer/mediation/signProviderBrokerRouteGrantV1';
import { projectTeamCredentialProviderModels } from './providerModelProjection';
import type { MachinePoolCandidateSnapshot } from '@/app/machines/pools/machinePoolService';
import { verifyRunnerBrokerOpenSelectionInTx } from '@/app/ephemeralRunner/runnerBrokerOpenSelection';
import { readRunnerActivationAuthentication } from '@/app/ephemeralRunner/activationAuthentication';
import { readRunnerCreatorCurrentnessInTx } from '@/app/ephemeralRunner/activationCurrentness';

type ProviderProjectionReader = (input: Readonly<{
    custodianAccountId: string;
    brokerMachineId: string;
    source: TeamCredentialSourceBindingV1;
    agentTargetKey: string;
    application: ProviderBrokerOpenRequestV1['application'];
}>) => Promise<unknown>;

type PoolSourceEligibilityReader = (input: Readonly<{
    custodianAccountId: string;
    machineIds: readonly string[];
    teamId: string;
    resourceId: string;
    resourceRevision: number;
    source: TeamCredentialSourceBindingV1;
    application: ProviderBrokerOpenRequestV1['application'];
    modelId: string;
    sourceRevision: string;
    signal: AbortSignal;
}>) => Promise<Readonly<{
    eligibleMachineIds: ReadonlySet<string>;
    reasons: ReadonlyMap<string, string>;
}>>;

type BrokerOpenPresenceReader = (input: Readonly<{
    initiatorAccountId: string;
    brokerAccountId: string;
}>) => Promise<Readonly<{
    initiatorPresence: MachineDaemonPresenceInventory;
    brokerPresence: MachineDaemonPresenceInventory;
}>>;

/**
 * Provider broker streams use the existing native machine/1 HTTP tunnel, so
 * their signed open authority uses that carrier's admission/capture window.
 * This expiry bounds opening a new tunnel only; Session/Run and per-request
 * currentness remain owned by broker admission and are never extended by it.
 */
export const PROVIDER_BROKER_ROUTE_GRANT_TTL_MS =
    DIRECT_ROUTE_GRANT_TTL_MS.directTcpTunnel;

type Failure = Readonly<{
    ok: false;
    reasonCode: ProviderBrokerAdmissionFailureCodeV1 | 'token_limit_unavailable';
    usageLimit?: TeamCredentialUsageLimitDenialV1;
}>;

export type TeamCredentialProviderBrokerOpenResult =
    | Readonly<{
        ok: true;
        authority: SignedProviderBrokerRouteGrantV1;
        target: Readonly<{
            custodianAccountId: string;
            brokerMachineId: string;
            endpointId: string;
            endpointRevision: number;
        }>;
    }>
    | Failure;

export type TeamCredentialProviderBrokerOpenInput = Readonly<{
    actorAccountId: string;
    authentication: SessionAccessAuthentication;
    request: ProviderBrokerOpenRequestV1;
    readCurrentPresence: BrokerOpenPresenceReader;
    nowMs: number;
    grantId: string;
    signingKey: Readonly<{ keyId: string; secretKey: Uint8Array }>;
    readProviderProjection: ProviderProjectionReader;
    readPoolSourceEligibility?: PoolSourceEligibilityReader;
    resolveExecutionRunCurrentness?: TeamCredentialExecutionRunCurrentnessResolver;
    verifyRefreshAuthority?: (authority: SignedProviderBrokerRouteGrantV1) => boolean;
    signal?: AbortSignal;
}>;

type TeamCredentialProviderBrokerPreparedInput = TeamCredentialProviderBrokerOpenInput & Readonly<{
    initiatorPresence: MachineDaemonPresenceInventory;
    brokerPresence: MachineDaemonPresenceInventory;
}>;

type TeamCredentialProviderBrokerOperation =
    | Readonly<{ kind: 'session'; sessionId: string }>
    | Readonly<{ kind: 'execution_run'; executionRunId: string }>;

const PROVIDER_MODEL_SESSION_SLOT = { kind: 'provider_model' } as const;

function brokerOperationIdentity(consumer: ProviderBrokerOpenRequestV1['consumer']): string {
    return consumer.kind === 'session' ? consumer.sessionId : consumer.executionRunId;
}

type TeamCredentialProviderBrokerRequestAdmissionSuccess<
    TOperation extends TeamCredentialProviderBrokerOperation = TeamCredentialProviderBrokerOperation,
> = Readonly<{
    ok: true;
    resourceId: string;
    brokerMachineId: string;
    source: TeamCredentialSourceBindingV1;
    operation: TOperation;
    usageEventId: string | null;
}>;

export type TeamCredentialProviderBrokerRequestAdmissionResult =
    | TeamCredentialProviderBrokerRequestAdmissionSuccess
    | Failure;

export type TeamCredentialExecutionRunCurrentnessResolver = (input: Readonly<{
    executionRunId: string;
    requestingAccountId: string;
    workerMachineId: string;
    expectedIntent?: import('@happier-dev/protocol').ExecutionRunIntent;
    expectedOccurrenceId: string | null;
    expectedDirectMaterialUse?: import('@happier-dev/protocol/teams').TeamCredentialDirectMaterialUseV1;
}>) => Promise<
    | Readonly<{
        ok: true;
        parentSessionId: string | null;
        occurrenceId: string;
        intent: import('@happier-dev/protocol').ExecutionRunIntent;
        runtimeState: 'active_turn' | 'idle';
        activeTurnId?: string | null;
    }>
    | Failure
>;

type AuthorizedBrokerOperation = Readonly<{
    ok: true;
    sessionId: string | null;
    session: Readonly<{
        accountId: string;
        active: boolean;
        primaryTeamId: string | null;
        latestTurnId: string | null;
        latestTurnStatus: string | null;
    }> | null;
    storageAccountId: string;
    resourceId: string;
    brokerMachineId: string;
    source: TeamCredentialSourceBindingV1;
}>;

function failure(reasonCode: Failure['reasonCode'], usageLimit?: TeamCredentialUsageLimitDenialV1): Failure {
    return { ok: false, reasonCode, ...(usageLimit ? { usageLimit } : {}) };
}

async function authorizeCurrentBrokerOperationInTx(
    tx: Tx,
    input: Readonly<{
        authenticatedBrokerAccountId: string;
        grant: SignedProviderBrokerRouteGrantV1['payload'];
        expectedResourceRevision: number;
        brokerPresence: MachineDaemonPresenceInventory;
        sessionId?: string | null;
    }>,
): Promise<AuthorizedBrokerOperation | Failure> {
    const { grant } = input;
    if (grant.consumer.kind === 'execution_run' && input.sessionId === undefined) {
        return failure('operation_not_current');
    }
    const sessionId = input.sessionId !== undefined
        ? input.sessionId
        : grant.consumer.kind === 'session' ? grant.consumer.sessionId : null;
    if (grant.consumer.kind === 'session' && sessionId === null) return failure('operation_not_current');
    if (grant.target.custodianAccountId !== input.authenticatedBrokerAccountId) return failure('resource_forbidden');
    if (input.expectedResourceRevision !== grant.expectedResourceRevision) return failure('resource_changed');
    const initiatorEndpoint = await readCurrentInitiatorEndpointInTx(tx, {
        accountId: grant.initiator.accountId,
        machineId: grant.initiator.machineId,
    });
    if (!initiatorEndpoint || initiatorEndpoint.endpointId !== grant.initiator.endpointId) {
        return failure('operation_not_current');
    }
    let session: NonNullable<AuthorizedBrokerOperation['session']> | null = null;
    if (sessionId !== null) {
        if (!await hasCurrentSessionScopedMachineAccessInTx({
            tx,
            accountId: grant.initiator.accountId,
            machineId: grant.initiator.machineId,
            sessionId,
        })) return failure('operation_not_current');
        session = await tx.session.findUnique({
            where: { id: sessionId },
            select: { accountId: true, active: true, primaryTeamId: true, latestTurnId: true, latestTurnStatus: true },
        });
        if (!session || session.accountId !== grant.initiator.accountId || !session.active) {
            return failure('session_not_active');
        }
    }
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: grant.resourceId },
        select: {
            teamId: true,
            custodianAccountId: true,
            revision: true,
            brokerMachineId: true,
            brokerPoolId: true,
            sessionUsePolicy: true,
            sourceBindingJson: true,
        },
    });
    if (!resource || resource.teamId !== grant.teamId || resource.custodianAccountId !== grant.target.custodianAccountId) {
        return failure('resource_unavailable');
    }
    if (resource.revision !== input.expectedResourceRevision) return failure('resource_changed');
    const entitlement = await resolveTeamCredentialEntitlementInTx(tx, {
        resourceId: grant.resourceId,
        accountId: grant.initiator.accountId,
    });
    if (!entitlement.ok || !entitlement.mayBroker) return failure('resource_forbidden');
    const actor = await resolveTeamActorContextInTx(tx, {
        teamId: resource.teamId,
        actorAccountId: grant.initiator.accountId,
    });
    if (!actor) return failure('resource_forbidden');
    let authenticationEvidence: readonly AuthTokenAuthenticationEvidenceV1[] | undefined;
    if (initiatorEndpoint.machineKind === 'ephemeral_session_runner') {
        if (sessionId === null) return failure('operation_not_current');
        const activation = await tx.ephemeralRunnerActivation.findFirst({
            where: {
                creatorAccountId: grant.initiator.accountId,
                sessionId,
                machineId: grant.initiator.machineId,
                state: 'materialized',
            },
        });
        if (!activation) return failure('operation_not_current');
        const creatorCurrentness = await readRunnerCreatorCurrentnessInTx(tx, activation.creatorAccountId);
        if (
            creatorCurrentness.status !== 'ready'
            || creatorCurrentness.creatorTokenEpoch !== activation.creatorTokenEpoch
        ) return failure('operation_not_current');
        authenticationEvidence = readRunnerActivationAuthentication(activation, process.env).authenticationEvidence;
    }
    if (sessionId !== null) {
        const admitted = await admitSessionTeamCredentialBindingInTx(tx, {
            sessionId,
            accountId: grant.initiator.accountId,
            slot: PROVIDER_MODEL_SESSION_SLOT,
            deliveryMode: 'brokered',
            authentication: {
                env: process.env,
                authority: 'account_automation',
                authenticationEvidence,
            },
        });
        if (!admitted.ok) {
            return failure(admitted.reason === 'resource_changed' ? 'resource_changed' : 'resource_forbidden');
        }
        if (admitted.binding.resourceId !== grant.resourceId) return failure('resource_forbidden');
        if (admitted.binding.resourceRevision !== grant.expectedResourceRevision) return failure('resource_changed');
    }
    const qualification = await qualifyTeamOperationAuthenticationInTx(tx, {
        context: actor,
        authenticationAuthority: 'account_automation',
        authenticationEvidence,
    });
    if (!qualification.ok) return failure('resource_forbidden');
    if (resource.sessionUsePolicy === 'team_context_required') {
        if (!session || session.primaryTeamId !== resource.teamId) return failure('resource_forbidden');
    } else if (resource.sessionUsePolicy === 'team_visibility_required') {
        if (sessionId === null) return failure('resource_forbidden');
        const visible = await assertSessionTeamReadableGrantInTx({ tx, sessionId, teamId: resource.teamId });
        if (!visible.ok) return failure('resource_forbidden');
    } else if (resource.sessionUsePolicy !== 'personal_allowed') {
        return failure('resource_unavailable');
    }
    const placement = readTeamCredentialBrokerPlacement(resource);
    if (!placement.ok || placement.placement === null
        || (placement.placement.kind === 'machine' && placement.placement.machineId !== grant.target.machineId)) {
        return failure('resource_changed');
    }
    const broker = await resolveTeamCredentialBrokerMachineForOpenInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        // A Pool is resolved once when its signed open is created. Later
        // requests revalidate that exact Machine through the existing owner,
        // but membership/tier edits affect only future opens.
        brokerMachineId: grant.target.machineId,
        presence: input.brokerPresence,
    });
    if (!broker.ok) return failure(broker.error);
    if (broker.machineId !== grant.target.machineId || broker.endpointAuthority.endpointId !== grant.target.endpointId) {
        return failure('broker_unavailable');
    }
    let sourceValue: unknown;
    try {
        sourceValue = JSON.parse(resource.sourceBindingJson);
    } catch {
        return failure('resource_unavailable');
    }
    const source = TeamCredentialSourceBindingV1Schema.safeParse(sourceValue);
    if (!source.success) return failure('resource_unavailable');
    const sourceCurrent = await resolveTeamCredentialResourceSourceInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source: source.data,
    });
    if (sourceCurrent.status !== 'current') return failure('resource_unavailable');
    return {
        ok: true,
        sessionId,
        session: session ? {
            accountId: session.accountId,
            active: session.active,
            primaryTeamId: session.primaryTeamId,
            latestTurnId: session.latestTurnId,
            latestTurnStatus: session.latestTurnStatus,
        } : null,
        storageAccountId: session?.accountId ?? grant.initiator.accountId,
        resourceId: grant.resourceId,
        brokerMachineId: grant.target.machineId,
        source: source.data,
    };
}

/**
 * Metadata-only authorization for the current source-owned model projection.
 * It intentionally returns no source binding or operation handle: callers can
 * prove current authority, but cannot use this leaf to acquire credentials or
 * commit request usage.
 */
export async function authorizeTeamCredentialProviderModelCatalog(
    input: Readonly<{
        authenticatedBrokerAccountId: string;
        authority: SignedProviderBrokerRouteGrantV1;
        expectedResourceRevision: number;
        readCurrentBrokerPresence: () => Promise<MachineDaemonPresenceInventory>;
        verifyAuthority: (authority: SignedProviderBrokerRouteGrantV1) => boolean;
        resolveExecutionRunCurrentness?: TeamCredentialExecutionRunCurrentnessResolver;
    }>,
): Promise<Readonly<{ ok: true }> | Failure> {
    const authority = SignedProviderBrokerRouteGrantV1Schema.safeParse(input.authority);
    if (!authority.success || !input.verifyAuthority(authority.data)) return failure('invalid_request');
    let sessionId: string | null | undefined;
    if (authority.data.payload.consumer.kind === 'execution_run') {
        if (!input.resolveExecutionRunCurrentness) return failure('execution_run_authority_unavailable');
        const current = await input.resolveExecutionRunCurrentness({
            executionRunId: authority.data.payload.consumer.executionRunId,
            requestingAccountId: authority.data.payload.initiator.accountId,
            workerMachineId: authority.data.payload.initiator.machineId,
            expectedOccurrenceId: authority.data.payload.executionRunOccurrenceId ?? null,
        });
        if (!current.ok) return current;
        if (!authority.data.payload.executionRunOccurrenceId
            || current.occurrenceId !== authority.data.payload.executionRunOccurrenceId) {
            return failure('operation_not_current');
        }
        sessionId = current.parentSessionId;
    }
    let brokerPresence: MachineDaemonPresenceInventory;
    try {
        brokerPresence = await input.readCurrentBrokerPresence();
    } catch {
        return failure('broker_unavailable');
    }
    return await inTx(async tx => {
        const authorized = await authorizeCurrentBrokerOperationInTx(tx, {
            authenticatedBrokerAccountId: input.authenticatedBrokerAccountId,
            grant: authority.data.payload,
            expectedResourceRevision: input.expectedResourceRevision,
            brokerPresence,
            sessionId,
        });
        return authorized.ok ? { ok: true } : authorized;
    });
}

async function readCurrentInitiatorEndpointInTx(
    tx: Tx,
    input: Readonly<{ accountId: string; machineId: string; presence?: MachineDaemonPresenceInventory }>,
) {
    if (input.presence && (
        input.presence.state !== 'known'
        || !input.presence.machineIds.has(input.machineId)
    )) return null;
    const machine = await tx.machine.findFirst({
        where: { id: input.machineId, accountId: input.accountId },
        select: {
            kind: true,
            revokedAt: true,
            replacedByMachineId: true,
            operationProtocolCapabilities: true,
            operationProtocolCapabilitiesRevision: true,
        },
    });
    if (!machine || classifyMachineAvailabilityState(machine) !== 'available') return null;
    const endpoint = readMachineIrohEndpointAuthorityV1({
        capabilities: machine.operationProtocolCapabilities,
        revision: machine.operationProtocolCapabilitiesRevision,
    });
    return endpoint ? { ...endpoint, machineKind: machine.kind } : null;
}

type CurrentExecutionRun = Extract<
    Awaited<ReturnType<TeamCredentialExecutionRunCurrentnessResolver>>,
    { ok: true }
>;

type BrokerOpenPreparation = Readonly<{
    request: ProviderBrokerOpenRequestV1;
    sessionId: string | null;
    executionRunOccurrenceId: string | null;
    resource: Readonly<{
        teamId: string;
        custodianAccountId: string;
        brokerMachineId: string | null;
        brokerPoolId: string | null;
        revision: number;
        sourceBindingJson: string;
        requestPolicyJson: string | null;
    }>;
    source: TeamCredentialSourceBindingV1;
    allowedModelIds: readonly string[] | null;
    initiatorEndpoint: Readonly<{ endpointId: string; revision: number; machineKind: string }>;
    poolSnapshot: MachinePoolCandidateSnapshot | null;
    poolCandidateMachineIds: readonly string[];
    broker: Readonly<{
        machineId: string;
        endpointAuthority: Readonly<{ endpointId: string; revision: number }>;
    }> | null;
}>;

type BrokerOpenDurableAuthorization = Readonly<{
    request: ProviderBrokerOpenRequestV1;
    sessionId: string | null;
    executionRunOccurrenceId: string | null;
    resource: BrokerOpenPreparation['resource'];
    source: TeamCredentialSourceBindingV1;
    allowedModelIds: readonly string[] | null;
    pinnedMachineId: string | null;
}>;

type BrokerOpenPreparationResult = BrokerOpenPreparation | Failure;

function isFailure(value: object): value is Failure {
    return 'ok' in value && value.ok === false;
}

function poolSnapshotsEqual(
    left: MachinePoolCandidateSnapshot | null,
    right: MachinePoolCandidateSnapshot | null,
): boolean {
    if (left === null || right === null) return left === right;
    const leftMembers = [...left.members].sort((a, b) => a.machineId.localeCompare(b.machineId));
    const rightMembers = [...right.members].sort((a, b) => a.machineId.localeCompare(b.machineId));
    // Only the Pool definition is compared. Another member's live socket
    // coming or going between the two reads is not a change to this open:
    // the selected Machine's own presence, eligibility and endpoint are
    // rechecked independently by the final placement resolution.
    return left.poolId === right.poolId
        && left.revision === right.revision
        && leftMembers.length === rightMembers.length
        && leftMembers.every((member, index) => {
            const candidate = rightMembers[index];
            return candidate !== undefined
                && member.machineId === candidate.machineId
                && member.priorityTier === candidate.priorityTier
                && member.enabled === candidate.enabled;
        });
}

function preparationChangeFailure(
    left: BrokerOpenPreparation,
    right: BrokerOpenPreparation,
): Failure | null {
    if (left.sessionId !== right.sessionId
        || left.executionRunOccurrenceId !== right.executionRunOccurrenceId) {
        return failure('operation_not_current');
    }
    if (left.resource.teamId !== right.resource.teamId
        || left.resource.custodianAccountId !== right.resource.custodianAccountId
        || left.resource.brokerMachineId !== right.resource.brokerMachineId
        || left.resource.brokerPoolId !== right.resource.brokerPoolId
        || left.resource.revision !== right.resource.revision
        || left.resource.sourceBindingJson !== right.resource.sourceBindingJson
        || left.resource.requestPolicyJson !== right.resource.requestPolicyJson
        || !pluginJsonValuesEqual(left.source, right.source)
        || !pluginJsonValuesEqual(left.allowedModelIds, right.allowedModelIds)
        || !poolSnapshotsEqual(left.poolSnapshot, right.poolSnapshot)) {
        return failure('resource_changed');
    }
    const exactBrokerChanged = left.broker !== null && (
        right.broker === null
        || left.broker.machineId !== right.broker.machineId
        || left.broker.endpointAuthority.endpointId !== right.broker.endpointAuthority.endpointId
        || left.broker.endpointAuthority.revision !== right.broker.endpointAuthority.revision
    );
    if (left.initiatorEndpoint.endpointId !== right.initiatorEndpoint.endpointId
        || left.initiatorEndpoint.revision !== right.initiatorEndpoint.revision
        || exactBrokerChanged) {
        return failure('broker_unavailable');
    }
    return null;
}

async function resolveOpenExecutionRunCurrentness(
    input: TeamCredentialProviderBrokerOpenInput,
    request: ProviderBrokerOpenRequestV1,
): Promise<CurrentExecutionRun | Failure | null> {
    if (request.consumer.kind !== 'execution_run') return null;
    if (!input.resolveExecutionRunCurrentness) return failure('execution_run_authority_unavailable');
    const current = await input.resolveExecutionRunCurrentness({
        executionRunId: request.consumer.executionRunId,
        requestingAccountId: input.actorAccountId,
        workerMachineId: request.initiatorMachineId,
        expectedOccurrenceId: request.refreshAuthority?.payload.consumer.kind === 'execution_run'
            ? request.refreshAuthority.payload.executionRunOccurrenceId ?? null
            : null,
    });
    if (!current.ok) return current;
    const expectedOccurrenceId = request.refreshAuthority?.payload.consumer.kind === 'execution_run'
        ? request.refreshAuthority.payload.executionRunOccurrenceId ?? null
        : null;
    if (expectedOccurrenceId !== null && current.occurrenceId !== expectedOccurrenceId) {
        return failure('operation_not_current');
    }
    return current;
}

/**
 * Authorizes the durable Session/Run binding and resource before callers read
 * Machine presence or contact any daemon. Availability and endpoint facts are
 * deliberately left to the later preparation stage and its final recheck.
 */
async function authorizeTeamCredentialProviderBrokerOpenDurableInTx(
    tx: Tx,
    input: TeamCredentialProviderBrokerOpenInput & Readonly<{
        runnerPrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
    }>,
    request: ProviderBrokerOpenRequestV1,
    executionRun: CurrentExecutionRun | null,
): Promise<BrokerOpenDurableAuthorization | Failure> {
    const refreshAuthority = request.refreshAuthority ?? null;
    const refreshConsumerMatches = refreshAuthority === null
        || (refreshAuthority.payload.consumer.kind === request.consumer.kind
            && (request.consumer.kind === 'session'
                ? refreshAuthority.payload.consumer.kind === 'session'
                    && refreshAuthority.payload.consumer.sessionId === request.consumer.sessionId
                : refreshAuthority.payload.consumer.kind === 'execution_run'
                    && refreshAuthority.payload.consumer.executionRunId === request.consumer.executionRunId));
    if (refreshAuthority !== null && (
        refreshAuthority.payload.resourceId !== request.resourceId
        || refreshAuthority.payload.expectedResourceRevision !== request.expectedResourceRevision
        || refreshAuthority.payload.modelId !== request.modelId
        || refreshAuthority.payload.sourceRevision !== request.sourceRevision
        || refreshAuthority.payload.initiator.accountId !== input.actorAccountId
        || refreshAuthority.payload.initiator.machineId !== request.initiatorMachineId
        || !refreshConsumerMatches
        || !pluginJsonValuesEqual(refreshAuthority.payload.application, request.application)
    )) return failure('invalid_request');

    let sessionId: string | null;
    let executionRunOccurrenceId: string | null = null;
    if (request.consumer.kind === 'execution_run') {
        if (executionRun === null) return failure('execution_run_authority_unavailable');
        sessionId = executionRun.parentSessionId;
        executionRunOccurrenceId = executionRun.occurrenceId;
    } else {
        sessionId = request.consumer.sessionId;
    }
    if (sessionId !== null) {
        const session = await tx.session.findUnique({
            where: { id: sessionId },
            select: { accountId: true, active: true },
        });
        if (!session || session.accountId !== input.actorAccountId || !session.active) {
            return failure('session_not_active');
        }
        if (!await hasCurrentSessionScopedMachineAccessInTx({
            tx,
            accountId: input.actorAccountId,
            machineId: request.initiatorMachineId,
            sessionId,
        })) return failure('resource_forbidden');
    }
    const admitted = sessionId === null
        ? await validatePlannedSessionTeamCredentialResourceInTx(tx, {
            accountId: input.actorAccountId,
            resourceId: request.resourceId,
            expectedResourceRevision: request.expectedResourceRevision,
            plannedSession: { primaryTeamId: null, teamVisibilityTeamIds: [] },
            deliveryMode: 'brokered',
            authentication: input.authentication,
        })
        : await admitSessionTeamCredentialBindingInTx(tx, {
            sessionId,
            accountId: input.actorAccountId,
            slot: PROVIDER_MODEL_SESSION_SLOT,
            deliveryMode: 'brokered',
            authentication: input.authentication,
        });
    if (!admitted.ok) return failure(admitted.reason === 'resource_changed' ? 'resource_changed' : 'resource_forbidden');
    if (admitted.binding.resourceId !== request.resourceId) return failure('resource_forbidden');
    if (admitted.binding.resourceRevision !== request.expectedResourceRevision) return failure('resource_changed');
    if (!admitted.entitlement.mayBroker) return failure('resource_forbidden');

    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: request.resourceId },
        select: {
            teamId: true,
            custodianAccountId: true,
            brokerMachineId: true,
            brokerPoolId: true,
            revision: true,
            sourceBindingJson: true,
            requestPolicyJson: true,
        },
    });
    if (!resource) return failure('resource_forbidden');
    if (resource.revision !== request.expectedResourceRevision) return failure('resource_changed');
    if (refreshAuthority !== null && (
        refreshAuthority.payload.teamId !== resource.teamId
        || refreshAuthority.payload.target.custodianAccountId !== resource.custodianAccountId
    )) return failure('invalid_request');
    let rawSource: unknown;
    let rawPolicy: unknown = null;
    try {
        rawSource = JSON.parse(resource.sourceBindingJson);
        rawPolicy = resource.requestPolicyJson === null ? null : JSON.parse(resource.requestPolicyJson);
    } catch {
        return failure('resource_unavailable');
    }
    const source = TeamCredentialSourceBindingV1Schema.safeParse(rawSource);
    const policy = TeamCredentialRequestPolicyV1Schema.nullable().safeParse(rawPolicy);
    if (!source.success || !policy.success) return failure('resource_unavailable');
    const runnerSelection = input.runnerPrincipal
        ? await verifyRunnerBrokerOpenSelectionInTx(tx, {
            principal: input.runnerPrincipal,
            request,
        })
        : null;
    if (input.runnerPrincipal && !runnerSelection) return failure('resource_forbidden');
    if (runnerSelection !== null && (
        runnerSelection.resourceId !== request.resourceId
        || runnerSelection.revision !== resource.revision
        || !pluginJsonValuesEqual(runnerSelection.application, request.application)
        || runnerSelection.sourceRevision !== request.sourceRevision
    )) return failure('resource_changed');
    const pinnedRefreshMachineId = refreshAuthority?.payload.target.machineId ?? null;
    if (runnerSelection !== null && pinnedRefreshMachineId !== null
        && pinnedRefreshMachineId !== runnerSelection.brokerMachineId) return failure('invalid_request');
    return {
        request,
        sessionId,
        executionRunOccurrenceId,
        resource,
        source: source.data,
        allowedModelIds: policy.data?.allowedModelIds ?? null,
        pinnedMachineId: runnerSelection?.brokerMachineId ?? pinnedRefreshMachineId,
    };
}

/**
 * Reads and validates durable broker-open authority only. Presence is a
 * caller-captured snapshot for this stage; orchestration refreshes it before
 * the final signing stage. No daemon or other external RPC is permitted here.
 */
async function prepareTeamCredentialProviderBrokerOpenInTx(
    tx: Tx,
    input: TeamCredentialProviderBrokerPreparedInput & Readonly<{
        runnerPrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
    }>,
    request: ProviderBrokerOpenRequestV1,
    executionRun: CurrentExecutionRun | null,
    selectedPoolMachineId: string | null,
    poolEligibleMachineIds: ReadonlySet<string> | null,
): Promise<BrokerOpenPreparationResult> {
    const authorized = await authorizeTeamCredentialProviderBrokerOpenDurableInTx(
        tx,
        input,
        request,
        executionRun,
    );
    if (isFailure(authorized)) return authorized;
    const { request: parsedRequest, resource, pinnedMachineId } = authorized;
    const initiatorEndpoint = await readCurrentInitiatorEndpointInTx(tx, {
        accountId: input.actorAccountId,
        machineId: parsedRequest.initiatorMachineId,
        presence: input.initiatorPresence,
    });
    if (!initiatorEndpoint) return failure('broker_unavailable');
    const placement = await resolveTeamCredentialBrokerPlacementInTx(tx, {
        resource: {
            id: parsedRequest.resourceId,
            custodianAccountId: resource.custodianAccountId,
            brokerMachineId: resource.brokerMachineId,
            brokerPoolId: resource.brokerPoolId,
        },
        presence: input.brokerPresence,
        requestKey: [
            parsedRequest.resourceId,
            parsedRequest.consumer.kind,
            brokerOperationIdentity(parsedRequest.consumer),
        ].join('\u0000'),
        pinnedMachineId,
        ...(poolEligibleMachineIds === null ? {} : { poolEligibleMachineIds }),
        ...(selectedPoolMachineId === null ? {} : { expectedPoolMachineId: selectedPoolMachineId }),
    });
    if (!placement.ok) {
        return failure(placement.error === 'resource_unavailable' ? 'resource_unavailable' : placement.error);
    }
    // The private broker open is an Iroh peer tunnel, so this consumer — unlike
    // the relay-reached resource test and external API key — cannot proceed
    // without the Machine's own endpoint authority.
    const endpointAuthority = placement.broker?.endpointAuthority ?? null;
    if (placement.broker !== null && endpointAuthority === null) return failure('broker_unavailable');
    const broker = placement.broker === null || endpointAuthority === null
        ? null
        : { machineId: placement.broker.machineId, endpointAuthority };
    return {
        request: authorized.request,
        sessionId: authorized.sessionId,
        executionRunOccurrenceId: authorized.executionRunOccurrenceId,
        resource: authorized.resource,
        source: authorized.source,
        allowedModelIds: authorized.allowedModelIds,
        initiatorEndpoint,
        poolSnapshot: placement.poolSnapshot,
        poolCandidateMachineIds: placement.candidateMachineIds,
        broker,
    };
}

function finalizePreparedBrokerOpen(
    input: TeamCredentialProviderBrokerOpenInput,
    prepared: BrokerOpenPreparation,
    projectionResponse: unknown,
): TeamCredentialProviderBrokerOpenResult {
    if (prepared.broker === null) return failure('broker_unavailable');
    const selection = projectTeamCredentialProviderModels({
        response: projectionResponse,
        resourceId: prepared.request.resourceId,
        teamId: prepared.resource.teamId,
        resourceRevision: prepared.resource.revision,
        agentTargetKey: prepared.request.application.agentTargetKey,
        application: prepared.request.application,
        allowedModelIds: prepared.allowedModelIds,
        source: prepared.source,
        deliveryMode: 'brokered',
    }).find(candidate => (
        candidate.selection.modelId === prepared.request.modelId
        && candidate.sourceRevision === prepared.request.sourceRevision
        && pluginJsonValuesEqual(candidate.application, prepared.request.application)
    ));
    if (!selection) return failure('resource_unavailable');
    const authority = signProviderBrokerRouteGrantV1({
        payload: {
            v: 1,
            grantId: input.grantId,
            aud: PROVIDER_BROKER_ROUTE_AUDIENCE_V1,
            issuedAt: input.nowMs,
            // This bounds capture of a new Machine HTTP-tunnel admission. It
            // is not a broker/session lifetime and deliberately reuses the
            // existing carrier owner's direct-tunnel anti-capture bound.
            expiresAt: input.nowMs + PROVIDER_BROKER_ROUTE_GRANT_TTL_MS,
            teamId: prepared.resource.teamId,
            resourceId: prepared.request.resourceId,
            expectedResourceRevision: prepared.request.expectedResourceRevision,
            modelId: selection.selection.modelId,
            sourceRevision: selection.sourceRevision,
            initiator: {
                accountId: input.actorAccountId,
                machineId: prepared.request.initiatorMachineId,
                endpointId: prepared.initiatorEndpoint.endpointId,
            },
            target: {
                custodianAccountId: prepared.resource.custodianAccountId,
                machineId: prepared.broker.machineId,
                endpointId: prepared.broker.endpointAuthority.endpointId,
            },
            consumer: prepared.request.consumer,
            ...(prepared.request.consumer.kind === 'execution_run'
                ? { executionRunOccurrenceId: prepared.executionRunOccurrenceId! }
                : {}),
            application: selection.application,
        },
        signingKey: input.signingKey,
    });
    return {
        ok: true,
        authority,
        target: {
            custodianAccountId: prepared.resource.custodianAccountId,
            brokerMachineId: prepared.broker.machineId,
            endpointId: prepared.broker.endpointAuthority.endpointId,
            endpointRevision: prepared.broker.endpointAuthority.revision,
        },
    };
}

async function preauthorizeTeamCredentialProviderBrokerOpen(
    input: TeamCredentialProviderBrokerOpenInput & Readonly<{
        runnerPrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
    }>,
    request: ProviderBrokerOpenRequestV1,
): Promise<Readonly<{
    authorization: BrokerOpenDurableAuthorization;
    executionRun: CurrentExecutionRun | null;
}> | Failure> {
    // Execution Run currentness is process-owned and can require daemon RPC.
    // Gate that call behind current resource entitlement so a missing or
    // foreign resource cannot be used to trigger or observe external work.
    if (request.consumer.kind === 'execution_run') {
        const entitlement = await inTx(tx => resolveTeamCredentialEntitlementInTx(tx, {
            resourceId: request.resourceId,
            accountId: input.actorAccountId,
        }));
        if (!entitlement.ok || !entitlement.mayBroker) return failure('resource_forbidden');
        if (entitlement.resourceRevision !== request.expectedResourceRevision) {
            return failure('resource_changed');
        }
    }
    const executionRun = await resolveOpenExecutionRunCurrentness(input, request);
    if (executionRun !== null && !executionRun.ok) return executionRun;
    const authorization = await inTx(tx => authorizeTeamCredentialProviderBrokerOpenDurableInTx(
        tx,
        input,
        request,
        executionRun,
    ));
    if (isFailure(authorization)) return authorization;
    return { authorization, executionRun };
}

async function openTeamCredentialProviderBrokerWithPrincipal(
    input: TeamCredentialProviderBrokerOpenInput & Readonly<{
        runnerPrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
    }>,
): Promise<TeamCredentialProviderBrokerOpenResult> {
    const parsed = ProviderBrokerOpenRequestV1Schema.safeParse(input.request);
    if (!parsed.success) return failure('invalid_request');
    if (parsed.data.refreshAuthority !== undefined
        && !input.verifyRefreshAuthority?.(parsed.data.refreshAuthority)) {
        return failure('invalid_request');
    }
    const preauthorized = await preauthorizeTeamCredentialProviderBrokerOpen(input, parsed.data);
    if (isFailure(preauthorized)) return preauthorized;
    let initialPresence: Awaited<ReturnType<BrokerOpenPresenceReader>>;
    try {
        initialPresence = await input.readCurrentPresence({
            initiatorAccountId: input.actorAccountId,
            brokerAccountId: preauthorized.authorization.resource.custodianAccountId,
        });
    } catch {
        return failure('broker_unavailable');
    }
    const preparedInput: TeamCredentialProviderBrokerPreparedInput & Readonly<{
        runnerPrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
    }> = {
        ...input,
        initiatorPresence: initialPresence.initiatorPresence,
        brokerPresence: initialPresence.brokerPresence,
    };
    const initial = await inTx(tx => prepareTeamCredentialProviderBrokerOpenInTx(
        tx,
        preparedInput,
        parsed.data,
        preauthorized.executionRun,
        null,
        null,
    ));
    if (isFailure(initial)) return initial;

    let selectedPoolMachineId: string | null = initial.broker?.machineId ?? null;
    let poolEligibleMachineIds: ReadonlySet<string> | null = null;
    let preProjection = initial;
    if (initial.resource.brokerPoolId !== null && initial.broker === null) {
        if (!input.readPoolSourceEligibility || initial.poolSnapshot === null) return failure('resource_unavailable');
        const signal = input.signal ?? new AbortController().signal;
        const genericCandidateIds = initial.poolCandidateMachineIds;
        if (genericCandidateIds.length === 0) return failure('broker_unavailable');
        const eligibility = await input.readPoolSourceEligibility({
            custodianAccountId: initial.resource.custodianAccountId,
            machineIds: genericCandidateIds,
            teamId: initial.resource.teamId,
            resourceId: initial.request.resourceId,
            resourceRevision: initial.resource.revision,
            source: initial.source,
            application: initial.request.application,
            modelId: initial.request.modelId,
            sourceRevision: initial.request.sourceRevision,
            signal,
        }).catch(() => null);
        if (!eligibility || signal.aborted) return failure('broker_unavailable');
        poolEligibleMachineIds = eligibility.eligibleMachineIds;
        const selected = await inTx(tx => prepareTeamCredentialProviderBrokerOpenInTx(
            tx,
            preparedInput,
            parsed.data,
            preauthorized.executionRun,
            null,
            poolEligibleMachineIds,
        ));
        if (isFailure(selected)) return selected;
        const changed = preparationChangeFailure(initial, selected);
        if (changed) return changed;
        selectedPoolMachineId = selected.broker?.machineId ?? null;
        if (selectedPoolMachineId === null) return failure('broker_unavailable');
        preProjection = selected;
    }

    if (selectedPoolMachineId === null) return failure('broker_unavailable');
    let projectionResponse: unknown;
    try {
        projectionResponse = await input.readProviderProjection({
            custodianAccountId: preProjection.resource.custodianAccountId,
            brokerMachineId: selectedPoolMachineId,
            source: preProjection.source,
            agentTargetKey: preProjection.request.application.agentTargetKey,
            application: preProjection.request.application,
        });
    } catch {
        return failure('resource_unavailable');
    }

    const finalRun = await resolveOpenExecutionRunCurrentness(input, parsed.data);
    if (finalRun !== null && !finalRun.ok) return finalRun;
    let currentPresence: Awaited<ReturnType<BrokerOpenPresenceReader>>;
    try {
        currentPresence = await input.readCurrentPresence({
            initiatorAccountId: input.actorAccountId,
            brokerAccountId: preProjection.resource.custodianAccountId,
        });
    } catch {
        return failure('broker_unavailable');
    }
    return await inTx(async tx => {
        const current = await prepareTeamCredentialProviderBrokerOpenInTx(
            tx,
            {
                ...input,
                initiatorPresence: currentPresence.initiatorPresence,
                brokerPresence: currentPresence.brokerPresence,
            },
            parsed.data,
            finalRun,
            selectedPoolMachineId,
            poolEligibleMachineIds,
        );
        if (isFailure(current)) return current;
        const changed = preparationChangeFailure(preProjection, current);
        if (changed) return changed;
        return finalizePreparedBrokerOpen(input, current, projectionResponse);
    });
}

/** Ordinary Session/Run opens select Pool placement at this Home boundary. */
export async function openTeamCredentialProviderBroker(
    input: TeamCredentialProviderBrokerOpenInput,
): Promise<TeamCredentialProviderBrokerOpenResult> {
    return await openTeamCredentialProviderBrokerWithPrincipal(input);
}

/** Restricted Runner opens consume their exact pre-review frozen selection. */
export async function openRunnerTeamCredentialProviderBroker(
    input: TeamCredentialProviderBrokerOpenInput & Readonly<{
        principal: VerifiedEphemeralSessionRunnerPrincipal;
    }>,
): Promise<TeamCredentialProviderBrokerOpenResult> {
    return await openTeamCredentialProviderBrokerWithPrincipal({
        ...input,
        runnerPrincipal: input.principal,
    });
}

/**
 * The one Home-side per-request admission owner. The target daemon account is
 * authenticated out of band; the signed requester identity is then rechecked
 * against current Session, resource, source and exact-Machine facts in this
 * transaction before the immutable request-count event is written.
 */
type TeamCredentialProviderBrokerRequestAdmissionInput = Readonly<{
    authenticatedBrokerAccountId: string;
    request: ProviderBrokerRequestAdmissionV1;
    observedAt: Date;
    readCurrentBrokerPresence: () => Promise<MachineDaemonPresenceInventory>;
    verifyAuthority: (authority: SignedProviderBrokerRouteGrantV1) => boolean;
    resolveExecutionRunCurrentness?: TeamCredentialExecutionRunCurrentnessResolver;
}>;

export async function admitTeamCredentialProviderBrokerRequest(
    input: TeamCredentialProviderBrokerRequestAdmissionInput,
): Promise<TeamCredentialProviderBrokerRequestAdmissionResult> {
    const parsed = ProviderBrokerRequestAdmissionV1Schema.safeParse(input.request);
    if (!parsed.success || !input.verifyAuthority(parsed.data.authority)) return failure('invalid_request');
    let executionRun: CurrentExecutionRun | null = null;
    const grant = parsed.data.authority.payload;
    if (grant.consumer.kind === 'execution_run') {
        if (!input.resolveExecutionRunCurrentness) return failure('execution_run_authority_unavailable');
        const current = await input.resolveExecutionRunCurrentness({
            executionRunId: grant.consumer.executionRunId,
            requestingAccountId: grant.initiator.accountId,
            workerMachineId: grant.initiator.machineId,
            expectedOccurrenceId: grant.executionRunOccurrenceId ?? null,
        });
        if (!current.ok) return current;
        executionRun = current;
    }
    let brokerPresence: MachineDaemonPresenceInventory;
    try {
        brokerPresence = await input.readCurrentBrokerPresence();
    } catch {
        return failure('broker_unavailable');
    }
    return await inTx(tx => admitTeamCredentialProviderBrokerRequestInTx(
        tx,
        { ...input, brokerPresence },
        parsed.data,
        executionRun,
    ));
}

async function admitTeamCredentialProviderBrokerRequestInTx(
    tx: Tx,
    input: TeamCredentialProviderBrokerRequestAdmissionInput & Readonly<{
        brokerPresence: MachineDaemonPresenceInventory;
    }>,
    request: ProviderBrokerRequestAdmissionV1,
    executionRun: CurrentExecutionRun | null,
): Promise<TeamCredentialProviderBrokerRequestAdmissionResult> {
    const { authority, expectedResourceRevision, requestFacts } = request;
    const grant = authority.payload;
    if (grant.target.custodianAccountId !== input.authenticatedBrokerAccountId) return failure('resource_forbidden');
    if (expectedResourceRevision !== grant.expectedResourceRevision) return failure('resource_changed');
    const routeMatchesApplication = (
        requestFacts.routeKind === 'openai_responses' && grant.application.protocol === 'openai-responses'
    ) || (
        requestFacts.routeKind === 'openai_chat_completions' && grant.application.protocol === 'openai-chat'
    ) || (
        requestFacts.routeKind === 'anthropic_messages' && grant.application.protocol === 'anthropic'
    );
    if (requestFacts.modelId !== grant.modelId || !routeMatchesApplication) return failure('invalid_request');
    if (grant.consumer.kind === 'execution_run') {
        if (executionRun === null) return failure('execution_run_authority_unavailable');
        if (!grant.executionRunOccurrenceId || executionRun.occurrenceId !== grant.executionRunOccurrenceId) return failure('operation_not_current');
        // Generation needs an active turn; admitted non-generation work
        // (token counting) is still accounted against the Run below.
        if (requestFacts.generation && executionRun.runtimeState !== 'active_turn') return failure('operation_not_current');
        const authorized = await authorizeCurrentBrokerOperationInTx(tx, {
            authenticatedBrokerAccountId: input.authenticatedBrokerAccountId,
            grant,
            expectedResourceRevision,
            brokerPresence: input.brokerPresence,
            sessionId: executionRun.parentSessionId,
        });
        if (!authorized.ok) return authorized;
        const sourceMemberCurrentness = await resolveTeamCredentialDirectSourceCurrentnessInTx(tx, {
            custodianAccountId: grant.target.custodianAccountId,
            source: authorized.source,
            sourceMemberKey: request.sourceMemberKey,
        });
        if (sourceMemberCurrentness.status !== 'current') return failure('resource_changed');
        const usage = await admitTeamCredentialUsageInTx(tx, {
            storageAccountId: authorized.storageAccountId,
            sessionId: executionRun.parentSessionId,
            turnId: requestFacts.generation ? executionRun.activeTurnId ?? null : null,
            observedAt: input.observedAt,
            requestId: request.requestId,
            modelId: requestFacts.modelId,
            usageRoute: executionRun.parentSessionId === null
                ? 'agent_runtime_detached_execution_run'
                : 'agent_runtime_attached_execution_run',
            authority: {
                kind: 'teamCredentialAdmission',
                requestingAccountId: grant.initiator.accountId,
                resourceId: grant.resourceId,
                externalApiKeyId: null,
                sourceCredentialId: request.sourceMemberKey,
                workerMachineId: grant.initiator.machineId,
                brokerMachineId: grant.target.machineId,
                deliveryMode: 'brokered',
                executionRunId: grant.consumer.executionRunId,
            },
        });
        if (!usage.ok) return failure(
            usage.reasonCode,
            usage.reasonCode === 'team_credential_usage_limit' ? usage.usageLimit : undefined,
        );
        if (!usage.created) return failure('duplicate_request');
        return {
            ok: true,
            resourceId: grant.resourceId,
            brokerMachineId: grant.target.machineId,
            source: authorized.source,
            operation: { kind: 'execution_run', executionRunId: grant.consumer.executionRunId },
            usageEventId: usage.usageEventId,
        };
    }
    const authorized = await authorizeCurrentBrokerOperationInTx(tx, {
        authenticatedBrokerAccountId: input.authenticatedBrokerAccountId,
        grant,
        expectedResourceRevision,
        brokerPresence: input.brokerPresence,
    });
    if (!authorized.ok) return authorized;
    const sourceMemberCurrentness = await resolveTeamCredentialDirectSourceCurrentnessInTx(tx, {
        custodianAccountId: grant.target.custodianAccountId,
        source: authorized.source,
        sourceMemberKey: request.sourceMemberKey,
    });
    if (sourceMemberCurrentness.status !== 'current') return failure('resource_changed');
    const { sessionId, session, source } = authorized;
    if (sessionId === null || session === null) return failure('operation_not_current');

    // Generation is admitted only inside the Session's in-progress turn whose
    // witness names this requester and resource. Admitted non-generation work
    // (token counting) needs no turn but is accounted the same way.
    let turnId: string | null = null;
    if (requestFacts.generation) {
        if (!session.latestTurnId || session.latestTurnStatus !== 'in_progress') return failure('session_not_active');
        const turn = await tx.sessionTurn.findUnique({
            where: { sessionId_turnId: { sessionId, turnId: session.latestTurnId } },
            select: {
                status: true,
                usageActorAccountId: true,
                teamCredentialResourceId: true,
                credentialDeliveryMode: true,
            },
        });
        if (!turn || turn.status !== 'in_progress'
            || turn.usageActorAccountId !== grant.initiator.accountId
            || turn.teamCredentialResourceId !== grant.resourceId
            || turn.credentialDeliveryMode !== 'brokered') return failure('operation_not_current');
        turnId = session.latestTurnId;
    }
    const usage = await admitTeamCredentialUsageInTx(tx, {
        storageAccountId: session.accountId,
        sessionId,
        turnId,
        observedAt: input.observedAt,
        requestId: request.requestId,
        modelId: requestFacts.modelId,
        usageRoute: 'agent_runtime_session_turn',
        authority: {
            kind: 'teamCredentialAdmission',
            requestingAccountId: grant.initiator.accountId,
            resourceId: grant.resourceId,
            externalApiKeyId: null,
            sourceCredentialId: request.sourceMemberKey,
            workerMachineId: grant.initiator.machineId,
            brokerMachineId: grant.target.machineId,
            deliveryMode: 'brokered',
            executionRunId: null,
        },
    });
    if (!usage.ok) return failure(
        usage.reasonCode,
        usage.reasonCode === 'team_credential_usage_limit' ? usage.usageLimit : undefined,
    );
    if (!usage.created) return failure('duplicate_request');

    return {
        ok: true,
        resourceId: grant.resourceId,
        brokerMachineId: grant.target.machineId,
        source,
        operation: { kind: 'session', sessionId },
        usageEventId: usage.usageEventId,
    };
}
