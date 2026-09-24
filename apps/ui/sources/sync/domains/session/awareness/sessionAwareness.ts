import {
    projectSessionAwarenessV1,
    readSessionTerminalControlServiceabilityStateV1,
    readSessionWorkStateV1FromMetadata,
    resolveAwarenessCurrentnessV1,
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
    const controlState = readSessionTerminalControlServiceabilityStateV1(
        hydrated ? ownerMetadata?.terminal?.controlServiceabilityV1 : metadata?.terminalControlServiceabilityV1,
    );
    const workflow = hydrated ? SessionWorkflowActivityHeadlineV1Schema.safeParse(ownerMetadata?.sessionWorkflowActivityHeadlineV1) : null;
    const fork = hasReadableMetadata
        ? hydrated ? presentationMetadata?.forkV1 : session.forkV1
        : undefined;
    const components = toAwarenessRuntimeInput({
        ...session,
        hasPendingPermissionRequests,
        hasPendingUserActionRequests,
        hasPendingUserMessages: options.hasPendingUserMessages ?? (session.pendingCount ?? 0) > 0,
        optimisticThinkingAt: session.optimisticThinkingAt ?? options.optimisticPendingUserMessageAt,
        controlServiceability: controlState === 'unknown' ? null : controlState,
        pendingRequestObservedAt: options.pendingRequestObservedAt ?? (hydrated ? deriveLatestPendingRequestObservedAtFromSession(session, []) : session.pendingRequestObservedAt),
    });
    return {
        sessionId: session.id,
        nowMs,
        title: readSessionDisplayTitleField({ metadata }).value ?? metadata?.name,
        ...components,
        content: readUiSessionContentAvailability(session),
        work: hydrated ? metadata ? readSessionWorkStateV1FromMetadata(metadata) : null : session.workState,
        workflowHeadline: hydrated ? workflow?.success ? workflow.data : null : session.workflowHeadline,
        workspace: metadata ? { path: metadata.path, machineId: metadata.machineId ?? undefined } : null,
        lineage: fork ? { relation: 'fork', sourceSessionId: fork.parentSessionId } : null,
        currentness: resolveAwarenessCurrentnessV1({
            lifecycle: components.lifecycle,
            runtime: components.runtime,
            pending: hasPendingOptionsEvidence || hasPendingProjectionEvidence ? 'observed' : 'unavailable',
            work: metadata ? 'observed' : 'unavailable',
        }),
    };
}

export function projectUiSessionAwareness(
    session: Session | SessionListRenderableSession,
    nowMs: number,
    options?: UiSessionAwarenessOptions,
): SessionAwarenessProjectionV1 {
    return projectSessionAwarenessV1(createUiSessionAwarenessInput(session, nowMs, options));
}
