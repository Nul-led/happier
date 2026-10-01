import { describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import {
  buildTrackedSessionHandoffSpawnOptions,
  createTrackedSessionHandoffCoordinator,
} from './createTrackedSessionHandoffCoordinator';
import {
  computeWorkspaceSyncPolicyDigest,
  type ManagedWorkspaceSync,
  type WorkspaceSyncStatusV1,
} from '@/workspaces/sync/workspaceSyncTypes';
import { createWorkspaceSyncHandoffAdapter } from '@/workspaces/sync/workspaceSyncHandoffAdapter';

describe('createTrackedSessionHandoffCoordinator', () => {
  it('keeps a nested Session directory when an existing all-files relationship is selected', async () => {
    const policyInput = { v: 1 as const, selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [] };
    const policy = { ...policyInput, policyDigest: computeWorkspaceSyncPolicyDigest(policyInput) };
    const flush = vi.fn(async () => ({
      relationshipId: 'source-target', controllerMachineId: 'machine-source', state: 'watching' as const,
      alphaPath: '/source', betaPath: '/target', mode: 'keep_synced' as const,
      endpointStates: {
        alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
        beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
      },
      conflictCount: 0, lastCycleObservedAtMs: null,
    }));
    const workspaceSyncAdapter = createWorkspaceSyncHandoffAdapter({
      sync: { flush } as never,
      relationshipController: { flush },
      bootstrap: async () => ({ release: async () => undefined }),
    });
    const callMachine = vi.fn(async (input: { method: string }) => (
      input.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3
        ? { ok: false, errorCode: 'target_unavailable', error: 'target_unavailable' }
        : { ok: true }
    ));
    const coordinate = createTrackedSessionHandoffCoordinator({
      expectedAccountServerId: 'server-1',
      readCredentials: async () => ({ token: 'token' } as never),
      resolveSource: async () => ({
        ok: true, sourceMachineId: 'machine-source',
        sourceRootPath: '/source/packages/app', sessionStorageMode: 'persisted',
      }),
      refreshWorkspaceSettings: async () => ({ settingsVersion: 1, settings: {
        workspaceRefsV1: [
          { id: 'source', serverId: 'server-1', machineId: 'machine-source', rootPath: '/source', createdAtMs: 1 },
          { id: 'target', serverId: 'server-1', machineId: 'machine-target', rootPath: '/target', createdAtMs: 1 },
        ],
        workspaceSyncRelationshipsV1: [{
          v: 1, relationshipId: 'source-target', controllerMachineId: 'machine-source',
          alphaWorkspaceRefId: 'source', betaWorkspaceRefId: 'target',
          mode: 'keep_synced', contentPolicy: policy, enabled: true, createdAtMs: 1, updatedAtMs: 1,
        }],
      } }),
      workspaceSyncAdapter,
      callMachine,
    });
    const result = await coordinate({
      operationId: 'operation-direct',
      actionInput: {
        sessionId: 'session-1', targetMachineId: 'machine-target', targetPath: '/target',
        workspaceAction: { kind: 'relationship', relationshipId: 'source-target', flushBeforeCommit: true },
      },
      start: async () => ({ ok: true, result: {
        handoffId: 'handoff-direct', targetPath: '/target', endpointCandidates: [],
        status: {
          handoffId: 'handoff-direct', sessionId: 'session-1', sourceMachineId: 'machine-source',
          targetMachineId: 'machine-target', status: 'in_progress', phase: 'preparing',
          transportStrategy: 'server_routed_stream', recoveryActions: [],
        },
      } }),
      signal: new AbortController().signal,
      publishOwnerUpdate: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'target_unavailable' });
    expect(flush).toHaveBeenCalledTimes(2);
    expect(callMachine).toHaveBeenCalledWith(expect.objectContaining({
      method: RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3,
      request: expect.objectContaining({ targetPath: '/target/packages/app' }),
    }));
  });
  it('derives a linked spoke route from the admitted nested Session and keeps the target subdirectory', async () => {
    const basePolicy = { v: 1 as const, selection: 'git_worktree' as const, extraIgnorePatterns: [], extraIncludePatterns: [] };
    const sourcePolicy = { ...basePolicy, policyDigest: computeWorkspaceSyncPolicyDigest(basePolicy) };
    const targetBasePolicy = { ...basePolicy, selection: 'all_files' as const };
    const targetPolicy = { ...targetBasePolicy, policyDigest: computeWorkspaceSyncPolicyDigest(targetBasePolicy) };
    const workspaceSyncAdapter = {
      prepare: vi.fn(async (input: { operationId: string }) => ({ kind: 'linked_workspace' as const, operationId: input.operationId, action: { kind: 'linked_workspace' as const } })),
      finalize: vi.fn(), commit: vi.fn(), abort: vi.fn(async () => undefined),
    };
    const callMachine = vi.fn(async (input: { method: string; request: unknown }) => {
      if (input.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3) {
        return { ok: false, errorCode: 'target_unavailable', error: 'target_unavailable' };
      }
      return { ok: true };
    });
    const coordinate = createTrackedSessionHandoffCoordinator({
      expectedAccountServerId: 'server-1',
      readCredentials: async () => ({ token: 'token' } as never),
      resolveSource: async () => ({ ok: true, sourceMachineId: 'machine-c', sourceRootPath: '/source/packages/app', sessionStorageMode: 'persisted' }),
      refreshWorkspaceSettings: async () => ({ settingsVersion: 1, settings: {
        workspaceRefsV1: [
          { id: 'hub', serverId: 'server-1', machineId: 'machine-a', rootPath: '/hub', createdAtMs: 1 },
          { id: 'source', serverId: 'server-1', machineId: 'machine-c', rootPath: '/source', createdAtMs: 1 },
          { id: 'target', serverId: 'server-1', machineId: 'machine-b', rootPath: '/target', createdAtMs: 1 },
        ],
        workspaceSyncRelationshipsV1: [
          { v: 1, relationshipId: 'a-c', controllerMachineId: 'machine-a', alphaWorkspaceRefId: 'hub', betaWorkspaceRefId: 'source', mode: 'keep_both_in_sync', contentPolicy: sourcePolicy, enabled: true, createdAtMs: 1, updatedAtMs: 1 },
          { v: 1, relationshipId: 'a-b', controllerMachineId: 'machine-a', alphaWorkspaceRefId: 'hub', betaWorkspaceRefId: 'target', mode: 'keep_synced', contentPolicy: targetPolicy, enabled: true, createdAtMs: 1, updatedAtMs: 1 },
        ],
      } }),
      resolveWorkspaceTransferRoot: async () => ({ repositoryRoot: '/source', sessionRelativeCwd: 'packages/app' }),
      workspaceSyncAdapter,
      callMachine,
    });
    const result = await coordinate({
      operationId: 'operation-linked',
      actionInput: { sessionId: 'session-1', targetMachineId: 'machine-b', targetPath: '/target', workspaceAction: { kind: 'linked_workspace' } },
      start: async () => ({ ok: true, result: {
        handoffId: 'handoff-linked', targetPath: '/target', endpointCandidates: [],
        status: { handoffId: 'handoff-linked', sessionId: 'session-1', sourceMachineId: 'machine-c', targetMachineId: 'machine-b', status: 'in_progress', phase: 'preparing', transportStrategy: 'server_routed_stream', recoveryActions: [] },
      } }),
      signal: new AbortController().signal,
      publishOwnerUpdate: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'target_unavailable' });
    expect(workspaceSyncAdapter.prepare).toHaveBeenCalledWith(expect.objectContaining({
      action: { kind: 'linked_workspace' }, sourceWorkspaceRefId: 'source', targetWorkspaceRefId: 'target',
      sourceRootPath: '/source', targetRootPath: '/target',
    }));
    expect(callMachine).toHaveBeenCalledWith(expect.objectContaining({
      method: RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3,
      request: expect.objectContaining({ targetPath: '/target/packages/app', workspaceRootPath: '/target', workspaceSessionRelativeCwd: 'packages/app' }),
    }));
  });

  it('fails closed when a current V3 prepare response omits its qualified Agent target', () => {
    expect(() => buildTrackedSessionHandoffSpawnOptions({
      targetMachineId: 'target-1',
      prepared: {
        handoffId: 'handoff-1',
        status: {} as never,
        resume: {
          directory: '/target/workspace',
          agent: 'codex',
          resume: 'remote-1',
          transcriptStorage: 'persisted',
          approvedNewDirectoryCreation: true,
        },
      } as never,
    })).toThrow();
  });

  it('uses the qualified current Agent target and descriptor for current handoff writes', () => {
    const options = buildTrackedSessionHandoffSpawnOptions({
      targetMachineId: 'target-1',
      prepared: {
        handoffId: 'handoff-current',
        status: {} as never,
        runtimeDescriptorV1: {
          v: 1,
          agentId: 'acme.agent',
          agent: {
            runtime: 'native',
            futureResumeCritical: { opaque: 'preserve-me' },
          },
        },
        resume: {
          directory: '/target/workspace',
          agent: 'acme.agent',
          agentTarget: {
            kind: 'agent',
            identity: { pluginId: 'acme.plugin', localId: 'agent' },
          },
          resume: 'remote-1',
          transcriptStorage: 'persisted',
          approvedNewDirectoryCreation: true,
        },
      },
    });

    expect(options.agentTarget).toEqual({
      kind: 'agent',
      identity: { pluginId: 'acme.plugin', localId: 'agent' },
    });
    expect(options.runtimeDescriptorV1).toEqual({
      v: 1,
      agentId: 'acme.agent',
      agent: {
        runtime: 'native',
        futureResumeCritical: { opaque: 'preserve-me' },
      },
    });
    expect(options).not.toHaveProperty('backendTarget');
  });

  it('admits copy without a replacement approval and returns the typed update requirement for an older target daemon', async () => {
    const policyInput = {
      v: 1 as const,
      selection: 'all_files' as const,
      extraIgnorePatterns: [],
      extraIncludePatterns: [],
    };
    const action = {
      kind: 'copy_once' as const,
      contentPolicy: {
        ...policyInput,
        policyDigest: computeWorkspaceSyncPolicyDigest(policyInput),
      },
    };
    const prepared = { kind: 'copy_once' as const, operationId: 'operation-1', action };
    const workspaceSyncAdapter = {
      prepare: vi.fn(async () => prepared),
      finalize: vi.fn(async () => prepared),
      commit: vi.fn(async () => prepared),
      abort: vi.fn(async () => undefined),
    };
    const callMachine = vi.fn(async () => {
      throw Object.assign(new Error('RPC method not available'), {
        rpcErrorCode: 'RPC_METHOD_NOT_AVAILABLE',
      });
    });
    const coordinate = createTrackedSessionHandoffCoordinator({
      expectedAccountServerId: 'server-1',
      readCredentials: async () => ({ token: 'token' } as never),
      resolveSource: async () => ({
        ok: true,
        sourceMachineId: 'source-1',
        sourceRootPath: '/source/workspace',
        sessionStorageMode: 'persisted',
      }),
      callMachine,
      workspaceSyncAdapter,
    });

    await expect(coordinate({
      operationId: 'operation-1',
      actionInput: {
        sessionId: 'session-1',
        targetMachineId: 'target-1',
        targetPath: '/target/workspace',
        accountServerId: 'server-1',
        workspaceAction: action,
      },
      start: async () => ({
        ok: true,
        result: {
          handoffId: 'handoff-1',
          targetPath: '/target/workspace',
          endpointCandidates: [],
          status: {
            handoffId: 'handoff-1',
            sessionId: 'session-1',
            sourceMachineId: 'source-1',
            targetMachineId: 'target-1',
            status: 'in_progress',
            phase: 'preparing',
            transportStrategy: 'server_routed_stream',
            recoveryActions: [],
          },
        },
      }),
      signal: new AbortController().signal,
      publishOwnerUpdate: vi.fn(),
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'workspace_sync_update_required',
    });
    expect(callMachine).toHaveBeenCalledTimes(3);
    expect(callMachine).toHaveBeenNthCalledWith(1, expect.objectContaining({
      machineId: 'target-1',
      method: RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3,
    }));
  });

  it('routes the accepted handoff through the existing source and target daemon primitives', async () => {
    const calls: Array<{ machineId: string; method: string; request: unknown; timeoutMs?: number }> = [];
    let resultGets = 0;
    const callMachine = vi.fn(async (input: { machineId: string; method: string; request: unknown; timeoutMs?: number }) => {
      calls.push(input);
      if (input.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3) {
        return { ok: false, errorCode: 'not_found', error: 'pending' };
      }
      if (input.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_RESULT_GET_V3) {
        resultGets += 1;
        if (resultGets === 1) return { ok: false, errorCode: 'not_found', error: 'pending' };
        return {
          handoffId: 'handoff-1',
          status: {
            handoffId: 'handoff-1', sessionId: 'session-1', sourceMachineId: 'source-1',
            targetMachineId: 'target-1', status: 'ready_for_cutover', phase: 'staging_target',
            transportStrategy: 'server_routed_stream', recoveryActions: [],
          },
          remoteSessionId: 'remote-1',
          directSource: { kind: 'claudeConfig', configDir: null, projectId: null },
          resume: {
            directory: '/target/workspace', agent: 'claude',
            agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.claude', localId: 'claude' } },
            resume: 'remote-1',
            transcriptStorage: 'persisted', approvedNewDirectoryCreation: true,
          },
        };
      }
      if (input.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_STATUS_GET_V3) {
        return {
          handoffId: 'handoff-1',
          transitionRevision: 3,
          status: {
            handoffId: 'handoff-1', status: 'in_progress', phase: 'staging_target',
            transportStrategy: 'server_routed_stream', recoveryActions: [],
          },
        };
      }
      if (input.method === RPC_METHODS.SPAWN_HAPPY_SESSION) {
        return { type: 'success', spawnNonce: 'handoff:handoff-1', sessionIdStatus: 'pending' };
      }
      if (input.method === RPC_METHODS.DAEMON_SPAWN_SESSION_RESOLVE) {
        return { status: 'success', sessionId: 'session-1' };
      }
      if (input.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_COMMIT_V3) {
        if (input.machineId === 'source-1') {
          return { ok: false, errorCode: 'source_cleanup_busy', error: 'Source cleanup is still pending.' };
        }
        return {
          handoffId: 'handoff-1',
          status: {
            handoffId: 'handoff-1', sessionId: 'session-1', sourceMachineId: 'source-1',
            targetMachineId: 'target-1', status: 'completed', phase: 'finalizing',
            transportStrategy: 'server_routed_stream', recoveryActions: [],
          },
        };
      }
      return { ok: true };
    });
    const policyInput = {
      v: 1 as const,
      selection: 'git_worktree' as const,
      extraIgnorePatterns: [],
      extraIncludePatterns: [],
    };
    const contentPolicy = {
      ...policyInput,
      policyDigest: computeWorkspaceSyncPolicyDigest(policyInput),
    };
    const approval = {
      v: 1 as const,
      consequences: [
        'replace_nonempty_workspace_target',
        'delete_target_only_files_during_exact_mirror',
      ] as const,
      serverId: 'server-1',
      machineId: 'target-1',
      canonicalRoot: '/target/workspace',
      rootFingerprint: 'a'.repeat(64),
      operationId: 'action-request-1',
    };
    const relationshipStatus: WorkspaceSyncStatusV1 = {
      relationshipId: 'relationship-1',
      controllerMachineId: 'source-1',
      state: 'watching',
      alphaPath: '/source/workspace',
      betaPath: '/target/workspace',
      mode: 'mirror_exactly',
      endpointStates: {
        alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
        beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
      },
      conflictCount: 0,
      lastCycleObservedAtMs: 1,
    };
    const sync: ManagedWorkspaceSync = {
      resolveLocalResolutionEndpoint: vi.fn(async () => null),
      borrowSourceRootForCopy: vi.fn(async () => null),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      subscribe: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
      ensure: vi.fn(async () => relationshipStatus),
      copyOnce: vi.fn(async () => relationshipStatus),
      flush: vi.fn(async () => relationshipStatus),
      pause: vi.fn(async () => ({ ...relationshipStatus, state: 'paused' as const })),
      resume: vi.fn(async () => relationshipStatus),
      terminate: vi.fn(async () => undefined),
      listConflicts: vi.fn(async () => ({
        status: 'page' as const,
        relationshipId: 'relationship-1',
        totalCount: 0,
        nextCursor: null,
        conflicts: [],
      })),
      listRelationships: vi.fn(async () => { throw new Error('unexpected relationship inspection'); }),
      inspectConflict: vi.fn(async () => { throw new Error('unexpected conflict inspection'); }),
      resolveConflict: vi.fn(async () => { throw new Error('unexpected conflict resolution'); }),
      readFile: vi.fn(async () => ({ status: 'missing' as const })),
      withAuthorizedSourceSeedExport: vi.fn(async (_request, exportSource) => await exportSource('/source/workspace')),
      withSourceSeedAuthorization: vi.fn(async (_operation, _handles, action) => await action()),
    } satisfies ManagedWorkspaceSync;
    const relationship = {
      v: 1 as const,
      relationshipId: 'relationship-1',
      controllerMachineId: 'source-1',
      alphaWorkspaceRefId: 'source-ref',
      betaWorkspaceRefId: 'target-ref',
      mode: 'mirror_exactly' as const,
      contentPolicy,
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const prepareCreate = vi.fn(async () => ({
      relationship,
      status: relationshipStatus,
      reused: false as const,
      commit: vi.fn(async () => relationship),
      abort: vi.fn(async () => undefined),
    }));
    const workspaceSyncAdapter = createWorkspaceSyncHandoffAdapter({
      sync,
      relationshipOwner: { materializeEndpoints: vi.fn(), prepareCreate },
      bootstrap: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    });
    const refreshWorkspaceSettings = vi.fn(async () => ({
      settingsVersion: 8,
      settings: {
        workspaceRefsV1: [
          { id: 'source-ref', serverId: 'server-1', machineId: 'source-1', rootPath: '/source/workspace', createdAtMs: 1 },
          { id: 'target-ref', serverId: 'server-1', machineId: 'target-1', rootPath: '/target/workspace', createdAtMs: 1 },
        ],
        workspaceSyncRelationshipsV1: [],
      },
    }));
    const coordinate = createTrackedSessionHandoffCoordinator({
      expectedAccountServerId: 'server-1',
      readCredentials: async () => ({ token: 'token' } as never),
      resolveSource: async () => ({
        ok: true,
        sourceMachineId: 'source-1',
        sourceRootPath: '/source/workspace/packages/app',
        sessionStorageMode: 'persisted',
      }),
      callMachine,
      wait: async () => undefined,
      workspaceSyncAdapter,
      refreshWorkspaceSettings,
      resolveWorkspaceTransferRoot: async () => ({
        repositoryRoot: '/source/workspace',
        sessionRelativeCwd: 'packages/app',
      }),
    });

    let privateStartInput: unknown;
    const result = await coordinate({
      operationId: 'action-request-1',
      actionInput: {
        sessionId: 'session-1',
        targetMachineId: 'target-1',
        targetPath: '/target/workspace',
        accountServerId: 'server-1',
        actionRequestId: 'action-request-1',
        handoffTargetReplacementApproval: approval,
        handoffTargetReplacementApprovalReceiptId: 'approval-receipt-1',
        handoffTargetReplacementApprovalActionInput: {
          sessionId: 'session-1', targetMachineId: 'target-1', targetPath: '/target/workspace',
        },
        workspaceAction: {
          kind: 'create_relationship',
          mode: 'mirror_exactly',
          contentPolicy,
          flushBeforeCommit: true,
        },
      },
      start: async (input?: unknown) => {
        privateStartInput = input;
        return {
          ok: true as const,
          result: {
            handoffId: 'handoff-1', targetPath: '/source/workspace', endpointCandidates: [],
            status: {
              handoffId: 'handoff-1', sessionId: 'session-1', sourceMachineId: 'source-1',
              targetMachineId: 'target-1', status: 'in_progress', phase: 'preparing',
              transportStrategy: 'server_routed_stream', recoveryActions: [],
            },
          },
        };
      },
      signal: new AbortController().signal,
      publishOwnerUpdate: vi.fn(),
    });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.result).toMatchObject({
      handoffId: 'handoff-1',
      workspace: {
        kind: 'relationship',
        relationshipId: 'relationship-1',
        created: true,
      },
      warning: {
        code: 'source_cleanup_failed',
        message: 'Source cleanup is still pending.',
      },
    });
    expect(privateStartInput).toMatchObject({
      sessionId: 'session-1',
      sourceMachineId: 'source-1',
      targetMachineId: 'target-1',
      sessionStorageMode: 'persisted',
      preferredTransportStrategies: ['direct_peer', 'server_routed_stream'],
      handoffTargetReplacementApprovalReceiptId: 'approval-receipt-1',
    });
    expect(calls.map(({ machineId, method }) => [machineId, method])).toEqual([
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_RESULT_GET_V3],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_STATUS_GET_V3],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_RESULT_GET_V3],
      ['target-1', RPC_METHODS.SPAWN_HAPPY_SESSION],
      ['target-1', RPC_METHODS.DAEMON_SPAWN_SESSION_RESOLVE],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_COMMIT_V3],
      ['source-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_COMMIT_V3],
    ]);
    expect((calls[4]!.request as { sessionId?: string }).sessionId).toBe('session-1');
    expect(calls[0]!.request).toEqual(expect.objectContaining({
      targetPath: '/target/workspace/packages/app',
      workspaceRootPath: '/target/workspace',
      workspaceSessionRelativeCwd: 'packages/app',
    }));
    expect(calls[4]!.timeoutMs).toBe(5 * 60_000);
    expect(refreshWorkspaceSettings).not.toHaveBeenCalled();
    expect(prepareCreate).toHaveBeenCalledTimes(1);
    expect(prepareCreate).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'action-request-1',
      serverId: 'server-1',
      sourceRootPath: '/source/workspace',
      targetRootPath: '/target/workspace',
      targetReplacementApproval: approval,
      targetReplacementApprovalReceiptId: 'approval-receipt-1',
      targetReplacementApprovalActionInput: {
        sessionId: 'session-1', targetMachineId: 'target-1', targetPath: '/target/workspace',
      },
    }));
  });
});
