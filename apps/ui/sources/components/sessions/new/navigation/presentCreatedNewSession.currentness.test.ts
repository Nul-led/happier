import { describe, expect, it, vi } from 'vitest';

const scope = vi.hoisted(() => ({ accountId: 'account-a' }));

vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerSnapshot: () => ({ serverId: 'server-a' }),
    isAppliedActiveServerRuntimeAvailable: () => true,
}));

vi.mock('@/sync/domains/state/storageStateReaderBridge', () => ({
    readRegisteredStorageState: () => ({ profileScope: { serverId: 'server-a', accountId: scope.accountId } }),
}));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        storage: {
            getState: () => ({ sessions: { 'session-a': {} } }),
        },
    });
});

vi.mock('@/sync/sync', () => ({
    sync: {
        ensureSessionVisibleForMessageRoute: async () => {
            scope.accountId = 'account-b';
            return { kind: 'available' };
        },
    },
}));

describe('presentCreatedNewSession currentness', () => {
    it('does not navigate or acknowledge when the Account changes while route visibility resolves', async () => {
        scope.accountId = 'account-a';
        const { presentCreatedNewSession } = await import('./presentCreatedNewSession');
        const router = { replace: vi.fn() };

        await expect(presentCreatedNewSession({
            sessionId: 'session-a',
            serverId: 'server-a',
            accountId: 'account-a',
            requestId: 'request-a',
            router,
            isStillActive: () => true,
        })).resolves.toBe('inactive');
        expect(router.replace).not.toHaveBeenCalled();
    });
});
