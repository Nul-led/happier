import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_TOKEN_FULL_GRANT_V1, type AccountApiTokensListActionOutputV1 } from '@happier-dev/protocol';

const mocks = vi.hoisted(() => ({
  fetchSessionById: vi.fn(),
  lookupSessionsByTags: vi.fn<typeof import('@/session/transport/http/sessionsHttp')['lookupSessionsByTags']>(),
  fetchSessionsPage: vi.fn<typeof import('@/session/transport/http/sessionsHttp')['fetchSessionsPage']>(),
  fetchSessionsQueryPage: vi.fn<typeof import('@/session/transport/http/sessionsHttp')['fetchSessionsQueryPage']>(),
  fetchAccountEncryptionCurrentness: vi.fn(),
  callSessionRpc: vi.fn(),
}));

// HTTP responses are the system boundary; resolution, opening and owner
// metadata projection beneath these adapters remain real.
vi.mock('@/session/transport/http/sessionsHttp', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/session/transport/http/sessionsHttp')>(),
  fetchSessionById: mocks.fetchSessionById,
  lookupSessionsByTags: mocks.lookupSessionsByTags,
  fetchSessionsPage: mocks.fetchSessionsPage,
  fetchSessionsQueryPage: mocks.fetchSessionsQueryPage,
}));
vi.mock('@/api/client/connectedServiceCredentialApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client/connectedServiceCredentialApi')>(),
  fetchAccountEncryptionCurrentness: mocks.fetchAccountEncryptionCurrentness,
}));
vi.mock('@/session/transport/rpc/sessionRpc', () => ({ callSessionRpc: mocks.callSessionRpc }));

import {
  createWorkflowAcceptedAuthorizationCurrentness,
  createWorkflowInvocationRecoveryObserver,
  resolveWorkflowSessionConversation,
  withdrawWorkflowOriginSessionInput,
  cancelDispatchedWorkflowOriginSessionInput,
} from './daemonRuntime';

describe('workflow actual Session reuse metadata', () => {
  const sessionId = 'c123456789012345678901234';
  const credentials = { token: 'token', encryption: null } as const;
  const session = {
    id: sessionId, active: true, activeAt: 1, createdAt: 1, updatedAt: 1,
    encryptionMode: 'plain', metadataLayoutVersion: 1, metadata: JSON.stringify({ v: 1 }),
    ownerMetadata: { t: 'plain', v: { v: 1, workspace: { path: '/owner/checkout', machineId: 'machine-1' } } },
  };

  beforeEach(() => {
    mocks.fetchAccountEncryptionCurrentness.mockResolvedValue({
      mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1,
    });
    mocks.fetchSessionById.mockResolvedValue(session);
    mocks.lookupSessionsByTags.mockImplementation(async ({ tags }) => ({ state: 'available', tags, sessions: [] }));
    mocks.fetchSessionsPage.mockResolvedValue({ sessions: [], nextCursor: null, hasNext: false });
    mocks.fetchSessionsQueryPage.mockResolvedValue({ sessions: [], nextCursor: null, hasNext: false,
      attentionNextCursor: null, attentionHasNext: false });
  });

  it('uses the authorized owner cwd and rejects another Machine before preparation', async () => {
    await expect(resolveWorkflowSessionConversation({ credentials, sessionId, machineId: 'machine-1' }))
      .resolves.toMatchObject({ sessionId, machineId: 'machine-1', directory: '/owner/checkout' });
    await expect(resolveWorkflowSessionConversation({ credentials, sessionId, machineId: 'machine-2' })).resolves.toBeNull();
  });

  it('projects authoritative workflow Session origin and depth from the Session record', async () => {
    mocks.fetchSessionById.mockResolvedValue({ ...session, origin: { kind: 'run_step', runId: 'run-1' }, workDepth: 3 });
    await expect(resolveWorkflowSessionConversation({ credentials, sessionId, machineId: 'machine-1' }))
      .resolves.toMatchObject({ origin: { kind: 'run_step', runId: 'run-1' }, workDepth: 3 });
  });

  it('refuses missing owner metadata rather than using presentation or plaintext as owner authority', async () => {
    mocks.fetchSessionById.mockResolvedValue({ ...session, ownerMetadata: undefined,
      metadata: JSON.stringify({ v: 1, summary: { text: '/invented/path', updatedAt: 1 } }) });
    await expect(resolveWorkflowSessionConversation({ credentials, sessionId, machineId: 'machine-1' })).resolves.toBeNull();
    mocks.fetchSessionById.mockResolvedValue({ ...session, ownerMetadata: { t: 'encrypted', c: 'invalid' } });
    await expect(resolveWorkflowSessionConversation({ credentials, sessionId, machineId: 'machine-1' })).resolves.toBeNull();
  });

  it('accepts only the origin input owner withdrawal answer and never infers it from absence', async () => {
    mocks.callSessionRpc.mockResolvedValue('withdrawn');
    await expect(withdrawWorkflowOriginSessionInput({ credentials, sessionId, machineId: 'machine-1', localInputId: 'step-1' }))
      .resolves.toBe('withdrawn');
    mocks.callSessionRpc.mockResolvedValue('dispatched');
    await expect(withdrawWorkflowOriginSessionInput({ credentials, sessionId, machineId: 'machine-1', localInputId: 'step-1' }))
      .resolves.toBe('dispatched');
    mocks.callSessionRpc.mockResolvedValue({ ok: false, error: 'unsupported' });
    await expect(withdrawWorkflowOriginSessionInput({ credentials, sessionId, machineId: 'machine-1', localInputId: 'step-1' }))
      .rejects.toMatchObject({ code: 'workflow_origin_input_withdrawal_unavailable' });
    mocks.fetchSessionById.mockResolvedValue(null);
    await expect(withdrawWorkflowOriginSessionInput({ credentials, sessionId, machineId: 'machine-1', localInputId: 'step-1' }))
      .rejects.toMatchObject({ code: 'workflow_conversation_unavailable' });
  });

  it('requests only the dispatched origin exact turn and keeps non-current replies unresolved', async () => {
    mocks.callSessionRpc.mockResolvedValue({ ok: true, status: 'cancelled', sessionId, localId: 'step-1' });
    await expect(cancelDispatchedWorkflowOriginSessionInput({ credentials, sessionId, machineId: 'machine-1', localInputId: 'step-1' }))
      .resolves.toBeUndefined();
    expect(mocks.callSessionRpc).toHaveBeenLastCalledWith(expect.objectContaining({
      request: { sessionId, localId: 'step-1' },
    }));
    mocks.callSessionRpc.mockResolvedValue({ ok: false, status: 'notCurrent', sessionId, localId: 'step-1' });
    await expect(cancelDispatchedWorkflowOriginSessionInput({ credentials, sessionId, machineId: 'machine-1', localInputId: 'step-1' }))
      .rejects.toMatchObject({ code: 'workflow_origin_input_stop_unavailable' });
  });
});

