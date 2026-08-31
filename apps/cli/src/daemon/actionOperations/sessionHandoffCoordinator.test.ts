import { describe, expect, it, vi } from 'vitest';

import { coordinateTrackedSessionHandoff } from './sessionHandoffCoordinator';
import { computeWorkspaceSyncPolicyDigest } from '@/workspaces/sync/workspaceSyncTypes';

const allFilesPolicyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [],
  extraIncludePatterns: [],
  includeGitDirectory: false,
};
const allFilesContentPolicy = {
  ...allFilesPolicyInput,
  policyDigest: computeWorkspaceSyncPolicyDigest(allFilesPolicyInput),
};

const status = (phase: 'preparing' | 'staging_target' | 'finalizing', state: 'in_progress' | 'ready_for_cutover' | 'completed' = 'in_progress') => ({
  handoffId: 'handoff-1',
  status: state,
  phase,
  transportStrategy: 'server_routed_stream',
  recoveryActions: [],
});

const started = {
  handoffId: 'handoff-1',
  status: status('preparing'),
  endpointCandidates: [],
  targetPath: '/repo',
};

const prepared = {
  handoffId: 'handoff-1',
  status: status('staging_target', 'ready_for_cutover'),
  remoteSessionId: 'remote-1',
  directSource: { kind: 'claudeConfig', configDir: null, projectId: null },
  resume: {
    directory: '/repo',
    agent: 'claude',
    resume: 'remote-1',
    transcriptStorage: 'persisted',
    approvedNewDirectoryCreation: true,
  },
};

function createDeps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      start: vi.fn(async () => ({ ok: true as const, result: started })),
      resolveSource: vi.fn(async () => ({
        ok: true as const,
        sourceMachineId: 'source-machine',
        sessionStorageMode: 'persisted' as const,
      })),
      prepareTarget: vi.fn(async () => {
        calls.push('prepare');
        return prepared;
      }),
      getPreparedTargetResult: vi.fn(async () => prepared),
      getTargetStatus: vi.fn(async () => ({
        handoffId: 'handoff-1',
        transitionRevision: 1,
        status: status('staging_target'),
      })),
      resumeTarget: vi.fn(async () => {
        calls.push('resume');
        return { ok: true as const };
      }),
      confirmTarget: vi.fn(async () => {
        calls.push('confirm');
        return { ok: true as const };
      }),
      commitTarget: vi.fn(async () => {
        calls.push('commit-target');
        return { handoffId: 'handoff-1', status: status('finalizing', 'completed') };
      }),
      cleanupSource: vi.fn(async () => {
        calls.push('cleanup-source');
        return { handoffId: 'handoff-1', status: status('finalizing', 'completed') };
      }),
      abort: vi.fn(async () => undefined),
      publishOwnerUpdate: vi.fn(),
      wait: vi.fn(async () => undefined),
      ...overrides,
    },
  };
}

