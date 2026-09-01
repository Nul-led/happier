import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

const openSessionHandoffPickerMock = vi.hoisted(() => vi.fn());
const executeSessionHandoffActionMock = vi.hoisted(() => vi.fn());
const modalConfirmMock = vi.hoisted(() => vi.fn());
const readSessionHandoffSessionActivityMock = vi.hoisted(() => vi.fn());
const releaseUserRequestLeaseMock = vi.hoisted(() => vi.fn());
const acquireUserRequestLeaseMock = vi.hoisted(() => vi.fn(() => releaseUserRequestLeaseMock));

vi.mock('@/components/sessions/handoff/openSessionHandoffPicker', () => ({
    openSessionHandoffPicker: (...args: unknown[]) => openSessionHandoffPickerMock(...args),
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { confirm: (...args: unknown[]) => modalConfirmMock(...args) } }).module;
});
vi.mock('./readSessionHandoffSessionActivity', () => ({
    readSessionHandoffSessionActivity: (...args: unknown[]) => readSessionHandoffSessionActivityMock(...args),
}));
vi.mock('./executeSessionHandoffAction', () => ({
    executeSessionHandoffAction: (...args: unknown[]) => executeSessionHandoffActionMock(...args),
}));
vi.mock('@/sync/sync', () => ({
    sync: { acquireUserRequestLease: acquireUserRequestLeaseMock },
}));

const policyFields = {
    v: 1 as const,
    selection: 'git_worktree' as const,
    extraIgnorePatterns: [],
    extraIncludePatterns: [],
    includeGitDirectory: false,
};
const contentPolicy = { ...policyFields, policyDigest: computeWorkspaceSyncPolicyDigest(policyFields) };

describe('runSessionHandoffPickerFlow', () => {
    beforeEach(() => {
        openSessionHandoffPickerMock.mockReset();
        executeSessionHandoffActionMock.mockReset();
        modalConfirmMock.mockReset();
        readSessionHandoffSessionActivityMock.mockReset();
        readSessionHandoffSessionActivityMock.mockReturnValue({ active: false });
        acquireUserRequestLeaseMock.mockClear();
        releaseUserRequestLeaseMock.mockClear();
    });

    it('returns null when the picker is dismissed', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce(null);
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await expect(runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_1', sourceMachineId: 'source', serverId: 'server', placement: 'session_info',
        })).resolves.toBeNull();
        expect(executeSessionHandoffActionMock).not.toHaveBeenCalled();
    });

    it('submits relationship creation intent without generating identity or writing settings', async () => {
        const workspaceAction = { kind: 'create_relationship' as const, mode: 'keep_synced' as const, contentPolicy, flushBeforeCommit: true as const };
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'target', targetPath: '/target/repo', sourceRootPath: '/source/repo',
            targetSessionStorageMode: 'persisted', workspaceAction,
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff_1' });
        const execute = vi.fn();
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await runSessionHandoffPickerFlow({
            execute, sessionId: 'sess_1', sourceMachineId: 'source', serverId: 'server', placement: 'session_action_menu',
        });

        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith(expect.objectContaining({
            execute,
            sessionId: 'sess_1',
            targetMachineId: 'target',
            targetPath: '/target/repo',
            workspaceAction,
        }));
        expect(executeSessionHandoffActionMock).toHaveBeenCalledTimes(1);
        expect(modalConfirmMock).not.toHaveBeenCalled();
    });

    it('requires destination-specific confirmation before mirror intent is submitted', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'target-id', targetMachineLabel: 'Build Mac', targetPath: '/target/repo', sourceRootPath: '/source/repo',
            workspaceAction: { kind: 'create_relationship', mode: 'mirror_exactly', contentPolicy, flushBeforeCommit: true },
        });
        modalConfirmMock.mockResolvedValueOnce(false);
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await expect(runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_1', sourceMachineId: 'source-id', serverId: 'server', placement: 'session_info',
        })).resolves.toEqual({ ok: false, handled: true });

        expect(modalConfirmMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('/target/repo'),
            expect.objectContaining({ destructive: true }),
        );
        expect(modalConfirmMock.mock.calls[0]?.[1]).toContain('Build Mac');
        expect(modalConfirmMock.mock.calls[0]?.[1]).toContain('/source/repo');
        expect(executeSessionHandoffActionMock).not.toHaveBeenCalled();
        expect(acquireUserRequestLeaseMock).not.toHaveBeenCalled();
    });

    it('shows only the combined destination-specific mirror confirmation', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'target-id',
            targetMachineLabel: 'Build Mac',
            targetPath: '/target/repo',
            sourceRootPath: '/source/repo',
            workspaceAction: {
                kind: 'create_relationship',
                mode: 'mirror_exactly',
                contentPolicy,
                flushBeforeCommit: true,
            },
        });
        modalConfirmMock.mockResolvedValue(true);
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: true, handoffId: 'handoff_1' });
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_1', sourceMachineId: 'source-id', serverId: 'server', placement: 'session_info',
        });

        expect(modalConfirmMock).toHaveBeenCalledTimes(1);
        expect(modalConfirmMock.mock.calls[0]?.[1]).toContain('/target/repo');
        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith(expect.objectContaining({
            workspaceAction: expect.not.objectContaining({ destructiveTargetReuseApproved: true }),
        }));
    });
});