describe('production daemon Workflow bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revalidates only revocable API and plugin principals at the canonical owners', async () => {
    const tokenId = '8f250f0e-4f31-4f7d-8f68-61638b73b526';
    const listAccountApiTokens = vi.fn(async (): Promise<AccountApiTokensListActionOutputV1> => ({
      tokens: [{
        tokenId,
        label: 'automation',
        displayPrefix: 'hap_v1_8f250f0e',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: '2026-01-03T00:00:00.000Z',
        hasEncryptionAccess: false,
        hasUnattendedTeamAccess: false,
        grant: API_TOKEN_FULL_GRANT_V1,
        parentTokenId: null,
        activeChildCount: 0,
        embedConfig: null,
      }],
    }));
    const resolveCurrentPluginOccurrenceId = vi.fn(
      async (): Promise<string | null> => 'generation-1',
    );
    const pluginSourceCustody = {
      kind: 'development' as const,
      registeredRootId: 'happier-example-root',
    };
    const resolveCurrentPluginSourceCustody = vi.fn(async () => pluginSourceCustody);
    const isMediatedSourceCurrent = vi.fn(async (): Promise<boolean> => true);
    const isCurrent = createWorkflowAcceptedAuthorizationCurrentness({
      accountId: 'account-1',
      listAccountApiTokens,
      resolveCurrentPluginOccurrenceId,
      resolveCurrentPluginSourceCustody,
      isMediatedSourceCurrent,
      now: () => Date.parse('2026-01-02T00:00:00.000Z'),
    });

    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-1', principalId: 'account-1', credentialId: tokenId },
      },
    })).resolves.toBe(true);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-2', principalId: 'account-2', credentialId: tokenId },
      },
    })).resolves.toBe(false);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-1', principalId: 'other-principal', credentialId: tokenId },
      },
    })).resolves.toBe(false);
    const afterExpiry = createWorkflowAcceptedAuthorizationCurrentness({
      accountId: 'account-1',
      listAccountApiTokens,
      resolveCurrentPluginOccurrenceId,
      resolveCurrentPluginSourceCustody,
      isMediatedSourceCurrent,
      now: () => Date.parse('2026-01-04T00:00:00.000Z'),
    });
    await expect(afterExpiry({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'api', accountId: 'account-1', principalId: 'account-1', credentialId: tokenId },
      },
    })).resolves.toBe(false);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'plugin', pluginId: 'happier.example', sourceCustody: pluginSourceCustody },
      },
    })).resolves.toBe(true);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'default',
        principal: { kind: 'plugin', pluginId: 'happier.example' } as never,
      },
    })).resolves.toBe(false);
    await expect(isCurrent({
      authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
    })).resolves.toBe(true);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'read-only',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
    })).resolves.toBe(true);
    isMediatedSourceCurrent.mockResolvedValueOnce(false);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'read-only',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
    })).resolves.toBe(false);
    resolveCurrentPluginOccurrenceId.mockResolvedValueOnce(null);
    await expect(isCurrent({
      authorization: {
        admittedPermissionCeiling: 'read-only',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
    })).resolves.toBe(false);
    expect(listAccountApiTokens).toHaveBeenCalledTimes(2);
    expect(resolveCurrentPluginOccurrenceId).toHaveBeenCalledTimes(3);
    expect(resolveCurrentPluginSourceCustody).toHaveBeenCalledTimes(2);
    expect(isMediatedSourceCurrent).toHaveBeenCalledTimes(2);
  });

  it('observes an exact Session input without requiring an execution provider handle', async () => {
    const execute = vi.fn();
    const observeSession = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-1',
      localId: 'input-1',
      result: { kind: 'final_text' as const, text: 'done' },
    }));
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute } as never,
      observeSession,
      cancelSession: vi.fn(),
      now: () => 123,
    });

    await expect(observe({
      terminalParent: true,
      cancellationRequested: false,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
      },
    })).resolves.toEqual({ kind: 'completed', result: 'done' });
    expect(observeSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1', localId: 'input-1', deadlineMs: 123,
    }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps Session turn cancellation-request custody unresolved until the exact turn is terminal', async () => {
    const observeSession = vi.fn(async () => ({
      ok: true as const,
      sessionId: 'session-1',
      localId: 'input-1',
      result: { kind: 'pending' as const },
    }));
    const cancelSession = vi.fn(async () => ({ kind: 'turn_cancel_requested' as const }));
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute: vi.fn() } as never,
      observeSession,
      cancelSession,
      now: () => 123,
    });

    await expect(observe({
      terminalParent: false,
      cancellationRequested: true,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
      },
    })).resolves.toEqual({
      kind: 'unresolved',
      code: 'session_input_turn_cancel_requested',
    });
    expect(cancelSession).toHaveBeenCalledOnce();
  });

  it('uses only exact Execution Run get and stop owners for pending terminal custody', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { run: true } })
      .mockResolvedValueOnce({ ok: true, result: { status: 'stopped' } });
    const observeRun = vi.fn(async ({ get }: Readonly<{ get: (request: Readonly<{ runId: string; includeStructured: false }>) => Promise<unknown> }>) => {
      await get({ runId: 'execution-run-1', includeStructured: false });
      return { kind: 'pending' as const };
    });
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute } as never,
      observeRun: observeRun as never,
    });

    await expect(observe({
      terminalParent: true,
      cancellationRequested: false,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'detached_run', runId: 'execution-run-1', localInputId: 'input-1', runtimeSelection: {} },
      },
    })).resolves.toEqual({ kind: 'unresolved', code: 'workflow_outcome_unresolved' });
    expect(execute.mock.calls.map(([actionId]) => actionId)).toEqual([
      'execution.run.get',
      'execution.run.stop',
      'execution.run.get',
    ]);
    expect(execute).toHaveBeenNthCalledWith(1, 'execution.run.get', {
      sessionId: null, runId: 'execution-run-1', includeStructured: false,
    }, expect.objectContaining({ executionRunTargetMachineId: 'machine-1' }));
    expect(execute).toHaveBeenNthCalledWith(2, 'execution.run.stop', {
      sessionId: null, runId: 'execution-run-1',
    }, expect.objectContaining({ executionRunTargetMachineId: 'machine-1' }));
    expect(execute.mock.calls[1]?.[2]).not.toHaveProperty('signal');
    expect(execute.mock.calls[2]?.[2]).not.toHaveProperty('signal');
  });

  it('resolves stop custody from the definitive exact-input observation after the host accepts the stop', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ ok: true, result: { run: 'active' } })
      .mockResolvedValueOnce({ ok: true, result: { status: 'stopped' } })
      .mockResolvedValueOnce({ ok: true, result: { run: 'cancelled' } });
    const observeRun = vi.fn(async ({ get }: Readonly<{ get: (request: Readonly<{ runId: string; includeStructured: false }>) => Promise<unknown> }>) => {
      const response = await get({ runId: 'execution-run-1', includeStructured: false });
      return response && typeof response === 'object' && (response as { run?: unknown }).run === 'cancelled'
        ? { kind: 'cancelled' as const, code: 'execution_run_input_cancelled' }
        : { kind: 'pending' as const };
    });
    const observe = createWorkflowInvocationRecoveryObserver({
      credentials: { token: 'token' } as never,
      machineId: 'machine-1',
      actionExecutor: { execute } as never,
      observeRun: observeRun as never,
    });

    await expect(observe({
      terminalParent: false,
      cancellationRequested: true,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step', scope: [] },
        blockKind: 'step',
        attempt: '0',
        logicalInvocationRecordId: '2aaf1a39-4c48-4904-83a4-7eae318dfc2c',
        execution: { kind: 'detached_run', runId: 'execution-run-1', localInputId: 'input-1', runtimeSelection: {} },
      },
    })).resolves.toEqual({ kind: 'cancelled', code: 'execution_run_input_cancelled' });
    expect(execute.mock.calls.map(([actionId]) => actionId)).toEqual([
      'execution.run.get',
      'execution.run.stop',
      'execution.run.get',
    ]);
  });
});
