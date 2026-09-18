import { describe, expect, it, vi } from 'vitest';

const resolveContext = vi.hoisted(() => vi.fn());
const emitWithAck = vi.hoisted(() => vi.fn());
const disconnect = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@/auth/storage/tokenStorage', () => ({
    subscribeHomeCredentialMutations: () => () => undefined,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolveServerAccountRequestContext', () => ({
    resolveServerAccountRequestContext: resolveContext,
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createEphemeralServerSocketClient', () => ({
    createEphemeralServerSocketClient: vi.fn(async () => ({
        emitWithAck,
        timeout: () => ({ emitWithAck }),
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        getSocketId: () => 'socket-b',
        disconnect,
    })),
}));

describe('emitSessionReadCursorUpdateWithServerScope', () => {
    it('routes the mutation through the captured Home after the active Home changes', async () => {
        resolveContext.mockResolvedValue({
            scope: 'scoped',
            timeoutMs: 1_000,
            targetServerId: 'home-b',
            targetServerUrl: 'https://home-b.example',
            targetAccountId: 'account-b',
            token: 'token-b',
            encryption: null,
            release,
        });
        emitWithAck.mockResolvedValue({ result: 'success', lastViewedSessionSeq: 4 });

        const { emitSessionReadCursorUpdateWithServerScope } = await import('./emitSessionReadCursorUpdateWithServerScope');
        await expect(emitSessionReadCursorUpdateWithServerScope(
            { serverId: 'home-b', sessionId: 'same-session' },
            4,
        )).resolves.toEqual({ result: 'success', lastViewedSessionSeq: 4 });

        expect(resolveContext).toHaveBeenCalledWith({ serverId: 'home-b', preferScoped: true });
        expect(emitWithAck).toHaveBeenCalledWith('update-read-cursor', {
            sid: 'same-session',
            lastViewedSessionSeq: 4,
        });
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
    });
});
