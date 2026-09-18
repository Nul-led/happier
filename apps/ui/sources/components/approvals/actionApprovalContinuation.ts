import {
    approvalArtifactBodyMatchesHeaderV1,
    getActionSpec,
    readApprovalExecutionFailure,
    type ActionExecuteFailure,
    type ActionId,
    type ApprovalRequestV2,
    type HomeDomainActionIdV1,
} from '@happier-dev/protocol';
import { createCanonicalJsonSigningInput } from '@happier-dev/protocol/crypto/canonicalJson';

import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

export type ActionApprovalTerminalStatus = 'rejected' | 'failed' | 'canceled' | 'invalid';

/**
 * Process-local custody for one result-bearing Action approval.
 *
 * The Artifact remains the durable lifecycle owner. This callback is deliberately
 * not serializable: losing the mounted origin safely falls back to its ordinary
 * projection refresh instead of replaying an already executed mutation.
 */
export type ActionApprovalContinuation = Readonly<{
    artifactId: string;
    onExecuted: (artifact: DecryptedArtifact) => Promise<'consumed' | 'ignored'>;
    onTerminal?: (status: ActionApprovalTerminalStatus, artifact?: DecryptedArtifact | null) => void;
}>;

/** Existing non-result-bearing callers may continue registering only the Artifact id. */
export type ActionApprovalRegistration = string | ActionApprovalContinuation;

export function normalizeActionApprovalRegistration(
    registration: ActionApprovalRegistration,
): Readonly<{ artifactId: string; continuation: ActionApprovalContinuation | null }> {
    return typeof registration === 'string'
        ? { artifactId: registration, continuation: null }
        : { artifactId: registration.artifactId, continuation: registration };
}

type ApprovalRequestInspection =
    | Readonly<{ kind: 'different_artifact' }>
    | Readonly<{ kind: 'invalid_artifact' }>
    | Readonly<{ kind: 'binding_mismatch' }>
    | Readonly<{
        kind: 'matched';
        request: ApprovalRequestV2;
    }>;

function inspectActionApprovalRequest<TActionId extends ActionId>(input: Readonly<{
    artifact: DecryptedArtifact;
    artifactId: string;
    actionId: TActionId;
    scope: ServerAccountScope;
    expectedInputCanonical?: string | null;
    expectedRequestId?: string;
}>): ApprovalRequestInspection {
    if (input.artifact.id !== input.artifactId) return { kind: 'different_artifact' };
    if (typeof input.artifact.body !== 'string') return { kind: 'invalid_artifact' };
    const parsed = approvalArtifactBodyMatchesHeaderV1(input.artifact.header ?? {}, input.artifact.body);
    if (!parsed || parsed.family !== 'built_in' || parsed.request.v !== 2) return { kind: 'invalid_artifact' };
    const request = parsed.request;
    if (
        request.actionId !== input.actionId
        || request.executionOriginV1.actionId !== input.actionId
        || request.executionOriginV1.authority !== 'present_user'
        || request.executionOriginV1.surface !== 'ui'
        || request.requestedSurface !== 'ui'
        || request.executionOriginV1.caller.kind !== 'host'
        || request.executionOriginV1.accountId !== input.scope.accountId
        || (
            input.expectedRequestId !== undefined
            && request.executionOriginV1.requestId !== input.expectedRequestId
        )
        || (
            request.executionOriginV1.serverId !== input.scope.serverId
            && !areServerProfileIdentifiersEquivalent(
                request.executionOriginV1.serverId,
                input.scope.serverId,
            )
        )
    ) return { kind: 'binding_mismatch' };
    if (input.expectedInputCanonical !== undefined) {
        const recordedInput = getActionSpec(input.actionId).inputSchema.safeParse(request.actionArgs);
        if (
            input.expectedInputCanonical === null
            || !recordedInput.success
            || createCanonicalJsonSigningInput(recordedInput.data) !== input.expectedInputCanonical
        ) return { kind: 'binding_mismatch' };
    }
    return { kind: 'matched', request };
}

