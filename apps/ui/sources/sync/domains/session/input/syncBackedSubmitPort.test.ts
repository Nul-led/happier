import { describe, expect, it, vi } from 'vitest';

const updatePendingRequestedAction = vi.hoisted(() => vi.fn(async () => undefined));
const isSessionTargetRemoteToActiveServer = vi.hoisted(() => vi.fn(() => true));
const sessionSwitch = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@/sync/ops', () => ({ ensureSessionRuntimeForPendingInput: vi.fn(), sessionSwitch }));
vi.mock('@/sync/sync', () => ({
    sync: {
        abortSession: vi.fn(),
        updatePendingRequestedAction,
        enqueuePendingMessage: vi.fn(),
        encryption: { getMachineEncryption: vi.fn() },
        refreshSessionForSubmit: vi.fn(),
        isSessionTargetRemoteToActiveServer,
        sendMessage: vi.fn(),
    },
}));

describe('createSyncBackedSubmitPort', () => {
    it('forwards the canonical Pending row action mutation', async () => {
        const { createSyncBackedSubmitPort } = await import('./syncBackedSubmitPort');
        const port = createSyncBackedSubmitPort();
        const accountLifetime = {
            scope: { serverId: 'server-1', accountId: 'account-1' },
            isCurrent: () => true,
            onRetire: () => ({ dispose() {} }),
        };
        await port.updatePendingRequestedAction?.(
            'session-1',
            'local-1',
            { v: 1, kind: 'steer_now' },
            { serverId: 'server-1', accountLifetime },
        );
        expect(updatePendingRequestedAction).toHaveBeenCalledWith(
            'session-1',
            'local-1',
            { v: 1, kind: 'steer_now' },
            { serverId: 'server-1', accountLifetime },
        );
        expect(port.isSessionTargetRemoteToActiveServer('session-1')).toBe(true);
        expect(isSessionTargetRemoteToActiveServer).toHaveBeenCalledWith('session-1');

        await port.switchSessionControlToRemote?.('session-1', {
            serverId: 'server-1',
            accountLifetime,
        });
        expect(sessionSwitch).toHaveBeenCalledWith('session-1', 'remote', {
            serverId: 'server-1',
            accountLifetime,
        });
    });
});
