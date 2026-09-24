import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { buildSessionOrganizationSessionKey } from '@/sync/domains/session/organization';

const mocks = vi.hoisted(() => ({
    setSessionAttentionStanding: vi.fn(),
}));

vi.mock('@/sync/api/session/sessionOrganizationApi', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/api/session/sessionOrganizationApi')>();
    return {
        ...actual,
        setSessionAttentionStanding: mocks.setSessionAttentionStanding,
    };
});

const credentials = { token: 'token-a', secret: 'secret-a' };
const SERVER_ID = 'server-standing-op';
const SESSION_ID = 'session-standing-op';
const SESSION_KEY = buildSessionOrganizationSessionKey(SERVER_ID, SESSION_ID);

describe('setSessionAttentionStanding op', () => {
    let previousState: ReturnType<typeof storage.getState>;

    beforeEach(() => {
        mocks.setSessionAttentionStanding.mockReset();
        previousState = storage.getState();
    });

    afterEach(() => {
        storage.setState(previousState, true);
    });

    it('writes optimistically and then reconciles to the value the server stored', async () => {
        const { setSessionAttentionStanding } = await import('./setSessionAttentionStanding');
        mocks.setSessionAttentionStanding.mockResolvedValueOnce({
            standing: { sessionId: SESSION_ID, standing: true, updatedAt: 4242 },
        });

        await setSessionAttentionStanding({
            credentials,
            serverId: SERVER_ID,
            sessionId: SESSION_ID,
            standing: true,
        });

        expect(mocks.setSessionAttentionStanding).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: SESSION_ID,
            request: { standing: true },
        }));
        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[SESSION_KEY])
            .toEqual({ sessionId: SESSION_ID, standing: true, updatedAt: 4242 });
        expect(Object.keys(storage.getState().sessionOrganizationOptimisticRecords)).toEqual([]);
    });

    it('rolls the optimistic write back when the server rejects it', async () => {
        const { setSessionAttentionStanding } = await import('./setSessionAttentionStanding');
        storage.getState().applySessionOrganizationSnapshot(SERVER_ID, {
            schemaVersion: 1,
            version: 1,
            pins: [],
            folders: [],
            folderAssignments: [],
            tags: [],
            tagAssignments: [],
            orderEntries: [],
            labels: [],
            attentionStandings: [{ sessionId: SESSION_ID, standing: true, updatedAt: 1 }],
        });
        mocks.setSessionAttentionStanding.mockRejectedValueOnce(new Error('offline'));

        await expect(setSessionAttentionStanding({
            credentials,
            serverId: SERVER_ID,
            sessionId: SESSION_ID,
            standing: false,
        })).rejects.toThrow('offline');

        // A failed "remove from Needs attention" must leave the session standing, not fall back to
        // the account default: the previous explicit value is what the user still has.
        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[SESSION_KEY])
            .toEqual({ sessionId: SESSION_ID, standing: true, updatedAt: 1 });
        expect(Object.keys(storage.getState().sessionOrganizationOptimisticRecords)).toEqual([]);
    });

    it('keeps the newer reminder when an older response settles last', async () => {
        const { setSessionAttentionStanding } = await import('./setSessionAttentionStanding');
        const first = createDeferred<{ standing: unknown }>();
        const second = createDeferred<{ standing: unknown }>();
        mocks.setSessionAttentionStanding
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const older = setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: SESSION_ID, remindAt: 2_000 });
        const newer = setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: SESSION_ID, remindAt: 5_000 });

        second.resolve({ standing: { sessionId: SESSION_ID, standing: false, remindAt: 5_000, updatedAt: 9 } });
        await newer;
        first.resolve({ standing: { sessionId: SESSION_ID, standing: false, remindAt: 2_000, updatedAt: 2 } });
        await older;

        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[SESSION_KEY])
            .toMatchObject({ remindAt: 5_000 });
    });

    it('keeps another session\'s committed standing when a sibling mutation rolls back', async () => {
        const { setSessionAttentionStanding } = await import('./setSessionAttentionStanding');
        const otherSessionId = 'session-standing-op-other';
        const otherKey = buildSessionOrganizationSessionKey(SERVER_ID, otherSessionId);
        const failing = createDeferred<{ standing: unknown }>();
        mocks.setSessionAttentionStanding
            .mockReturnValueOnce(failing.promise)
            .mockResolvedValueOnce({ standing: { sessionId: otherSessionId, standing: true, updatedAt: 7 } });

        const rejected = setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: SESSION_ID, standing: true });
        await setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: otherSessionId, standing: true });
        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[otherKey])
            .toEqual({ sessionId: otherSessionId, standing: true, updatedAt: 7 });

        failing.reject(new Error('offline'));
        await expect(rejected).rejects.toThrow('offline');

        // The failed mutation undoes its own key only; the sibling Session's committed standing
        // is not part of what it wrote.
        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[otherKey])
            .toEqual({ sessionId: otherSessionId, standing: true, updatedAt: 7 });
        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[SESSION_KEY]).toBeUndefined();
    });

    it('keeps a newer confirmed reminder when the older mutation for the same Session fails', async () => {
        const { setSessionAttentionStanding } = await import('./setSessionAttentionStanding');
        const older = createDeferred<{ standing: unknown }>();
        mocks.setSessionAttentionStanding
            .mockReturnValueOnce(older.promise)
            .mockResolvedValueOnce({ standing: { sessionId: SESSION_ID, standing: false, remindAt: 5_000, updatedAt: 9 } });

        const rejected = setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: SESSION_ID, remindAt: 2_000 });
        await setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: SESSION_ID, remindAt: 5_000 });
        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[SESSION_KEY])
            .toMatchObject({ remindAt: 5_000 });

        older.reject(new Error('offline'));
        await expect(rejected).rejects.toThrow('offline');

        // The failed write no longer owns this key: the newer confirmed reminder does, so the
        // rollback must not revert to the value that was current before the failed write.
        expect(storage.getState().sessionOrganizationAttentionStandingsBySessionKey[SESSION_KEY])
            .toMatchObject({ remindAt: 5_000 });
    });

    it('changes only the reminder field when scheduling and clearing', async () => {
        const { setSessionAttentionStanding } = await import('./setSessionAttentionStanding');
        mocks.setSessionAttentionStanding
            .mockResolvedValueOnce({ standing: { sessionId: SESSION_ID, standing: true, remindAt: 2_000, updatedAt: 2 } })
            .mockResolvedValueOnce({ standing: { sessionId: SESSION_ID, standing: true, updatedAt: 3 } });

        await setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: SESSION_ID, remindAt: 2_000 });
        await setSessionAttentionStanding({ credentials, serverId: SERVER_ID, sessionId: SESSION_ID, remindAt: null });

        expect(mocks.setSessionAttentionStanding).toHaveBeenNthCalledWith(1, expect.objectContaining({ request: { remindAt: 2_000 } }));
        expect(mocks.setSessionAttentionStanding).toHaveBeenNthCalledWith(2, expect.objectContaining({ request: { remindAt: null } }));
    });
});
