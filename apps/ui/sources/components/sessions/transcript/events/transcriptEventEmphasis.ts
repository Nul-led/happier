import type { Message } from "@happier-dev/session-core/messages";

export type TranscriptEventEmphasis = 'normal' | 'deemphasized';
export type TranscriptEventEmphasisByMessageId = Readonly<Record<string, TranscriptEventEmphasis>>;

const EMPTY_TRANSCRIPT_EVENT_EMPHASIS_BY_MESSAGE_ID: TranscriptEventEmphasisByMessageId = Object.freeze({});

export function resolveTranscriptEventEmphasisByMessageId(input: Readonly<{
    messageIdsOldestFirst: readonly string[];
    messagesById: Readonly<Record<string, Message>>;
    sessionActive: boolean;
}>): TranscriptEventEmphasisByMessageId {
    if (!input.sessionActive) return EMPTY_TRANSCRIPT_EVENT_EMPHASIS_BY_MESSAGE_ID;

    let latestReadyIndex = -1;
    input.messageIdsOldestFirst.forEach((messageId, index) => {
        const message = input.messagesById[messageId];
        if (message?.kind === 'agent-event' && message.event.type === 'ready') {
            latestReadyIndex = index;
        }
    });
    if (latestReadyIndex < 0) return EMPTY_TRANSCRIPT_EVENT_EMPHASIS_BY_MESSAGE_ID;

    const emphasisByMessageId: Record<string, TranscriptEventEmphasis> = {};
    for (let index = 0; index < latestReadyIndex; index += 1) {
        const messageId = input.messageIdsOldestFirst[index]!;
        const message = input.messagesById[messageId];
        if (message?.kind === 'agent-event' && message.event.type !== 'ready') {
            emphasisByMessageId[messageId] = 'deemphasized';
        }
    }
    return emphasisByMessageId;
}

export type TranscriptHostWakeCountByMessageId = Readonly<Record<string, number>>;

const EMPTY_TRANSCRIPT_HOST_WAKE_COUNT_BY_MESSAGE_ID: TranscriptHostWakeCountByMessageId = Object.freeze({});

function isWorkerUpdateEvent(message: Message | undefined): boolean {
    return message?.kind === 'agent-event' && message.event.type === 'worker-update';
}

/**
 * A context-only wake commits one `worker-update` host event per update, back to back, before the
 * lead's turn. The update that opens such a run carries the run's length so its row can say the
 * session was woken by those updates rather than by the user (ORC R-01, lab D1); the rest carry
 * nothing. Counts are primitives, so an unchanged run keeps every row's props equal.
 */
export function resolveTranscriptHostWakeCountByMessageId(input: Readonly<{
    messageIdsOldestFirst: readonly string[];
    messagesById: Readonly<Record<string, Message>>;
}>): TranscriptHostWakeCountByMessageId {
    let counts: Record<string, number> | null = null;
    let openerId: string | null = null;
    for (const messageId of input.messageIdsOldestFirst) {
        if (!isWorkerUpdateEvent(input.messagesById[messageId])) {
            openerId = null;
            continue;
        }
        counts ??= {};
        if (openerId === null) {
            openerId = messageId;
            counts[messageId] = 1;
        } else {
            counts[openerId] = (counts[openerId] ?? 0) + 1;
        }
    }
    return counts ?? EMPTY_TRANSCRIPT_HOST_WAKE_COUNT_BY_MESSAGE_ID;
}
