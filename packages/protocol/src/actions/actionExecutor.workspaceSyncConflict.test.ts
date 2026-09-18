import { describe, expect, it, vi } from 'vitest';

import { createActionExecutor } from './actionExecutor.js';
import type { ActionExecutorDeps } from './executor/types.js';

const input = {
  controllerMachineId: 'machine-a',
  request: {
    relationshipId: 'relationship-1',
    path: 'src/index.ts',
    keep: 'alpha' as const,
    expectedKind: 'file' as const,
    expectedDigest: 'a'.repeat(40),
  },
};

describe('workspace.sync.conflict.resolve Action authority', () => {
  it('forces canonical deferred approval and replays the approved artifact receipt', async () => {
    const approvals = new Map<string, Record<string, unknown>>();
    const workspaceSyncConflictResolve = vi.fn(async () => ({
      relationshipId: 'relationship-1', controllerMachineId: 'machine-a', state: 'watching' as const,
      alphaPath: '/alpha', betaPath: '/beta', mode: 'keep_both_in_sync' as const,
      changedFiles: 0, conflictCount: 0, lastSuccessfulSyncAtMs: 1,
    }));
    const executor = createActionExecutor({
      workspaceSyncConflictResolve,
      isActionApprovalRequired: () => false,
      approvalsCreate: async ({ request }) => {
        approvals.set('approval-1', request as unknown as Record<string, unknown>);
        return { artifactId: 'approval-1' };
      },
      approvalsGet: async ({ artifactId }) => approvals.get(artifactId) as never,
      approvalsUpdate: async ({ artifactId, request }) => {
        approvals.set(artifactId, request as unknown as Record<string, unknown>);
        return { ok: true as const };
      },
      isApprovalExecutionOriginCurrent: async () => true,
    } as unknown as ActionExecutorDeps);

    await expect(executor.execute('workspace.sync.conflict.resolve', input, {
      surface: 'ui', authority: 'present_user', serverId: 'server-1', actionRequestId: 'conflict-request-1',
    })).resolves.toEqual({
      ok: true,
      result: { kind: 'approval_request_created', artifactId: 'approval-1', actionId: 'workspace.sync.conflict.resolve' },
    });
    expect(workspaceSyncConflictResolve).not.toHaveBeenCalled();

    const decision = await executor.execute('approval.request.decide', {
      artifactId: 'approval-1', decision: 'approve',
    }, { surface: 'ui', authority: 'present_user', serverId: 'server-1' });
    expect(decision).toMatchObject({
      ok: true,
      result: { ok: true, status: 'executed', execution: { ok: true } },
    });
    expect(approvals.get('approval-1')).toMatchObject({ status: 'executed', execution: { ok: true } });
    expect(workspaceSyncConflictResolve).toHaveBeenCalledWith({
      actionReceiptId: 'approval-1', input,
    });
  });

  it('cannot execute through an approval bypass without an Action receipt', async () => {
    const workspaceSyncConflictResolve = vi.fn();
    const executor = createActionExecutor({ workspaceSyncConflictResolve } as unknown as ActionExecutorDeps);
    await expect(executor.execute('workspace.sync.conflict.resolve', input, {
      surface: 'ui', authority: 'present_user', bypassApprovals: true,
    })).resolves.toEqual({ ok: false, errorCode: 'approval_stale', error: 'approval_stale' });
    expect(workspaceSyncConflictResolve).not.toHaveBeenCalled();
  });
});
