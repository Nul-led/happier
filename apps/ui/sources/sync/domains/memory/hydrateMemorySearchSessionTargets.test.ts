import { describe, expect, it, vi } from 'vitest';

const storageState = vi.hoisted(() => ({
    sessions: {} as Record<string, { id: string; serverId?: string } | undefined>,
}));

vi.mock('@/sync/domains/state/storageStore', () => ({
    storage: { getState: () => storageState },
}));

const {
    hasLocalMemorySearchSessionForServerScope,
    hydrateMemorySearchSessionTargets,
} = await import('./hydrateMemorySearchSessionTargets');

const TARGETS = [
    { sessionKey: 'server-a:local-1', serverId: 'server-a', sessionId: 'local-1' },
    { sessionKey: 'server-a:outside-1', serverId: 'server-a', sessionId: 'outside-1' },
] as const;

describe('hydrateMemorySearchSessionTargets', () => {
    it('hydrates hits outside the local projection through the explicit-server reader', async () => {
        const readSessionForServerScope = vi.fn(async () => ({ ok: true }));

        const authorized = await hydrateMemorySearchSessionTargets({
            targets: TARGETS,
            hasLocalSession: (target) => target.sessionId === 'local-1',
            readSessionForServerScope,
        });

        expect(readSessionForServerScope).toHaveBeenCalledTimes(1);
        expect(readSessionForServerScope).toHaveBeenCalledWith(
            expect.objectContaining({ serverId: 'server-a', sessionId: 'outside-1' }),
        );
        expect(authorized.map((target) => target.sessionId)).toEqual(['local-1', 'outside-1']);
    });

    it('suppresses a stale row when the explicit-server read finds no authorization or existence', async () => {
        const authorized = await hydrateMemorySearchSessionTargets({
            targets: TARGETS,
            hasLocalSession: (target) => target.sessionId === 'local-1',
            readSessionForServerScope: async () => ({ ok: false, errorCode: 'session_not_found' }),
        });

        expect(authorized.map((target) => target.sessionId)).toEqual(['local-1']);
    });

    it('suppresses a stale row when the explicit-server read fails', async () => {
        const authorized = await hydrateMemorySearchSessionTargets({
            targets: TARGETS,
            hasLocalSession: () => false,
            readSessionForServerScope: async () => {
                throw new Error('offline');
            },
        });

        expect(authorized).toEqual([]);
    });

    it('never reads for a target the local projection already authorizes', async () => {
        const readSessionForServerScope = vi.fn(async () => ({ ok: true }));

        await hydrateMemorySearchSessionTargets({
            targets: TARGETS,
            hasLocalSession: () => true,
            readSessionForServerScope,
        });

        expect(readSessionForServerScope).not.toHaveBeenCalled();
    });

    it('stops hydrating once the caller cancels', async () => {
        const controller = new AbortController();
        const readSessionForServerScope = vi.fn(async () => {
            controller.abort();
            return { ok: true };
        });

        const authorized = await hydrateMemorySearchSessionTargets({
            targets: [
                { sessionKey: 'server-a:a', serverId: 'server-a', sessionId: 'a' },
                { sessionKey: 'server-a:b', serverId: 'server-a', sessionId: 'b' },
            ],
            hasLocalSession: () => false,
            readSessionForServerScope,
            signal: controller.signal,
        });

        expect(readSessionForServerScope).toHaveBeenCalledTimes(1);
        expect(authorized.map((target) => target.sessionId)).toEqual(['a']);
    });
});

describe('hasLocalMemorySearchSessionForServerScope', () => {
    it('does not accept a same-id session held for another server', () => {
        storageState.sessions = { 'session-1': { id: 'session-1', serverId: 'server-b' } };

        expect(hasLocalMemorySearchSessionForServerScope({
            sessionKey: 'server-a:session-1',
            serverId: 'server-a',
            sessionId: 'session-1',
        })).toBe(false);
    });

    it('accepts the session held for the hit own server scope', () => {
        storageState.sessions = { 'session-1': { id: 'session-1', serverId: 'server-a' } };

        expect(hasLocalMemorySearchSessionForServerScope({
            sessionKey: 'server-a:session-1',
            serverId: 'server-a',
            sessionId: 'session-1',
        })).toBe(true);
    });

    it('reports absence when the projection holds no such session', () => {
        storageState.sessions = {};

        expect(hasLocalMemorySearchSessionForServerScope({
            sessionKey: 'server-a:session-1',
            serverId: 'server-a',
            sessionId: 'session-1',
        })).toBe(false);
    });

    it('does not let an unscoped legacy record authorize an explicit server target', () => {
        storageState.sessions = { 'session-1': { id: 'session-1' } };

        expect(hasLocalMemorySearchSessionForServerScope({
            sessionKey: 'server-b:session-1',
            serverId: 'server-b',
            sessionId: 'session-1',
        })).toBe(false);
    });
});