type CreateActionApprovalContinuationInput<TValue, TActionId extends ActionId> = Readonly<{
    artifactId: string;
    actionId: TActionId;
    scope: ServerAccountScope;
    /** Bind settlement to the originating invocation when its caller received that identity. */
    expectedRequestId?: string;
    /**
     * The originating Action input. When present, settlement validates both
     * values with the Action's declared schema and compares their canonical
     * JSON without logging either value. This prevents a same-Action approval
     * for another resource or mutation from satisfying this continuation.
     */
    expectedInput?: unknown;
    onSucceeded: (value: TValue) => void | Promise<void>;
    onFailed?: (code: string, failure?: ActionExecuteFailure) => void;
}>;

/**
 * Bind an exact Action approval Artifact back to the UI operation that created it.
 *
 * Action identity, input and output all come from the one canonical ActionSpec
 * registry. Domain-specific callers may expose a narrower wrapper, but must not
 * recreate settlement parsing or principal/scope checks.
 */
export function createActionApprovalContinuation<TValue, TActionId extends ActionId>(
    input: CreateActionApprovalContinuationInput<TValue, TActionId>,
): ActionApprovalContinuation;
export function createActionApprovalContinuation(
    input: CreateActionApprovalContinuationInput<unknown, ActionId>,
): ActionApprovalContinuation {
    const expectedInputCanonical = Object.prototype.hasOwnProperty.call(input, 'expectedInput')
        ? (() => {
            const parsed = getActionSpec(input.actionId).inputSchema.safeParse(input.expectedInput);
            return parsed.success ? createCanonicalJsonSigningInput(parsed.data) : null;
        })()
        : undefined;
    return Object.freeze({
        artifactId: input.artifactId,
        onExecuted: async (artifact: DecryptedArtifact) => {
            const inspection = inspectActionApprovalRequest({
                artifact,
                artifactId: input.artifactId,
                actionId: input.actionId,
                scope: input.scope,
                ...(expectedInputCanonical !== undefined ? { expectedInputCanonical } : {}),
                ...(input.expectedRequestId !== undefined ? { expectedRequestId: input.expectedRequestId } : {}),
            });
            if (inspection.kind === 'different_artifact') return 'ignored';
            if (inspection.kind === 'invalid_artifact') {
                input.onFailed?.('approval_invalid');
                return 'consumed';
            }
            if (inspection.kind === 'binding_mismatch' || inspection.request.status !== 'executed') {
                input.onFailed?.('approval_binding_mismatch');
                return 'consumed';
            }

            const outputSchema = getActionSpec(input.actionId).outputSchema;
            const output = outputSchema?.safeParse(inspection.request.execution?.result);
            if (!output?.success) {
                input.onFailed?.('invalid_action_output');
                return 'consumed';
            }
            try {
                await input.onSucceeded(output.data);
            } catch {
                input.onFailed?.('operation_failed');
            }
            return 'consumed';
        },
        onTerminal: (status, artifact) => {
            if (status === 'invalid') {
                input.onFailed?.('approval_invalid');
                return;
            }
            if (!artifact) {
                input.onFailed?.(`approval_${status}`);
                return;
            }
            const inspection = inspectActionApprovalRequest({
                artifact,
                artifactId: input.artifactId,
                actionId: input.actionId,
                scope: input.scope,
                ...(expectedInputCanonical !== undefined ? { expectedInputCanonical } : {}),
                ...(input.expectedRequestId !== undefined ? { expectedRequestId: input.expectedRequestId } : {}),
            });
            if (inspection.kind === 'different_artifact') return;
            if (inspection.kind === 'invalid_artifact') {
                input.onFailed?.('approval_invalid');
                return;
            }
            if (inspection.kind === 'binding_mismatch' || inspection.request.status !== status) {
                input.onFailed?.('approval_binding_mismatch');
                return;
            }
            const failure = status === 'failed'
                ? readApprovalExecutionFailure(inspection.request)
                : null;
            input.onFailed?.(failure?.errorCode ?? `approval_${status}`, failure ?? undefined);
        },
    });
}

/** Home/Team callers retain their narrower compile-time Action family. */
export function createHomeActionApprovalContinuation<
    TValue,
    TActionId extends HomeDomainActionIdV1,
>(input: CreateActionApprovalContinuationInput<TValue, TActionId>): ActionApprovalContinuation {
    return createActionApprovalContinuation(input);
}