describe('tracked session handoff coordinator', () => {
  it('fails closed before stopping the source when a canonical workspace action has no production adapter', async () => {
    const { deps } = createDeps();

    const result = await coordinateTrackedSessionHandoff({
      input: {
        operationId: 'action-request-1',
        sessionId: 'session-1',
        targetMachineId: 'target-machine',
        workspaceAction: {
          kind: 'copy_once',
          contentPolicy: allFilesContentPolicy,
        },
        workspaceSyncSourceRootPath: '/source/repo',
        workspaceSyncTargetRootPath: '/target/repo',
        workspaceSyncSourceWorkspaceRefId: 'source-ref',
        workspaceSyncTargetWorkspaceRefId: 'target-ref',
      },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: 'workspace_sync_unavailable',
      error: 'workspace_sync_unavailable',
    });
    expect(deps.start).not.toHaveBeenCalled();
    expect(deps.prepareTarget).not.toHaveBeenCalled();
  });

  it('owns the full parent sequence and publishes the handoff id before settlement', async () => {
    const { deps, calls } = createDeps();
    const result = await coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(result).toMatchObject({ ok: true, result: { handoffId: 'handoff-1' } });
    expect(calls).toEqual(['prepare', 'resume', 'confirm', 'commit-target', 'cleanup-source']);
    expect(deps.publishOwnerUpdate).toHaveBeenCalledWith(expect.objectContaining({
      domainRef: { kind: 'handoff', id: 'handoff-1', targetMachineId: 'target-machine' },
    }));
    const phases = deps.publishOwnerUpdate.mock.calls
      .map(([update]) => update.progress?.phase)
      .filter(Boolean);
    expect(phases).toEqual([
      'packaging_session_state',
      'preparing_target',
      'resuming_target',
      'confirming_target',
      'committing_target',
      'cleaning_source',
    ]);
  });

  it('uses an explicitly selected target directory instead of the source-derived path', async () => {
    const { deps } = createDeps();

    await coordinateTrackedSessionHandoff({
      input: {
        sessionId: 'session-1',
        targetMachineId: 'target-machine',
        targetPath: '/home/guest/workspace',
      },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(deps.prepareTarget).toHaveBeenCalledWith(expect.objectContaining({
      targetPath: '/home/guest/workspace',
    }), expect.any(AbortSignal));
  });

  it('polls a pending prepare result and never treats nested ok:false as success', async () => {
    const { deps } = createDeps({
      prepareTarget: vi.fn(async () => ({ handoffId: 'handoff-1', status: status('staging_target') })),
      getPreparedTargetResult: vi.fn()
        .mockResolvedValueOnce({ ok: false, errorCode: 'not_found' })
        .mockResolvedValueOnce(prepared),
    });
    const result = await coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    });
    expect(result.ok).toBe(true);
    expect(deps.getPreparedTargetResult).toHaveBeenCalledTimes(2);
    expect(deps.wait).toHaveBeenCalledTimes(1);
  });

  it('projects authoritative workspace byte transfer into the parent action operation', async () => {
    const transferStatus = {
      ...status('staging_target'),
      progress: {
        updatedAtMs: 123,
        checkpoint: 'transfer_blobs' as const,
        planned: { totalFiles: 4, totalBytes: 4096 },
        transferred: { files: 2, bytes: 1024, blobs: 1 },
        current: { relativePath: 'src/index.ts' },
        resumable: true,
      },
    };
    const { deps } = createDeps({
      prepareTarget: vi.fn(async () => ({ handoffId: 'handoff-1', status: transferStatus })),
      getPreparedTargetResult: vi.fn()
        .mockResolvedValueOnce({ ok: false, errorCode: 'not_found' })
        .mockResolvedValueOnce(prepared),
      getTargetStatus: vi.fn(async () => ({ handoffId: 'handoff-1', transitionRevision: 1, status: transferStatus })),
    });

    await coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(deps.publishOwnerUpdate).toHaveBeenCalledWith({
      progress: {
        current: 1024,
        total: 4096,
        phase: 'workspace_transfer_blobs',
        label: 'Transferring workspace · src/index.ts',
      },
    });
  });

  it('projects authoritative session bundle byte transfer into the parent action operation', async () => {
    const transferStatus = {
      ...status('staging_target'),
      progress: {
        updatedAtMs: 123,
        checkpoint: 'import_session',
        planned: { totalBytes: 4096 },
        transferred: { bytes: 1024 },
        current: { phaseDetail: 'transferring_session' },
        resumable: false,
      },
    };
    const { deps } = createDeps({
      prepareTarget: vi.fn(async () => ({ handoffId: 'handoff-1', status: transferStatus })),
      getPreparedTargetResult: vi.fn(async () => prepared),
      getTargetStatus: vi.fn(async () => ({ handoffId: 'handoff-1', transitionRevision: 1, status: transferStatus })),
    });

    await coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(deps.publishOwnerUpdate).toHaveBeenCalledWith({
      progress: {
        phase: 'session_transfer',
        current: 1024,
        total: 4096,
        label: 'Transferring session data',
      },
    });
  });

  it('waits for explicit user Resume and continues the parent sequence exactly once after recovery', async () => {
    let releaseWait: (() => void) | undefined;
    const waitForResume = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    const getPreparedTargetResult = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        errorCode: 'awaiting_user_resume',
        error: 'Prepare-target job is awaiting_user_resume',
      })
      .mockResolvedValueOnce(prepared);
    const { deps, calls } = createDeps({
      prepareTarget: vi.fn(async () => ({
        handoffId: 'handoff-1',
        status: status('staging_target'),
      })),
      getPreparedTargetResult,
      getTargetStatus: vi.fn(async () => ({
        handoffId: 'handoff-1',
        transitionRevision: 7,
        status: {
          ...status('staging_target'),
          jobId: 'prepare_handoff-1',
          status: 'awaiting_user_resume',
        },
      })),
      wait: vi.fn(async () => await waitForResume),
    });

    let settled = false;
    const resultPromise = coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    }).finally(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(deps.publishOwnerUpdate).toHaveBeenCalledWith({
        progress: {
          phase: 'awaiting_user_resume',
          label: 'Waiting for Resume',
        },
      });
    });
    expect(settled).toBe(false);
    expect(deps.prepareTarget).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);

    releaseWait?.();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(getPreparedTargetResult).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['resume', 'confirm', 'commit-target', 'cleanup-source']);
    expect(deps.resumeTarget).toHaveBeenCalledTimes(1);
    expect(deps.confirmTarget).toHaveBeenCalledTimes(1);
    expect(deps.commitTarget).toHaveBeenCalledTimes(1);
    expect(deps.cleanupSource).toHaveBeenCalledTimes(1);
  });

  it('fails instead of polling forever when both prepare result and canonical target status are lost', async () => {
    const { deps } = createDeps({
      prepareTarget: vi.fn(async () => ({ ok: false, errorCode: 'not_found', error: 'pending' })),
      getPreparedTargetResult: vi.fn(async () => ({ ok: false, errorCode: 'not_found' })),
      getTargetStatus: vi.fn(async () => ({ ok: false, errorCode: 'not_found' })),
    });

    const result = await coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: 'not_found',
      error: 'not_found',
    });
    expect(deps.wait).not.toHaveBeenCalled();
    expect(deps.resumeTarget).not.toHaveBeenCalled();
    expect(deps.abort).toHaveBeenCalledTimes(2);
  });

  it('aborts both sides after a target failure', async () => {
    const { deps } = createDeps({
      resumeTarget: vi.fn(async () => ({ ok: false, errorCode: 'resume_failed', error: 'resume_failed' })),
    });
    const result = await coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    });
    expect(result).toEqual({ ok: false, errorCode: 'resume_failed', error: 'resume_failed' });
    expect(deps.abort).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'target-machine' }));
    expect(deps.abort).toHaveBeenCalledWith(expect.objectContaining({ machineId: 'source-machine' }));
  });

  it('compensates a committed workspace operation when target commit fails', async () => {
    const workspaceSyncAdapter = {
      prepare: vi.fn(async (input: { operationId: string; action: { kind: 'copy_once' } }) => ({
        kind: input.action.kind,
        operationId: input.operationId,
        action: input.action,
      })),
      finalize: vi.fn(async (input: { operationId: string }) => ({
        kind: 'copy_once' as const,
        operationId: input.operationId,
      })),
      commit: vi.fn(async (input: { operationId: string }) => ({
        kind: 'copy_once' as const,
        operationId: input.operationId,
      })),
      abort: vi.fn(async () => undefined),
    };
    const { deps } = createDeps({
      workspaceSyncAdapter,
      commitTarget: vi.fn(async () => ({
        ok: false,
        errorCode: 'target_commit_failed',
        error: 'target_commit_failed',
      })),
    });

    const result = await coordinateTrackedSessionHandoff({
      input: {
        operationId: 'action-request-1',
        sessionId: 'session-1',
        targetMachineId: 'target-machine',
        workspaceAction: {
          kind: 'copy_once',
          contentPolicy: allFilesContentPolicy,
        },
        workspaceSyncSourceRootPath: '/source/repo',
        workspaceSyncTargetRootPath: '/target/repo',
        workspaceSyncSourceWorkspaceRefId: 'source-ref',
        workspaceSyncTargetWorkspaceRefId: 'target-ref',
      },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: 'target_commit_failed',
      error: 'target_commit_failed',
    });
    expect(workspaceSyncAdapter.commit).not.toHaveBeenCalled();
    expect(workspaceSyncAdapter.abort).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'action-request-1',
    }));
  });

  it('finalizes workspace bytes after source quiescence and before target preparation or resume', async () => {
    const calls: string[] = [];
    const workspaceSyncAdapter = {
      prepare: vi.fn(async (input: { operationId: string; action: { kind: 'copy_once' } }) => {
        calls.push('workspace-prepare');
        return {
          kind: input.action.kind,
          operationId: input.operationId,
          action: input.action,
        };
      }),
      finalize: vi.fn(async (input: { operationId: string }) => {
        calls.push('workspace-finalize');
        return { kind: 'copy_once' as const, operationId: input.operationId };
      }),
      commit: vi.fn(async (input: { operationId: string }) => {
        calls.push('workspace-commit');
        return { kind: 'copy_once' as const, operationId: input.operationId };
      }),
      abort: vi.fn(async () => undefined),
    };
    const { deps } = createDeps({
      workspaceSyncAdapter,
      start: vi.fn(async () => {
        calls.push('source-quiesced');
        return { ok: true as const, result: started };
      }),
      prepareTarget: vi.fn(async () => {
        calls.push('target-prepare');
        return prepared;
      }),
      resumeTarget: vi.fn(async () => {
        calls.push('target-resume');
        return { ok: true as const };
      }),
      confirmTarget: vi.fn(async () => {
        calls.push('target-confirm');
        return { ok: true as const };
      }),
      commitTarget: vi.fn(async () => {
        calls.push('target-commit');
        return { handoffId: 'handoff-1', status: status('finalizing', 'completed') };
      }),
    });

    const result = await coordinateTrackedSessionHandoff({
      input: {
        operationId: 'action-request-1',
        sessionId: 'session-1',
        targetMachineId: 'target-machine',
        workspaceAction: {
          kind: 'copy_once',
          contentPolicy: allFilesContentPolicy,
        },
        workspaceSyncSourceRootPath: '/source/repo',
        workspaceSyncTargetRootPath: '/target/repo',
        workspaceSyncSourceWorkspaceRefId: 'source-ref',
        workspaceSyncTargetWorkspaceRefId: 'target-ref',
      },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'workspace-prepare',
      'source-quiesced',
      'workspace-finalize',
      'target-prepare',
      'target-resume',
      'target-confirm',
      'target-commit',
      'workspace-commit',
    ]);
    expect(workspaceSyncAdapter.prepare).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'action-request-1',
      sourceWorkspaceRefId: 'source-ref',
      targetWorkspaceRefId: 'target-ref',
    }));
  });

  it('releases a prepared workspace when cancellation happens before a handoff id exists', async () => {
    const controller = new AbortController();
    const workspaceSyncAdapter = {
      prepare: vi.fn(async (input: { operationId: string; action: { kind: 'copy_once' } }) => ({
        kind: input.action.kind,
        operationId: input.operationId,
        action: input.action,
      })),
      finalize: vi.fn(),
      commit: vi.fn(),
      abort: vi.fn(async () => undefined),
    };
    const { deps } = createDeps({
      workspaceSyncAdapter,
      start: vi.fn(async () => await new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      })),
    });
    const operation = coordinateTrackedSessionHandoff({
      input: {
        operationId: 'action-request-before-start',
        sessionId: 'session-1',
        targetMachineId: 'target-machine',
        workspaceAction: {
          kind: 'copy_once',
          contentPolicy: allFilesContentPolicy,
        },
        workspaceSyncSourceRootPath: '/source/repo',
        workspaceSyncTargetRootPath: '/target/repo',
        workspaceSyncSourceWorkspaceRefId: 'source-ref',
        workspaceSyncTargetWorkspaceRefId: 'target-ref',
      },
      signal: controller.signal,
      ...deps,
    });
    await vi.waitFor(() => expect(workspaceSyncAdapter.prepare).toHaveBeenCalledTimes(1));
    controller.abort(new Error('cancel'));

    await expect(operation).resolves.toEqual({ ok: false, errorCode: 'cancelled', error: 'cancelled' });
    expect(workspaceSyncAdapter.abort).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'action-request-before-start',
    }));
    expect(deps.abort).not.toHaveBeenCalled();
  });

  it('acknowledges cancellation only after both handoff owners report aborted', async () => {
    const controller = new AbortController();
    const { deps } = createDeps({
      prepareTarget: vi.fn(async () => ({ handoffId: 'handoff-1', status: status('staging_target') })),
      getPreparedTargetResult: vi.fn(async () => ({ ok: false, errorCode: 'not_found' })),
      wait: vi.fn(async (signal: AbortSignal) => await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })),
      abort: vi.fn(async () => ({
        handoffId: 'handoff-1',
        status: { ...status('staging_target'), status: 'aborted' },
      })),
    });
    const operation = coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: controller.signal,
      ...deps,
    });
    await vi.waitFor(() => expect(deps.wait).toHaveBeenCalled());
    const reason = new Error('cancel');
    reason.name = 'AbortError';
    controller.abort(reason);

    await expect(operation).resolves.toEqual({ ok: false, errorCode: 'cancelled', error: 'cancelled' });
    expect(deps.abort).toHaveBeenCalledTimes(2);
  });

  it('fails cancellation when either handoff owner does not acknowledge abort', async () => {
    const controller = new AbortController();
    const abort = vi.fn()
      .mockResolvedValueOnce({
        handoffId: 'handoff-1',
        status: { ...status('staging_target'), status: 'aborted' },
      })
      .mockResolvedValueOnce({ ok: false, errorCode: 'not_found' });
    const { deps } = createDeps({
      prepareTarget: vi.fn(async () => ({ handoffId: 'handoff-1', status: status('staging_target') })),
      getPreparedTargetResult: vi.fn(async () => ({ ok: false, errorCode: 'not_found' })),
      wait: vi.fn(async (signal: AbortSignal) => await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })),
      abort,
    });
    const operation = coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: controller.signal,
      ...deps,
    });
    await vi.waitFor(() => expect(deps.wait).toHaveBeenCalled());
    const reason = new Error('cancel');
    reason.name = 'AbortError';
    controller.abort(reason);

    await expect(operation).resolves.toEqual({
      ok: false,
      errorCode: 'session_handoff_cancellation_unconfirmed',
      error: 'session_handoff_cancellation_unconfirmed',
    });
    expect(abort).toHaveBeenCalledTimes(2);
  });

  it('keeps target-commit success when source cleanup returns a nested failure', async () => {
    const { deps } = createDeps({
      cleanupSource: vi.fn(async () => ({ ok: false, errorCode: 'cleanup_failed', error: 'cleanup_failed' })),
    });
    const result = await coordinateTrackedSessionHandoff({
      input: { sessionId: 'session-1', targetMachineId: 'target-machine' },
      signal: new AbortController().signal,
      ...deps,
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        handoffId: 'handoff-1',
        warning: { code: 'source_cleanup_failed', message: 'cleanup_failed' },
      },
    });
  });

  it('keeps target-commit success when workspace authority cleanup fails after commit', async () => {
    const workspaceSyncAdapter = {
      prepare: vi.fn(async (input: { operationId: string; action: { kind: 'copy_once' } }) => ({
        kind: input.action.kind,
        operationId: input.operationId,
        action: input.action,
      })),
      finalize: vi.fn(async (input: { operationId: string }) => ({
        kind: 'copy_once' as const,
        operationId: input.operationId,
      })),
      commit: vi.fn(async () => {
        throw Object.assign(new Error('target workspace authority release failed'), { code: 'peer_unavailable' });
      }),
      abort: vi.fn(async () => undefined),
    };
    const { deps } = createDeps({ workspaceSyncAdapter });

    const result = await coordinateTrackedSessionHandoff({
      input: {
        operationId: 'action-request-1',
        sessionId: 'session-1',
        targetMachineId: 'target-machine',
        workspaceAction: {
          kind: 'copy_once',
          contentPolicy: allFilesContentPolicy,
        },
        workspaceSyncSourceRootPath: '/source/repo',
        workspaceSyncTargetRootPath: '/target/repo',
        workspaceSyncSourceWorkspaceRefId: 'source-ref',
        workspaceSyncTargetWorkspaceRefId: 'target-ref',
      },
      signal: new AbortController().signal,
      ...deps,
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        handoffId: 'handoff-1',
        warning: {
          code: 'source_cleanup_failed',
          message: 'target workspace authority release failed',
        },
      },
    });
    expect(deps.cleanupSource).toHaveBeenCalledTimes(1);
    expect(workspaceSyncAdapter.abort).toHaveBeenCalledTimes(1);
  });
});
