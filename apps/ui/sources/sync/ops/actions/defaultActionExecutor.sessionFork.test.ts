import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeWorkspaceSyncPolicyDigest } from '@happier-dev/protocol';

import type { CurrentProjectedAgentCapabilities } from '@/agents/backendCatalog/currentAgentCapabilities';
import { createSessionAccessFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import { createDefaultActionExecutor } from './defaultActionExecutor';

// Current ready-projection declarations, keyed by the Agent id each session's
// metadata resolves to (legacy `flavor` aliases included). Lifecycle support is
// answered only from a matching current declaration, never from flavor alone.
const codexCurrentCapabilities: CurrentProjectedAgentCapabilities = {
  agentId: 'codex',
  identity: { pluginId: 'codex', localId: 'codex' },
  generation: 1,
  capabilities: {
    sessions: {
      open: ['fork'],
      delivery: ['newTurn'],
      cancel: false,
      conversationRollback: true,
    },
  },
};

const grokCurrentCapabilities: CurrentProjectedAgentCapabilities = {
  agentId: 'grok',
  identity: { pluginId: 'grok', localId: 'grok' },
  generation: 1,
  capabilities: {
    sessions: {
      open: ['fork'],
      delivery: ['newTurn'],
      cancel: false,
      conversationRollback: true,
    },
  },
};

const forkSessionOpMock = vi.hoisted(() => vi.fn());
const rollbackSessionConversationOpMock = vi.hoisted(() => vi.fn());
const rollbackSessionCheckpointCodeOpMock = vi.hoisted(() => vi.fn());
const startSessionHandoffOpMock = vi.hoisted(() => vi.fn());
const machineRpcMock = vi.hoisted(() => vi.fn());
const sessionHandoffOpRuntime = vi.hoisted(() => ({
  useActual: false,
}));
const openSessionForVoiceToolMock = vi.hoisted(() => vi.fn());
const readMachineTargetForSessionMock = vi.hoisted(() => vi.fn());
const completeSessionForkNavigationMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/sessions', () => ({
  forkSession: forkSessionOpMock,
  rollbackSessionConversation: rollbackSessionConversationOpMock,
  rollbackSessionCheckpointCode: rollbackSessionCheckpointCodeOpMock,
  sessionRename: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/sync/ops/sessionHandoffs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sync/ops/sessionHandoffs')>();
  return {
    ...actual,
    startSessionHandoff: (input: unknown) => sessionHandoffOpRuntime.useActual
      ? actual.startSessionHandoff(input as Parameters<typeof actual.startSessionHandoff>[0])
      : startSessionHandoffOpMock(input),
  };
});

vi.mock('@/sync/ops/sessionMachineTarget', () => ({
  readMachineTargetForSession: readMachineTargetForSessionMock,
  readMachineControlTargetForSession: readMachineTargetForSessionMock,
}));

vi.mock('@/voice/tools/actionImpl/openSession', () => ({
  openSessionForVoiceTool: openSessionForVoiceToolMock,
}));

vi.mock('@/sync/domains/sessionFork/completeSessionForkNavigation', () => ({
  completeSessionForkNavigation: (params: unknown) => completeSessionForkNavigationMock(params),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
  sessionRpcWithServerScope: vi.fn(),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionSendMessage', () => ({
  sendSessionMessageWithServerScope: vi.fn(),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
  machineRpcWithServerScope: machineRpcMock,
}));

vi.mock('@/sync/domains/sessionControl/sessionModeControl', () => ({
  computeSessionModePickerControl: vi.fn(() => null),
}));

vi.mock('@/sync/sync', () => ({
  sync: {
    patchSessionMetadataWithRetry: vi.fn(),
  },
}));

vi.mock('@/sync/state/acpSessionModeOverridePublish', () => ({
  publishAcpSessionModeOverrideToMetadata: vi.fn(),
}));

vi.mock('@/voice/session/voiceSession', () => ({
  voiceSessionManager: { stop: vi.fn() },
}));

vi.mock('@/voice/agent/voiceAgentGlobalSessionId', () => ({
  VOICE_AGENT_GLOBAL_SESSION_ID: 'voice_global',
}));

