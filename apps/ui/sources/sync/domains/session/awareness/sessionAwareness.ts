import {
    normalizeAwarenessSequenceV1,
    projectSessionAwarenessV1,
    readSessionWorkStateV1FromMetadata,
    SessionWorkflowActivityHeadlineV1Schema,
    type ProjectSessionAwarenessV1Input,
    type SessionContentAvailabilityInputV1,
    type SessionAwarenessProjectionV1,
} from '@happier-dev/protocol';
import type { Session } from '@/sync/domains/state/storageTypes';
import { readSessionDisplayTitleField } from '@/sync/state/selectors';
import { readSessionListRenderableSourceMetadata, type SessionListRenderableSession } from '../listing/sessionListRenderable';
import { deriveLatestPendingRequestObservedAtFromSession, derivePendingRequestFlagsFromSession } from '../pending/listPendingSessionRequests';
import { readSessionOwnerMetadataView } from '../readSessionOwnerMetadataView';
import { toAwarenessRuntimeInput } from '../attention/runtimePresentation';

export type UiSessionAwarenessOptions = Readonly<{
    hasPendingUserMessages?: boolean;
    optimisticPendingUserMessageAt?: number | null;
    hasPendingPermissionRequests?: boolean;
    hasPendingUserActionRequests?: boolean;
    pendingRequestObservedAt?: number | null;
}>;

function readUiSessionContentAvailability(
    session: Session | SessionListRenderableSession,
): SessionContentAvailabilityInputV1 {
    if (session.encryptionMode === 'plain') return { mode: 'plain' };
    switch (session.encryptedContentAvailability) {
        case 'ready':
            return { mode: 'e2ee', keyState: 'opened' };
        case 'encrypted_access_pending':
            return { mode: 'e2ee', keyState: 'access_pending' };
        case 'encrypted_access_needs_repair':
            return { mode: 'e2ee', keyState: 'inconsistent' };
        case 'encrypted_content_unavailable':
            return { mode: 'e2ee', keyState: 'content_unavailable' };
        case 'recipient_encryption_setup_required':
            return { mode: 'e2ee', keyState: 'setup_required' };
        default:
            return { mode: 'e2ee', keyState: 'unknown' };
    }
}

/** Adapt already opened UI facts; Protocol owns every operational decision. */
export function createUiSessionAwarenessInput(
    session: Session | SessionListRenderableSession,
    nowMs: number,
    options: UiSessionAwarenessOptions = {},
): ProjectSessionAwarenessV1Input {
    const hydrated = 'agentState' in session;
    const ownerMetadata = hydrated ? readSessionOwnerMetadataView(session) : null;
    const presentationMetadata = hydrated ? readSessionListRenderableSourceMetadata(session) : null;
    const hasReadableMetadata = !('metadataUnavailable' in session && session.metadataUnavailable === true);
    const metadata = hasReadableMetadata
        ? hydrated ? presentationMetadata : session.metadata
        : null;
    const pending = hydrated ? derivePendingRequestFlagsFromSession(session, []) : session;
    const hasRuntimeProjectionEvidence = session.presence !== undefined
        || typeof session.active === 'boolean'
        || typeof session.thinking === 'boolean'
        || session.runtimeActivityState != null
        || typeof session.runtimeActivityActiveCount === 'number';
    const hasPendingPermissionRequests = options.hasPendingPermissionRequests ?? pending.hasPendingPermissionRequests;
    const hasPendingUserActionRequests = options.hasPendingUserActionRequests ?? pending.hasPendingUserActionRequests;
    const hasPendingOptionsEvidence = options.hasPendingPermissionRequests !== undefined
        && options.hasPendingUserActionRequests !== undefined;
    const hasPendingProjectionEvidence = hydrated
        ? (
            typeof session.pendingPermissionRequestCount === 'number'
            && typeof session.pendingUserActionRequestCount === 'number'
        ) || session.agentState !== null
        : typeof session.hasPendingPermissionRequests === 'boolean'
            && typeof session.hasPendingUserActionRequests === 'boolean';
    const control = hydrated ? ownerMetadata?.terminal?.controlServiceabilityV1 : metadata?.terminalControlServiceabilityV1;
    const workflow = hydrated ? SessionWorkflowActivityHeadlineV1Schema.safeParse(ownerMetadata?.sessionWorkflowActivityHeadlineV1) : null;
    const fork = hasReadableMetadata
        ? hydrated ? presentationMetadata?.forkV1 : session.forkV1
        : undefined;
    return {
        sessionId: session.id,
        nowMs,
        title: readSessionDisplayTitleField({ metadata }).value ?? metadata?.name,
        ...toAwarenessRuntimeInput({
            ...session,
            hasPendingPermissionRequests,
            hasPendingUserActionRequests,
            hasPendingUserMessages: options.hasPendingUserMessages ?? (session.pendingCount ?? 0) > 0,
            optimisticThinkingAt: session.optimisticThinkingAt ?? options.optimisticPendingUserMessageAt,
            controlServiceability: control?.state === 'unknown' ? null : control?.state,
            pendingRequestObservedAt: options.pendingRequestObservedAt ?? (hydrated ? deriveLatestPendingRequestObservedAtFromSession(session, []) : session.pendingRequestObservedAt),
        }),
        content: readUiSessionContentAvailability(session),
        work: hydrated ? metadata ? readSessionWorkStateV1FromMetadata(metadata) : null : session.workState,
        workflowHeadline: hydrated ? workflow?.success ? workflow.data : null : session.workflowHeadline,
        workspace: metadata ? { path: metadata.path, machineId: metadata.machineId ?? undefined } : null,
        lineage: fork ? { relation: 'fork', sourceSessionId: fork.parentSessionId } : null,
        currentness: {
            lifecycle: session.archivedAt != null
                || session.latestTurnStatus !== undefined
                || normalizeAwarenessSequenceV1(session.latestReadyEventSeq) !== null
                ? 'observed'
                : 'unavailable',
            // Runtime component evidence is broader than reachability. Durable `active`, thinking,
            // or provider activity stays observed while absent device presence remains `unknown`.
            runtime: hasRuntimeProjectionEvidence ? 'observed' : 'unavailable',
            pending: hasPendingOptionsEvidence || hasPendingProjectionEvidence ? 'observed' : 'unavailable',
            work: metadata ? 'observed' : 'unavailable',
        },
    };
}

export function projectUiSessionAwareness(
    session: Session | SessionListRenderableSession,
    nowMs: number,
    options?: UiSessionAwarenessOptions,
): SessionAwarenessProjectionV1 {
    return projectSessionAwarenessV1(createUiSessionAwarenessInput(session, nowMs, options));
}
