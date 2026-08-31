import { describe, expect, it, vi } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import {
  buildTrackedSessionHandoffSpawnOptions,
  createTrackedSessionHandoffCoordinator,
} from './createTrackedSessionHandoffCoordinator';
import { computeWorkspaceSyncPolicyDigest } from '@/workspaces/sync/workspaceSyncTypes';
import type { WorkspaceSyncHandoffAdapter } from '@/workspaces/sync/workspaceSyncHandoffAdapter';

describe('createTrackedSessionHandoffCoordinator', () => {
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
          agent: { runtime: 'native' },
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
    expect(options.runtimeDescriptorV1).toMatchObject({ agentId: 'acme.agent' });
    expect(options).not.toHaveProperty('backendTarget');
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
      if (input.method === RPC_METHODS.DAEMON_SESSION_HANDOFF_COMMIT_V3) {
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
      selection: 'all_files' as const,
      extraIgnorePatterns: [],
      extraIncludePatterns: [],
      includeGitDirectory: false,
    };
    const contentPolicy = {
      ...policyInput,
      policyDigest: computeWorkspaceSyncPolicyDigest(policyInput),
    };
    const workspaceSyncAdapter: WorkspaceSyncHandoffAdapter = {
      prepare: vi.fn(async (input) => ({
        kind: input.action.kind,
        operationId: input.operationId,
        action: input.action,
      })),
      finalize: vi.fn(async (input) => ({
        kind: input.prepared.kind,
        operationId: input.operationId,
      })),
      commit: vi.fn(async (input) => ({
        kind: input.prepared.kind,
        operationId: input.operationId,
      })),
      abort: vi.fn(async () => undefined),
    };
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
      readCredentials: async () => ({ token: 'token' } as never),
      resolveSource: async () => ({
        ok: true,
        sourceMachineId: 'source-1',
        sourceRootPath: '/source/workspace',
        sessionStorageMode: 'persisted',
      }),
      callMachine,
      awaitTargetCustody: async () => ({ type: 'success', sessionId: 'session-1' }),
      wait: async () => undefined,
      workspaceSyncAdapter,
      refreshWorkspaceSettings,
    });

    const result = await coordinate({
      operationId: 'action-request-1',
      actionInput: {
        sessionId: 'session-1',
        targetMachineId: 'target-1',
        targetPath: '/target/workspace',
        workspaceAction: { kind: 'copy_once', contentPolicy },
        workspaceSyncSourceWorkspaceRefId: 'source-ref',
        workspaceSyncTargetWorkspaceRefId: 'target-ref',
        workspaceSyncSettingsVersion: 8,
      },
      start: async () => ({
        ok: true,
        result: {
          handoffId: 'handoff-1', targetPath: '/source/workspace', endpointCandidates: [],
          status: {
            handoffId: 'handoff-1', sessionId: 'session-1', sourceMachineId: 'source-1',
            targetMachineId: 'target-1', status: 'in_progress', phase: 'preparing',
            transportStrategy: 'server_routed_stream', recoveryActions: [],
          },
        },
      }),
      signal: new AbortController().signal,
      publishOwnerUpdate: vi.fn(),
    });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(calls.map(({ machineId, method }) => [machineId, method])).toEqual([
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_V3],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_RESULT_GET_V3],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_STATUS_GET_V3],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_PREPARE_TARGET_RESULT_GET_V3],
      ['target-1', RPC_METHODS.SPAWN_HAPPY_SESSION],
      ['target-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_COMMIT_V3],
      ['source-1', RPC_METHODS.DAEMON_SESSION_HANDOFF_COMMIT_V3],
    ]);
    expect((calls[4]!.request as { sessionId?: string }).sessionId).toBe('session-1');
    expect(calls[4]!.timeoutMs).toBe(5 * 60_000);
    expect(refreshWorkspaceSettings).toHaveBeenCalledWith(expect.objectContaining({
      minSettingsVersion: 8,
    }));
    expect(workspaceSyncAdapter.prepare).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'action-request-1',
      sourceWorkspaceRefId: 'source-ref',
      targetWorkspaceRefId: 'target-ref',
      sourceRootPath: '/source/workspace',
      targetRootPath: '/target/workspace',
    }));
  });
});
