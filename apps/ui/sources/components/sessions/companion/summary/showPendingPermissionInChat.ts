import { buildMessageRouteId } from '@happier-dev/session-core/messages';

import {
    awaitTranscriptNavigationJumpHandler,
    readTranscriptNavigationJumpHandler,
} from '@/components/sessions/transcript/navigation/transcriptNavigationPaneStore';
import type { TranscriptNavigationEntry } from '@/components/sessions/transcript/navigation/transcriptNavigationTypes';
import { storage } from '@/sync/domains/state/storage';

/**
 * "Show in chat" for a waiting ask: land the transcript on the tool call that
 * asked, through the transcript's ONE jump owner (the handler it publishes for
 * the Navigate pane and trail), with the same jump highlight. The Companion adds
 * no second scroll path; a host that must first reveal the transcript (the phone)
 * passes `revealTranscript`, exactly like the Navigate pane.
 */
export function resolvePendingPermissionJumpEntry(
    sessionId: string,
    requestId: string,
): TranscriptNavigationEntry | null {
    const loaded = storage.getState().sessionMessages[sessionId];
    if (!loaded) return null;
    for (let index = loaded.messageIdsOldestFirst.length - 1; index >= 0; index -= 1) {
        const message = loaded.messagesById[loaded.messageIdsOldestFirst[index]!];
        if (message?.kind !== 'tool-call' || message.tool.permission?.id !== requestId) continue;
        const routeMessageId = buildMessageRouteId(message);
        if (!routeMessageId) return null;
        return {
            id: `permission:${requestId}`,
            sessionId,
            seq: typeof message.seq === 'number' ? message.seq : null,
            routeMessageId,
            transcriptBlockIndex: typeof message.transcriptBlockIndex === 'number' ? message.transcriptBlockIndex : null,
            kind: 'deep-link-target',
            role: 'tool',
            label: message.tool.name,
            promptPreview: null,
            responsePreview: null,
            createdAtMs: message.createdAt,
            pinned: false,
            pinnedAtMs: null,
            loaded: true,
        };
    }
    return null;
}

export function showPendingPermissionInChat(input: Readonly<{
    sessionId: string;
    requestId: string;
    revealTranscript?: () => void;
}>): void {
    const entry = resolvePendingPermissionJumpEntry(input.sessionId, input.requestId);
    if (!input.revealTranscript) {
        if (entry) void readTranscriptNavigationJumpHandler(input.sessionId)?.(entry);
        return;
    }
    input.revealTranscript();
    if (!entry) return;
    void awaitTranscriptNavigationJumpHandler(input.sessionId).then((handler) => handler?.(entry));
}
