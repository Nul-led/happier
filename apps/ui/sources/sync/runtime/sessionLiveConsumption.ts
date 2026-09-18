import { isSessionSurfaceVisible } from '@/sync/domains/session/sessionSurfaceVisibility';
import {
    isSessionFullContentConsumerActive,
    sessionScmMutationSignalWanted,
} from '@/sync/domains/session/realtime/sessionRealtimeVisibility';
import {
    readMountedSessionRealtimeScmConsumerScopes,
    resolveSessionRealtimeScmScopeForMountedConsumers,
} from '@/sync/runtime/sessionRealtimeScmConsumers';
import { readMountedSessionRealtimeTranscriptConsumerSessionIds } from '@/sync/runtime/sessionRealtimeTranscriptConsumers';
import { storage } from '@/sync/domains/state/storage';
import { voiceSessionBindingStore } from '@/voice/binding/voiceConversationBindingStore';
import { useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import {
    areSessionAddressesEqual,
    normalizeSessionAddress,
    type SessionAddress,
} from '@/sync/domains/session/sessionAddress';

export type SessionLiveConsumption = Readonly<{
    isVisible: boolean;
    isFullContentConsumer: boolean;
}>;

function addTrimmedSessionId(ids: string[], value: unknown): void {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) ids.push(trimmed);
}

function resolveSourceSessionAddress(
    sessionId: string,
    sourceServerId?: string | null,
): SessionAddress | null {
    return normalizeSessionAddress(
        sourceServerId ?? getActiveServerSnapshot().serverId,
        sessionId,
    );
}

function readMatchingSessionId(
    address: SessionAddress | null | undefined,
    source: SessionAddress | null,
): string | null {
    return areSessionAddressesEqual(address, source) ? source?.sessionId ?? null : null;
}

function getVoiceBoundTargetSessionIds(source: SessionAddress | null): string[] {
    if (!source) return [];
    const ids: string[] = [];
    for (const binding of voiceSessionBindingStore.getState().list()) {
        if (binding.targetSessionAddress?.serverId !== source.serverId) continue;
        addTrimmedSessionId(ids, binding.targetSessionAddress.sessionId);
        addTrimmedSessionId(ids, binding.conversationSessionId);
        addTrimmedSessionId(ids, binding.controlSessionId);
    }
    return ids;
}

/**
 * Single source of truth for "is this session a live-content consumer right now?".
 *
 * Hidden sessions in the same SCM project scope are intentionally NOT full-content consumers:
 * their workspace-mutation signal is resolved separately via resolveSessionScmMutationSignal
 * and fed from the durable projection path without hydrating their transcripts. Only the
 * mounted SCM consumer's own session (scmSameSession) stays a full-content consumer here.
 */
export function resolveSessionLiveConsumption(
    sessionId: string,
    sourceServerId?: string | null,
): SessionLiveConsumption {
    const visible = isSessionSurfaceVisible(sessionId, sourceServerId);
    const source = resolveSourceSessionAddress(sessionId, sourceServerId);
    const targetState = useVoiceTargetStore.getState();
    const isFullContentConsumer = isSessionFullContentConsumerActive({
        sessionId,
        isVisible: visible,
        explicitTranscriptConsumerSessionIds: readMountedSessionRealtimeTranscriptConsumerSessionIds(sourceServerId),
        voicePrimaryActionSessionId: readMatchingSessionId(targetState.primaryActionSessionAddress, source),
        // Account Follow Include in Voice is a background update/catch-up
        // authority, never a full transcript-consumption reason. The retained
        // compatibility projection likewise cannot hydrate content.
        voiceTrackedSessionIds: [],
        voiceReadbackSessionIds: readMatchingSessionId(targetState.lastFocusedSessionAddress, source)
            ? [source!.sessionId]
            : [],
        voiceBoundTargetSessionIds: getVoiceBoundTargetSessionIds(source),
        scmMountedScopes: readMountedSessionRealtimeScmConsumerScopes(),
    });
    return { isVisible: visible, isFullContentConsumer };
}

/**
 * Whether a mounted SCM consumer wants workspace-mutation signals from this session.
 *
 * Uses the same mounted-scope registry and scope inference as resolveSessionLiveConsumption's
 * SCM reason assembly, so the projection-path mutation side channel can never diverge from the
 * realtime routing facts. Unlike the full-content decision, the (comparatively expensive) hidden
 * session project-scope inference runs only here — once per skipped durable message, never on the
 * per-tick ephemeral path.
 */
export function resolveSessionScmMutationSignal(sessionId: string): boolean {
    const scmMountedScopes = readMountedSessionRealtimeScmConsumerScopes();
    if (scmMountedScopes.length === 0) {
        return false;
    }
    return sessionScmMutationSignalWanted({
        sessionId,
        sessionScmScope: resolveSessionRealtimeScmScopeForMountedConsumers(storage.getState(), sessionId, scmMountedScopes),
        scmMountedScopes,
    });
}
