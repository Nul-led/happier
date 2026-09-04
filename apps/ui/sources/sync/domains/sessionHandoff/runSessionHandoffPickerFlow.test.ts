import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

const openSessionHandoffPickerMock = vi.hoisted(() => vi.fn());
const executeSessionHandoffActionMock = vi.hoisted(() => vi.fn());
const releaseUserRequestLeaseMock = vi.hoisted(() => vi.fn());
const acquireUserRequestLeaseMock = vi.hoisted(() => vi.fn(() => releaseUserRequestLeaseMock));
const presentationRegisterMock = vi.hoisted(() => vi.fn());
const progressCloseMock = vi.hoisted(() => vi.fn());
const openObservedProgressMock = vi.hoisted(() => vi.fn(() => ({
    close: progressCloseMock,
    isAttached: () => true,
})));

vi.mock('@/components/sessions/handoff/openSessionHandoffPicker', () => ({
    openSessionHandoffPicker: (...args: unknown[]) => openSessionHandoffPickerMock(...args),
}));
vi.mock('./executeSessionHandoffAction', () => ({
    executeSessionHandoffAction: (...args: unknown[]) => executeSessionHandoffActionMock(...args),
}));
vi.mock('@/sync/sync', () => ({
    sync: { acquireUserRequestLease: acquireUserRequestLeaseMock },
}));
vi.mock('@/components/inbox/actionOperations/actionOperationPresentationRuntime', () => ({
    actionOperationPresentationCoordinator: { register: presentationRegisterMock },
}));
vi.mock('@/components/sessions/handoff/openSessionHandoffProgressModal', () => ({
    openObservedSessionHandoffProgressModal: (...args: unknown[]) => openObservedProgressMock(...args),
}));

const policyFields = {
    v: 1 as const,
    selection: 'git_worktree' as const,
    extraIgnorePatterns: [],
    extraIncludePatterns: [],
};
const contentPolicy = { ...policyFields, policyDigest: computeWorkspaceSyncPolicyDigest(policyFields) };
const completedStatus = {
    handoffId: 'handoff_1',
    status: 'completed' as const,
    phase: 'finalizing' as const,
    recoveryActions: [],
};
const completedResult = (workspace: { kind: 'none' } | {
    kind: 'relationship'; relationshipId: string; created: boolean;
    cleanupWarning?: { code: string; message: string };
} = { kind: 'none' as const }) => ({
    ok: true as const,
    result: { handoffId: 'handoff_1', status: completedStatus, workspace },
});

describe('runSessionHandoffPickerFlow', () => {
    beforeEach(() => {
        openSessionHandoffPickerMock.mockReset();
        executeSessionHandoffActionMock.mockReset();
        acquireUserRequestLeaseMock.mockClear();
        releaseUserRequestLeaseMock.mockClear();
        presentationRegisterMock.mockReset();
        progressCloseMock.mockReset();
        openObservedProgressMock.mockClear();
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
        executeSessionHandoffActionMock.mockResolvedValueOnce(completedResult());
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
    });

    it('submits an ordinary active-session handoff without a second generic confirmation', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'target',
            targetSessionStorageMode: 'persisted',
            workspaceAction: { kind: 'none' },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce(completedResult());
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_active', sourceMachineId: 'source', serverId: 'server', placement: 'session_action_menu',
        });

        expect(executeSessionHandoffActionMock).toHaveBeenCalledTimes(1);
    });

    it('opens one live progress surface and registers the same surface for active-operation reentry', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'target',
            targetSessionStorageMode: 'persisted',
            workspaceAction: { kind: 'none' },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce(completedResult());
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_1', sourceMachineId: 'source', serverId: 'server', placement: 'session_info',
        });

        expect(openObservedProgressMock).toHaveBeenCalledWith(expect.objectContaining({
            requestId: expect.any(String),
            sessionId: 'sess_1',
            workspaceSyncEnabled: false,
        }));
        expect(presentationRegisterMock).toHaveBeenCalledWith(expect.objectContaining({
            requestId: expect.any(String),
            onStart: 'current',
            origin: expect.objectContaining({ resolve: expect.any(Function) }),
        }));
        const registration = presentationRegisterMock.mock.calls[0]?.[0];
        const running = { state: 'running' } as const;
        const succeeded = { state: 'succeeded' } as const;
        const reopen = registration.origin.resolve(running);
        expect(reopen).toEqual(expect.any(Function));
        reopen();
        expect(openObservedProgressMock).toHaveBeenCalledTimes(2);
        expect(registration.origin.resolve(succeeded)).toBeNull();
        expect(progressCloseMock).toHaveBeenCalledTimes(1);
    });

    it('leaves the single mirror confirmation to the daemon-bound Action approval', async () => {
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
        executeSessionHandoffActionMock.mockResolvedValueOnce(completedResult());
        const execute = vi.fn();
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await runSessionHandoffPickerFlow({
            execute, sessionId: 'sess_1', sourceMachineId: 'source-id', serverId: 'server', placement: 'session_info',
        });

        // The destination approval is stamped by the target daemon inside the
        // Action corridor, so the picker must not raise its own unbound prompt.
        expect(executeSessionHandoffActionMock).toHaveBeenCalledTimes(1);
        expect(executeSessionHandoffActionMock).toHaveBeenCalledWith(expect.objectContaining({
            execute,
            targetMachineId: 'target-id',
            targetPath: '/target/repo',
            workspaceAction: expect.objectContaining({ mode: 'mirror_exactly' }),
        }));
        expect(executeSessionHandoffActionMock.mock.calls[0]?.[0]?.workspaceAction)
            .not.toHaveProperty('destructiveTargetReuseApproved');
    });

    it('confirms the daemon-owned committed workspace outcome on the same progress surface', async () => {
        const workspaceAction = { kind: 'create_relationship' as const, mode: 'keep_synced' as const, contentPolicy, flushBeforeCommit: true as const };
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'target', targetPath: '/target/repo', workspaceAction,
        });
        const workspace = {
            kind: 'relationship' as const,
            relationshipId: 'relationship-1',
            created: true,
            cleanupWarning: { code: 'staging_release_failed', message: 'Staging could not be released.' },
        };
        executeSessionHandoffActionMock.mockResolvedValueOnce(completedResult(workspace));
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        const result = await runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_1', sourceMachineId: 'source', serverId: 'server', placement: 'session_info',
        });

        expect(result).toEqual(completedResult(workspace));
        expect(progressCloseMock).not.toHaveBeenCalled();
    });

    it('closes the progress surface when the daemon reports no workspace outcome', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({
            targetMachineId: 'target', workspaceAction: { kind: 'none' },
        });
        executeSessionHandoffActionMock.mockResolvedValueOnce(completedResult());
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_1', sourceMachineId: 'source', serverId: 'server', placement: 'session_info',
        });

        expect(progressCloseMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the canonical progress surface attached when the handoff fails', async () => {
        openSessionHandoffPickerMock.mockResolvedValueOnce({ targetMachineId: 'target', workspaceAction: { kind: 'none' } });
        executeSessionHandoffActionMock.mockResolvedValueOnce({ ok: false, error: 'target_unavailable' });
        const { runSessionHandoffPickerFlow } = await import('./runSessionHandoffPickerFlow');

        await expect(runSessionHandoffPickerFlow({
            execute: vi.fn(), sessionId: 'sess_1', sourceMachineId: 'source', serverId: 'server', placement: 'session_info',
        })).resolves.toEqual({ ok: false, error: 'target_unavailable' });

        expect(progressCloseMock).not.toHaveBeenCalled();
    });
});
