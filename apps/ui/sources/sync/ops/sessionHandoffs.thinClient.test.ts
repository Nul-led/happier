import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

const machineRpc = vi.hoisted(() => vi.fn());
const machineTarget = vi.hoisted(() => vi.fn());

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: machineRpc,
}));
vi.mock('./sessionMachineTarget', () => ({
    readMachineControlTargetForSession: machineTarget,
}));
vi.mock('../domains/state/storage', () => ({
    storage: { getState: () => ({ sessions: {} }) },
}));
vi.mock('../domains/session/readSessionOwnerMetadataView', () => ({
    readSessionOwnerMetadataView: () => null,
}));

describe('session handoff UI request client', () => {
    beforeEach(() => {
        vi.resetModules();
        machineRpc.mockReset();
        machineTarget.mockReturnValue({ machineId: 'source-1' });
    });

    it('sends one coordinator request and returns its terminal result without client phase work', async () => {
        const policyFields = {
            v: 1 as const,
            selection: 'git_worktree' as const,
            extraIgnorePatterns: [],
            extraIncludePatterns: [],
            includeGitDirectory: false,
        };
        machineRpc.mockResolvedValueOnce({
            ok: true,
            handoffId: 'handoff-1',
            status: { handoffId: 'handoff-1', status: 'completed', phase: 'finalizing', recoveryActions: [] },
        });
        const { startSessionHandoff } = await import('./sessionHandoffs');
        await expect(startSessionHandoff({
            sessionId: 'session-1',
            targetMachineId: 'target-1',
            serverId: 'server-1',
            sessionStorageMode: 'persisted',
            workspaceAction: {
                kind: 'create_relationship',
                mode: 'keep_synced',
                contentPolicy: {
                    ...policyFields,
                    policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
                },
                flushBeforeCommit: true,
            },
        })).resolves.toMatchObject({ ok: true, handoffId: 'handoff-1' });
        expect(machineRpc).toHaveBeenCalledTimes(1);
        expect(machineRpc).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'source-1',
            method: 'daemon.sessionHandoff.start.v3',
            serverId: 'server-1',
            payload: expect.objectContaining({
                sessionId: 'session-1',
                targetMachineId: 'target-1',
                accountServerId: 'server-1',
                workspaceAction: expect.objectContaining({
                    kind: 'create_relationship',
                    mode: 'keep_synced',
                }),
            }),
        }));
    });

    it('exposes typed status and cancellation requests as thin owner commands', async () => {
        machineRpc
            .mockResolvedValueOnce({ status: { handoffId: 'handoff-1', status: 'awaiting_recovery', phase: 'finalizing', recoveryActions: [] } })
            .mockResolvedValueOnce({ status: { handoffId: 'handoff-1', status: 'aborted', phase: 'finalizing', recoveryActions: [] } });
        const { getSessionHandoffStatus, cancelSessionHandoff } = await import('./sessionHandoffs');
        await expect(getSessionHandoffStatus({ machineId: 'target-1', handoffId: 'handoff-1', serverId: 'server-1' })).resolves.toMatchObject({ ok: true, status: { status: 'awaiting_recovery' } });
        await expect(cancelSessionHandoff({ machineId: 'target-1', handoffId: 'handoff-1', serverId: 'server-1' })).resolves.toMatchObject({ ok: true, status: { status: 'aborted' } });
        expect(machineRpc).toHaveBeenNthCalledWith(1, expect.objectContaining({ method: 'daemon.sessionHandoff.status.get.v3', payload: { handoffId: 'handoff-1' } }));
        expect(machineRpc).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: 'daemon.sessionHandoff.abort.v3', payload: { handoffId: 'handoff-1', reason: 'user_cancelled' } }));
    });
});
