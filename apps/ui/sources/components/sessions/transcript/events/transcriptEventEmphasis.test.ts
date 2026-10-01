import { describe, expect, it } from 'vitest';

import type { Message } from "@happier-dev/session-core/messages";

import {
    resolveTranscriptEventEmphasisByMessageId,
    resolveTranscriptHostWakeCountByMessageId,
} from './transcriptEventEmphasis';

function eventMessage(
    id: string,
    event: Extract<Message, { kind: 'agent-event' }>['event'],
): Message {
    return {
        kind: 'agent-event',
        localId: null,
        id,
        createdAt: 1,
        event,
    };
}

function resolve(messages: readonly Message[], sessionActive: boolean) {
    return resolveTranscriptEventEmphasisByMessageId({
        messageIdsOldestFirst: messages.map((message) => message.id),
        messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
        sessionActive,
    });
}

describe('resolveTranscriptEventEmphasisByMessageId', () => {
    it('de-emphasizes only prior-ready-era events while the session is active', () => {
        const emphasis = resolve([
            eventMessage('old-failure', { type: 'message', message: 'Old failure' }),
            eventMessage('ready', { type: 'ready' }),
            eventMessage('current-failure', { type: 'message', message: 'Current failure' }),
        ], true);

        expect(emphasis['old-failure']).toBe('deemphasized');
        expect(emphasis.ready).toBeUndefined();
        expect(emphasis['current-failure']).toBeUndefined();
    });

    it('keeps prior-ready-era events at normal emphasis while the session is inactive', () => {
        const emphasis = resolve([
            eventMessage('old-failure', { type: 'message', message: 'Old failure' }),
            eventMessage('ready', { type: 'ready' }),
        ], false);

        expect(emphasis['old-failure']).toBeUndefined();
    });
});

describe('resolveTranscriptHostWakeCountByMessageId', () => {
    const update = (workerId: string) => ({
        type: 'worker-update', update: {
            v: 1, workerKind: 'session', workerId, ownerState: 'settled', wake: 'finished',
            headline: 'Finished', canInspect: false,
        },
    }) as Extract<Message, { kind: 'agent-event' }>['event'];
    const agentText = (id: string): Message => ({
        kind: 'agent-text', localId: null, id, createdAt: 1, text: 'Reply', isThinking: false,
    } as Message);

    it('counts each run of worker updates once, on the update that opens the wake', () => {
        const messages = [
            eventMessage('a', update('w1')),
            eventMessage('b', update('w2')),
            eventMessage('c', update('w3')),
            agentText('reply'),
            eventMessage('d', update('w4')),
            eventMessage('other', { type: 'message', message: 'Unrelated' }),
        ];
        const counts = resolveTranscriptHostWakeCountByMessageId({
            messageIdsOldestFirst: messages.map((message) => message.id),
            messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
        });

        expect(counts).toEqual({ a: 3, d: 1 });
    });
});