vi.mock('@/voice/tools/actionImpl/sessionTargets', () => ({
  setPrimaryActionSessionId: vi.fn(),
  setTrackedSessionIds: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/sessionList', () => ({
  listSessionsForVoiceTool: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/sessionActivity', () => ({
  getSessionActivityForVoiceTool: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/sessionRecentMessages', () => ({
  getSessionRecentMessagesForVoiceTool: vi.fn(),
  getSessionTranscriptForVoiceTool: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/pathsListRecent', () => ({
  listRecentPathsForVoiceTool: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/machinesList', () => ({
  listMachinesForVoiceTool: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/serversList', () => ({
  listServersForVoiceTool: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/reviewEnginesList', () => ({
  listReviewEnginesForVoiceTool: vi.fn(),
}));

vi.mock('@/voice/tools/actionImpl/agentCatalogList', () => ({
  listAgentBackendsForVoiceTool: vi.fn(),
  listAgentModelsForVoiceTool: vi.fn(),
}));

vi.mock('@/sync/ops/sessionExecutionRuns', () => ({
  sessionExecutionRunStart: vi.fn(),
  sessionExecutionRunList: vi.fn(),
  sessionExecutionRunGet: vi.fn(),
  sessionExecutionRunSend: vi.fn(),
  sessionExecutionRunStop: vi.fn(),
  sessionExecutionRunAction: vi.fn(),
}));

vi.mock('@/sync/sync', () => ({
  sync: {
    createArtifactWithHeader: vi.fn(),
    fetchArtifactWithBody: vi.fn(),
    updateArtifactWithHeader: vi.fn(),
  },
}));

const storageGetStateMock = vi.hoisted(() => vi.fn());
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
    storage: {
    getState: storageGetStateMock,
  },
});
});

