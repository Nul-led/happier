import { describe, expect, it } from 'vitest';

import { readStoredSessionMessagesForAddress } from './readStoredSessionMessagesForAddress';

const ROWS = {
    messageIdsOldestFirst: ['m1'],
    messagesById: { m1: { id: 'm1', kind: 'user-text', localId: null, text: 'loaded home secret', createdAt: 1 } },
} as const;

function stateWith(session: { serverId?: string } | null | undefined) {
    return {
        ...(session === undefined ? {} : { sessions: { s1: session } }),
        sessionMessages: { s1: ROWS },
    };
}

describe('readStoredSessionMessagesForAddress', () => {
    it('reads the retained transcript when the stored Session row declares the requested Home', () => {
        expect(
            readStoredSessionMessagesForAddress(
                stateWith({ serverId: 'home-a' }),
                { serverId: 'home-a', sessionId: 's1' },
                { activeServerId: 'home-a' },
            ),
        ).toEqual([ROWS.messagesById.m1]);
    });

    it('treats a stored row without its own Home as belonging to the loaded Home', () => {
        expect(
            readStoredSessionMessagesForAddress(
                stateWith({}),
                { serverId: 'home-a', sessionId: 's1' },
                { activeServerId: 'home-a' },
            ),
        ).toEqual([ROWS.messagesById.m1]);
    });

    it('never discloses another Home transcript for a same-named Session', () => {
        expect(
            readStoredSessionMessagesForAddress(
                stateWith({ serverId: 'home-a' }),
                { serverId: 'home-b', sessionId: 's1' },
                { activeServerId: 'home-a' },
            ),
        ).toEqual([]);
        expect(
            readStoredSessionMessagesForAddress(
                stateWith({}),
                { serverId: 'home-b', sessionId: 's1' },
                { activeServerId: 'home-a' },
            ),
        ).toEqual([]);
    });

    it('refuses when no stored Session row proves the retained transcript Home', () => {
        // The retained transcript map is keyed by bare session id, so the loaded Home
        // alone is a guess: without a stored row there is no Home provenance at all.
        expect(
            readStoredSessionMessagesForAddress(
                stateWith(undefined),
                { serverId: 'home-a', sessionId: 's1' },
                { activeServerId: 'home-a' },
            ),
        ).toEqual([]);
        expect(
            readStoredSessionMessagesForAddress(
                { sessions: { s1: null }, sessionMessages: { s1: ROWS } },
                { serverId: 'home-a', sessionId: 's1' },
                { activeServerId: 'home-a' },
            ),
        ).toEqual([]);
    });

    it('refuses a malformed or absent requested address', () => {
        expect(
            readStoredSessionMessagesForAddress(stateWith({ serverId: 'home-a' }), null, { activeServerId: 'home-a' }),
        ).toEqual([]);
        expect(
            readStoredSessionMessagesForAddress(
                stateWith({ serverId: 'home-a' }),
                { serverId: '  ', sessionId: 's1' },
                { activeServerId: 'home-a' },
            ),
        ).toEqual([]);
    });
});