describe('createDefaultActionExecutor (session.fork)', () => {
  beforeEach(() => {
    forkSessionOpMock.mockReset();
    rollbackSessionConversationOpMock.mockReset();
    rollbackSessionCheckpointCodeOpMock.mockReset();
    startSessionHandoffOpMock.mockReset();
    machineRpcMock.mockReset();
    sessionHandoffOpRuntime.useActual = false;
    openSessionForVoiceToolMock.mockReset();
    completeSessionForkNavigationMock.mockReset();
    completeSessionForkNavigationMock.mockImplementation(async (params: any) => {
      await params.navigate(
        params.childSessionId,
        params.serverId ? { serverId: params.serverId } : undefined,
      );
    });
    readMachineTargetForSessionMock.mockReset();
    readMachineTargetForSessionMock.mockReturnValue(null);
    storageGetStateMock.mockReset();
  });

  it('calls the provided openSession callback after a successful fork', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });
    openSessionForVoiceToolMock.mockResolvedValueOnce({});

    const openSession = vi.fn().mockResolvedValueOnce(undefined);

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_1',
          },
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor({ openSession });

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(completeSessionForkNavigationMock).toHaveBeenCalledWith({
      childSessionId: 'sess_child',
      parentSessionId: 'sess_parent',
      navigate: expect.any(Function),
    });
    expect(openSession).toHaveBeenCalledTimes(1);
    expect(openSession).toHaveBeenCalledWith('sess_child');
  }, 10_000);

  it('resolves the parent session server scope for fork execution and child opening', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });

    const openSession = vi.fn().mockResolvedValueOnce(undefined);

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_1',
          },
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const resolveServerIdForSessionId = vi.fn((sessionId: string) => sessionId === 'sess_parent' ? 'server-b' : null);
    const executor = createDefaultActionExecutor({
      openSession,
      resolveServerIdForSessionId,
    });

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(resolveServerIdForSessionId).toHaveBeenCalledWith('sess_parent');
    expect(forkSessionOpMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'sess_parent',
      serverId: 'server-b',
    }));
    expect(completeSessionForkNavigationMock).toHaveBeenCalledWith({
      childSessionId: 'sess_child',
      parentSessionId: 'sess_parent',
      serverId: 'server-b',
      navigate: expect.any(Function),
    });
    expect(openSession).toHaveBeenCalledTimes(1);
    expect(openSession).toHaveBeenCalledWith('sess_child', { serverId: 'server-b' });
  });

  it('passes replaySummaryRunner when session replay strategy is summary_plus_recent and a runner is configured', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });
    openSessionForVoiceToolMock.mockResolvedValueOnce({});

    const runner = {
      v: 1,
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      modelId: 'default',
      permissionMode: 'no_tools',
    } as const;
    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_1',
          },
        },
      },
      settings: {
        sessionReplayEnabled: true,
        sessionReplayStrategy: 'summary_plus_recent',
        sessionReplaySummaryRunnerV1: runner,
        sessionReplayMaxSeedChars: 54_321,
        // The summary runner is an LLM task and follows the execution-runs
        // feature, which is experimental and off by default.
        experiments: true,
        featureToggles: { 'execution.runs': true },
      },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(forkSessionOpMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'sess_parent',
      forkPoint: { type: 'latest' },
      replaySummaryRunner: runner,
      replayMaxSeedChars: 54_321,
    }));
    expect(completeSessionForkNavigationMock).toHaveBeenCalledWith({
      childSessionId: 'sess_child',
      parentSessionId: 'sess_parent',
      navigate: expect.any(Function),
    });
    expect(openSessionForVoiceToolMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess_child',
    }));
  }, 60_000);

  it('requests a native fork instead of falling back to Replay when the account disabled Replay', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });
    openSessionForVoiceToolMock.mockResolvedValueOnce({});

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          presence: 0,
          metadata: { machineId: 'machine_1', flavor: 'codex', codexBackendMode: 'appServer' },
        },
      },
      settings: { sessionReplayEnabled: false },
    });

    const executor = createDefaultActionExecutor({ currentAgentCapabilities: codexCurrentCapabilities });

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    // Native support comes from the Agent's current declaration; `auto` is what
    // lets the daemon settle on Replay, and the account turned Replay off.
    expect(forkSessionOpMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'sess_parent',
      strategy: 'native',
    }));
  }, 60_000);

  it('refuses the fork when Replay is off and this Agent has no native fork route', async () => {
    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          presence: 0,
          metadata: { machineId: 'machine_1', flavor: 'claude' },
        },
      },
      settings: { sessionReplayEnabled: false },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res).toMatchObject({ ok: false, errorCode: 'action_disabled' });
    expect(forkSessionOpMock).not.toHaveBeenCalled();
  }, 60_000);

  it('omits the replay summary runner when the execution-runs feature is off', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });
    openSessionForVoiceToolMock.mockResolvedValueOnce({});

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          presence: 0,
          metadata: { machineId: 'machine_1' },
        },
      },
      settings: {
        sessionReplayEnabled: true,
        sessionReplayStrategy: 'summary_plus_recent',
        sessionReplaySummaryRunnerV1: {
          v: 1,
          backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
          modelId: 'default',
          permissionMode: 'no_tools',
        },
        featureToggles: { 'execution.runs': false },
      },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    // The summary runner is an LLM task; it follows the execution-runs feature
    // exactly as it does on every other fork entry point.
    expect(forkSessionOpMock.mock.calls[0]?.[0]).not.toHaveProperty('replaySummaryRunner');
  }, 60_000);

  it('clamps an out-of-range replay seed budget to what the fork wire accepts', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });
    openSessionForVoiceToolMock.mockResolvedValueOnce({});

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          presence: 0,
          metadata: { machineId: 'machine_1' },
        },
      },
      // The stored account setting permits a wider range than the fork wire schema, so an
      // unclamped forward would be rejected as invalid rather than bounded.
      settings: { sessionReplayEnabled: true, sessionReplayMaxSeedChars: 500_000 },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(forkSessionOpMock).toHaveBeenCalledWith(expect.objectContaining({
      replayMaxSeedChars: 200_000,
    }));
  }, 60_000);

  it('delegates session fork even when session metadata machineId is missing', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });
    openSessionForVoiceToolMock.mockResolvedValueOnce({});

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {},
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    const forkArgs = forkSessionOpMock.mock.calls[0]?.[0] as any;
    expect(forkArgs?.machineId).toBeUndefined();
    expect(forkArgs).toMatchObject({
      parentSessionId: 'sess_parent',
      forkPoint: { type: 'latest' },
    });
  });

  it('prefers the reachable machine target over stale session metadata for session fork', async () => {
    forkSessionOpMock.mockResolvedValueOnce({ ok: true, childSessionId: 'sess_child' });
    openSessionForVoiceToolMock.mockResolvedValueOnce({});
    readMachineTargetForSessionMock.mockReturnValue({
      machineId: 'machine_rebound',
      basePath: '/workspace/repo',
    });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_stale',
          },
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.fork' as any,
      { sessionId: 'sess_parent' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(readMachineTargetForSessionMock).toHaveBeenCalledWith('sess_parent');
    expect(forkSessionOpMock).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'sess_parent',
      machineId: 'machine_rebound',
    }));
  });

  it('delegates session handoff to the session handoff op with the current machine id', async () => {
    startSessionHandoffOpMock.mockResolvedValueOnce({
      ok: true,
      result: {
        handoffId: 'handoff_1',
        status: { handoffId: 'handoff_1', status: 'pending', phase: 'preparing', recoveryActions: [] },
        workspace: { kind: 'none' },
      },
    });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_1',
          },
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.handoff' as any,
      {
        sessionId: 'sess_parent',
        targetMachineId: 'machine_2',
        targetPath: '/home/guest/workspace',
      },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(startSessionHandoffOpMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess_parent',
      sourceMachineId: 'machine_1',
      targetMachineId: 'machine_2',
      targetPath: '/home/guest/workspace',
    }));
    // Transcript-storage authority belongs to the source daemon, which derives
    // it fresh from owner metadata before any stop or export. The client does
    // not carry a second answer alongside the request.
    expect(startSessionHandoffOpMock.mock.calls[0]?.[0]).not.toHaveProperty('sessionStorageMode');
    // The daemon coordinator is the sole transport-strategy owner, and the UI
    // request adapter deliberately serializes neither a preferred nor a
    // negotiated strategy, so the executor must not advertise one either.
    expect(startSessionHandoffOpMock.mock.calls[0]?.[0]).not.toHaveProperty('preferredTransportStrategies');
    expect(startSessionHandoffOpMock.mock.calls[0]?.[0]).not.toHaveProperty('negotiatedTransportStrategy');
  });

  it('forwards the approved target receipt and exact Action input to the handoff adapter', async () => {
    const approval = {
      v: 1 as const,
      consequences: ['replace_nonempty_workspace_target'] as const,
      serverId: 'server-1',
      machineId: 'machine_2',
      canonicalRoot: '/target/repo',
      rootFingerprint: 'a'.repeat(64),
      operationId: 'handoff-action-1',
    };
    const policyFields = {
      v: 1 as const,
      selection: 'git_worktree' as const,
      extraIgnorePatterns: [],
      extraIncludePatterns: [],
    };
    const actionInput = {
      sessionId: 'sess_parent',
      targetMachineId: 'machine_2',
      targetPath: '/target/repo',
      workspaceAction: {
        kind: 'create_relationship' as const,
        mode: 'mirror_exactly' as const,
        contentPolicy: {
          ...policyFields,
          policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
        },
        flushBeforeCommit: true,
      },
    };
    machineRpcMock.mockResolvedValueOnce({ type: 'approval_required', approval });
    startSessionHandoffOpMock.mockResolvedValueOnce({
      ok: true,
      result: {
        handoffId: 'handoff_1',
        status: { handoffId: 'handoff_1', status: 'completed', phase: 'finalizing', recoveryActions: [] },
        workspace: { kind: 'relationship', relationshipId: 'relationship_1', created: false },
      },
    });
    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent', seq: 1, createdAt: 1, updatedAt: 1, active: false, activeAt: 0,
          metadataVersion: 0, agentStateVersion: 0, thinking: false, thinkingAt: 0, presence: 0,
          metadata: { machineId: 'machine_1', flavor: 'claude' },
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor({
      resolveServerIdForSessionId: () => 'server-1',
    });
    await expect(executor.execute(
      'session.handoff' as any,
      actionInput,
      {
        surface: 'ui',
        actionRequestId: 'handoff-action-1',
        handoffTargetReplacementApproval: approval,
        handoffTargetReplacementApprovalReceiptId: 'approval-receipt-1',
        bypassApprovals: true,
      } as any,
    )).resolves.toMatchObject({ ok: true });

    expect(startSessionHandoffOpMock).toHaveBeenCalledWith(expect.objectContaining({
      handoffTargetReplacementApproval: approval,
      handoffTargetReplacementApprovalReceiptId: 'approval-receipt-1',
      handoffTargetReplacementApprovalActionInput: actionInput,
    }));
  });

  /**
   * Which storage the target imports into is decided by the SOURCE daemon, from
   * the owner metadata it loads itself, before the operation claim and before
   * any stop or export. A layout-1 row whose owner projection has not reached
   * this device is therefore a cold client cache, not evidence that the handoff
   * is invalid: the client must still reach that authority, and must not send a
   * storage answer of its own for the daemon to agree with.
   */
  it('starts a session handoff through the daemon authority when this device cannot read the owner view', async () => {
    sessionHandoffOpRuntime.useActual = true;
    readMachineTargetForSessionMock.mockReturnValue({ machineId: 'machine_1', basePath: '/repo' });
    machineRpcMock.mockResolvedValueOnce({
      handoffId: 'handoff_3',
      status: { handoffId: 'handoff_3', status: 'completed', phase: 'finalizing', recoveryActions: [] },
      workspace: { kind: 'none' },
    });
    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadataLayoutVersion: 1,
          metadata: { v: 1, agentPresentation: { agentId: 'codex' } },
          ownerMetadataView: null,
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.handoff' as any,
      { sessionId: 'sess_parent', targetMachineId: 'machine_2' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res).toMatchObject({ ok: true });
    expect(machineRpcMock).toHaveBeenCalledTimes(1);
    expect(machineRpcMock).toHaveBeenCalledWith(expect.objectContaining({
      machineId: 'machine_1',
      method: 'daemon.sessionHandoff.start.v3',
      payload: expect.objectContaining({
        sessionId: 'sess_parent',
        targetMachineId: 'machine_2',
      }),
    }));
    expect(machineRpcMock.mock.calls[0]?.[0]?.payload)
      .not.toHaveProperty('sessionStorageMode');
  });

  it('prefers the reachable machine target over stale session metadata for session handoff', async () => {
    startSessionHandoffOpMock.mockResolvedValueOnce({
      ok: true,
      result: {
        handoffId: 'handoff_1',
        status: { handoffId: 'handoff_1', status: 'pending', phase: 'preparing', recoveryActions: [] },
        workspace: { kind: 'none' },
      },
    });
    readMachineTargetForSessionMock.mockReturnValue({
      machineId: 'machine_rebound',
      basePath: '/workspace/repo',
    });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_stale',
          },
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.handoff' as any,
      { sessionId: 'sess_parent', targetMachineId: 'machine_2' },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(readMachineTargetForSessionMock).toHaveBeenCalledWith('sess_parent');
    expect(startSessionHandoffOpMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess_parent',
      sourceMachineId: 'machine_rebound',
      targetMachineId: 'machine_2',
    }));
  });

  it('passes direct-to-persisted handoff options through to the handoff op', async () => {
    startSessionHandoffOpMock.mockResolvedValueOnce({
      ok: true,
      result: {
        handoffId: 'handoff_2',
        status: { handoffId: 'handoff_2', status: 'completed', phase: 'finalizing', recoveryActions: [] },
        workspace: { kind: 'relationship', relationshipId: 'relationship_1', created: false },
      },
    });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: false,
          activeAt: 0,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_1',
            directSessionV1: {
              v: 1,
              providerId: 'claude',
              machineId: 'machine_1',
              remoteSessionId: 'claude_session_1',
              source: {
                kind: 'claudeConfig',
                configDir: '/Users/tester/.claude',
              },
            },
            flavor: 'claude',
          },
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor();

    const res = await executor.execute(
      'session.handoff' as any,
      {
        sessionId: 'sess_parent',
        targetMachineId: 'machine_2',
        targetSessionStorageMode: 'persisted',
        workspaceAction: {
          kind: 'relationship',
          relationshipId: 'relationship_1',
          flushBeforeCommit: true,
        },
      },
      { surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(res.ok).toBe(true);
    expect(startSessionHandoffOpMock.mock.calls[0]?.[0]).not.toHaveProperty('sessionStorageMode');
    expect(startSessionHandoffOpMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess_parent',
      sourceMachineId: 'machine_1',
      targetMachineId: 'machine_2',
      targetSessionStorageMode: 'persisted',
      workspaceAction: {
        kind: 'relationship',
        relationshipId: 'relationship_1',
        flushBeforeCommit: true,
      },
    }));
  });

  it('routes a Home A handoff and its exact target proof through the real UI RPC adapter while Home B is focused', async () => {
    const approval = {
      v: 1 as const,
      consequences: [
        'replace_nonempty_workspace_target',
        'delete_target_only_files_during_exact_mirror',
      ] as const,
      serverId: 'home-a',
      machineId: 'machine_2',
      canonicalRoot: '/target/repo',
      rootFingerprint: 'a'.repeat(64),
      operationId: 'handoff-action-1',
    };
    const policyFields = {
      v: 1 as const,
      selection: 'git_worktree' as const,
      extraIgnorePatterns: [],
      extraIncludePatterns: [],
    };
    const workspaceAction = {
      kind: 'create_relationship' as const,
      mode: 'mirror_exactly' as const,
      contentPolicy: {
        ...policyFields,
        policyDigest: computeWorkspaceSyncPolicyDigest(policyFields),
      },
      flushBeforeCommit: true,
    };
    const terminalResult = {
      handoffId: 'handoff_2',
      status: { handoffId: 'handoff_2', status: 'completed' as const, phase: 'finalizing' as const, recoveryActions: [] },
      workspace: {
        kind: 'relationship' as const,
        relationshipId: 'relationship_1',
        created: true,
        cleanupWarning: { code: 'staging_release_failed', message: 'Staging could not be released.' },
      },
      warning: { code: 'source_cleanup_failed', message: 'Source cleanup needs attention.' },
    };
    sessionHandoffOpRuntime.useActual = true;
    machineRpcMock
      .mockResolvedValueOnce({ type: 'approval_required', approval })
      .mockResolvedValueOnce(terminalResult);
    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent', seq: 1, createdAt: 1, updatedAt: 1, active: false, activeAt: 0,
          metadataVersion: 0, agentStateVersion: 0, thinking: false, thinkingAt: 0, presence: 0,
          metadata: { machineId: 'machine_1', flavor: 'claude' },
        },
      },
      settings: { sessionReplayEnabled: true, activeServerId: 'home-b' },
    });

    const executor = createDefaultActionExecutor({
      resolveServerIdForSessionId: (sessionId) => sessionId === 'sess_parent' ? 'home-a' : null,
    });
    const result = await executor.execute(
      'session.handoff' as any,
      {
        sessionId: 'sess_parent',
        targetMachineId: 'machine_2',
        targetPath: '/target/repo',
        workspaceAction,
      },
      {
        surface: 'ui', placement: 'session_action_menu', actionRequestId: 'handoff-action-1',
        handoffTargetReplacementApproval: approval, bypassApprovals: true,
      } as any,
    );

    expect(result).toEqual({ ok: true, result: terminalResult });
    expect(machineRpcMock).toHaveBeenCalledTimes(2);
    expect(machineRpcMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      serverId: 'home-a',
      machineId: 'machine_2',
      method: 'daemon.workspaceSync.target.replacement.preflight.v1',
      payload: expect.objectContaining({
        operationId: 'handoff-action-1',
        activatesExactMirror: true,
      }),
    }));
    expect(machineRpcMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      serverId: 'home-a',
      machineId: 'machine_1',
      method: 'daemon.sessionHandoff.start.v3',
      payload: expect.objectContaining({
        accountServerId: 'home-a',
        actionRequestId: 'handoff-action-1',
        handoffTargetReplacementApproval: approval,
        workspaceAction,
      }),
    }));
  });

  it('delegates session rollback to the session rollback op for app-server Codex sessions', async () => {
    rollbackSessionConversationOpMock.mockResolvedValueOnce({ ok: true, rolledBack: true, target: { type: 'latest_turn' } });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: true,
          activeAt: 1,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_1',
            flavor: 'codex',
            codexBackendMode: 'appServer',
          },
          access: createSessionAccessFixture(),
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor({ currentAgentCapabilities: codexCurrentCapabilities });

    const result = await executor.execute(
      'session.rollback' as any,
      { sessionId: 'sess_parent' },
      { defaultSessionId: 'sess_parent', surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(result.ok).toBe(true);
    expect(rollbackSessionConversationOpMock).toHaveBeenCalledWith({
      sessionId: 'sess_parent',
      target: { type: 'latest_turn' },
    });
  });

  it.each(['openai', 'gpt'])('enables session rollback for legacy Codex flavor aliases on app-server sessions (%s)', async (flavor) => {
    rollbackSessionConversationOpMock.mockResolvedValueOnce({ ok: true, rolledBack: true, target: { type: 'latest_turn' } });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          active: true,
          activeAt: 1,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          metadata: {
            machineId: 'machine_1',
            flavor,
            codexBackendMode: 'appServer',
          },
          access: createSessionAccessFixture(),
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor({ currentAgentCapabilities: codexCurrentCapabilities });

    const result = await executor.execute(
      'session.rollback' as any,
      { sessionId: 'sess_parent' },
      { defaultSessionId: 'sess_parent', surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(result.ok).toBe(true);
    expect(rollbackSessionConversationOpMock).toHaveBeenCalledWith({
      sessionId: 'sess_parent',
      target: { type: 'latest_turn' },
    });
  });

  it.each([
    ['Codex app-server', { flavor: 'codex', codexBackendMode: 'appServer' }, codexCurrentCapabilities],
    ['Grok', { flavor: 'grok' }, grokCurrentCapabilities],
  ])('delegates inactive %s rollback to a trusted completed turn start', async (_provider, metadata, currentAgentCapabilities) => {
    rollbackSessionConversationOpMock.mockResolvedValueOnce({
      ok: true,
      rolledBack: true,
      target: { type: 'before_user_message', userMessageSeq: 3 },
    });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 4,
          createdAt: 1,
          updatedAt: 4,
          active: false,
          activeAt: 4,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          rollbackEligibleTurnStarts: [3],
          sessionTurns: {
            v: 1,
            sessionId: 'sess_parent',
            latestTurnId: 'turn_2',
            updatedAt: 4,
            turns: [{
              turnId: 'turn_2',
              status: 'completed',
              startedAt: 3,
              updatedAt: 4,
              terminalAt: 4,
              transcriptAnchors: {
                startUserMessageSeq: 3,
                userMessageSeqs: [3],
                startSeqInclusive: 3,
                endSeqInclusive: 4,
              },
              rollback: { state: 'eligible', updatedAt: 4 },
            }],
          },
          metadata: {
            machineId: 'machine_1',
            ...metadata,
          },
          access: createSessionAccessFixture(),
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor({ currentAgentCapabilities });

    const result = await executor.execute(
      'session.rollback' as any,
      {
        sessionId: 'sess_parent',
        target: { type: 'before_user_message', userMessageSeq: 3 },
      },
      { defaultSessionId: 'sess_parent', surface: 'ui' } as any,
    );

    expect(result.ok).toBe(true);
    expect(rollbackSessionConversationOpMock).toHaveBeenCalledWith({
      sessionId: 'sess_parent',
      target: { type: 'before_user_message', userMessageSeq: 3 },
    });
  });

  it('delegates an external Agent rollback only through its current declaration and trusted turn evidence', async () => {
    rollbackSessionConversationOpMock.mockResolvedValueOnce({
      ok: true,
      rolledBack: true,
      target: { type: 'before_user_message', userMessageSeq: 3 },
    });

    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 4,
          createdAt: 1,
          updatedAt: 4,
          active: false,
          activeAt: 4,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          rollbackEligibleTurnStarts: [3],
          sessionTurns: {
            v: 1,
            sessionId: 'sess_parent',
            latestTurnId: 'turn_2',
            updatedAt: 4,
            turns: [{
              turnId: 'turn_2',
              status: 'completed',
              startedAt: 3,
              updatedAt: 4,
              terminalAt: 4,
              transcriptAnchors: {
                startUserMessageSeq: 3,
                userMessageSeqs: [3],
                startSeqInclusive: 3,
                endSeqInclusive: 4,
              },
              rollback: { state: 'eligible', updatedAt: 4 },
            }],
          },
          metadata: {
            machineId: 'machine_1',
            runtimeDescriptorV1: {
              v: 1,
              agentId: 'acme-lifecycle',
              agent: { providerSessionId: 'acme-session-1' },
            },
          },
          access: createSessionAccessFixture(),
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor({
      currentAgentCapabilities: {
        agentId: 'acme-lifecycle',
        identity: { pluginId: 'acme.lifecycle', localId: 'acme-lifecycle' },
        generation: 42,
        capabilities: {
          sessions: {
            open: ['resume'],
            delivery: ['newTurn'],
            cancel: false,
            conversationRollback: true,
          },
        },
      } satisfies CurrentProjectedAgentCapabilities,
    });

    const result = await executor.execute(
      'session.rollback' as any,
      {
        sessionId: 'sess_parent',
        target: { type: 'before_user_message', userMessageSeq: 3 },
      },
      { defaultSessionId: 'sess_parent', surface: 'ui' } as any,
    );

    expect(result.ok).toBe(true);
    expect(rollbackSessionConversationOpMock).toHaveBeenCalledWith({
      sessionId: 'sess_parent',
      target: { type: 'before_user_message', userMessageSeq: 3 },
    });
  });

  // Each row holds a canonical access grant plus the current Agent declaration
  // the session's Agent resolves to, so the rejection is decided by the row's
  // named gate instead of an accidental missing-access short-circuit. The
  // unsupported-Agent row deliberately carries a conversationRollback-capable
  // declaration for a different Agent id.
  it.each([
    [
      'inactive latest-turn rollback',
      { active: false, access: createSessionAccessFixture(), metadata: { flavor: 'codex', codexBackendMode: 'appServer' }, rollbackEligibleTurnStarts: [3] },
      { type: 'latest_turn' },
      codexCurrentCapabilities,
    ],
    [
      'an untrusted pending turn start',
      { active: false, access: createSessionAccessFixture(), metadata: { flavor: 'grok' }, rollbackEligibleTurnStarts: [3] },
      { type: 'before_user_message', userMessageSeq: 5 },
      grokCurrentCapabilities,
    ],
    [
      'a view-only trusted turn start',
      { active: false, access: createSessionAccessFixture('view'), metadata: { flavor: 'grok' }, rollbackEligibleTurnStarts: [3] },
      { type: 'before_user_message', userMessageSeq: 3 },
      grokCurrentCapabilities,
    ],
    [
      'an unsupported provider trusted turn start',
      { active: false, access: createSessionAccessFixture(), metadata: { flavor: 'claude' }, rollbackEligibleTurnStarts: [3] },
      { type: 'before_user_message', userMessageSeq: 3 },
      codexCurrentCapabilities,
    ],
  ])('rejects %s before invoking the rollback RPC', async (_scenario, sessionOverrides, target, currentAgentCapabilities) => {
    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          seq: 5,
          createdAt: 1,
          updatedAt: 5,
          activeAt: 5,
          metadataVersion: 0,
          agentStateVersion: 0,
          thinking: false,
          thinkingAt: 0,
          presence: 0,
          ...sessionOverrides,
        },
      },
      settings: { sessionReplayEnabled: true },
    });

    const executor = createDefaultActionExecutor({ currentAgentCapabilities });
    const result = await executor.execute(
      'session.rollback' as any,
      { sessionId: 'sess_parent', target },
      { defaultSessionId: 'sess_parent', surface: 'ui' } as any,
    );

    expect(result).toEqual({
      ok: false,
      errorCode: 'action_disabled',
      error: 'action_disabled',
    });
    expect(rollbackSessionConversationOpMock).not.toHaveBeenCalled();
  });

  it('delegates checkpoint code rollback through the production action executor dependency', async () => {
    rollbackSessionCheckpointCodeOpMock.mockResolvedValueOnce({
      status: 'applied',
      changedPaths: ['tracked.txt'],
      skippedPaths: [],
      receipts: ['checkpoint.rollback_applied'],
      diagnostics: [],
    });
    storageGetStateMock.mockReturnValue({
      sessions: {
        sess_parent: {
          id: 'sess_parent',
          active: true,
          metadata: {
            machineId: 'machine_1',
            flavor: 'codex',
            codexBackendMode: 'appServer',
          },
        },
      },
      settings: { sessionReplayEnabled: true },
    });
    const request = {
      v: 1,
      sessionId: 'sess_parent',
      turnId: 'turn-1',
      cwd: '/repo',
      codeMode: 'code_only_without_stash',
      backupMode: 'happier_checkpoint_only',
      expectedStartRef: 'refs/happier/checkpoints/c2Vzc19wYXJlbnQ/turn-start/turn-1',
      expectedFinalRef: 'refs/happier/checkpoints/c2Vzc19wYXJlbnQ/turn-final/turn-1',
      codeOnlyTranscriptDivergenceConfirmed: true,
    } as const;

    const executor = createDefaultActionExecutor({
      resolveServerIdForSessionId: () => 'server-b',
    });

    const result = await executor.execute(
      'session.checkpoint_code_rollback' as any,
      request,
      { defaultSessionId: 'sess_parent', surface: 'ui', placement: 'session_action_menu' } as any,
    );

    expect(result.ok).toBe(true);
    expect(rollbackSessionCheckpointCodeOpMock).toHaveBeenCalledWith({
      request,
      serverId: 'server-b',
    });
  });
});
