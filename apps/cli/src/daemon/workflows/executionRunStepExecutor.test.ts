import { describe, expect, it, vi } from 'vitest';

import {
  projectWorkflowRetainedRuntimeSelectionV1,
  type WorkflowStepExecutionSelection,
} from '@happier-dev/protocol';
import type { RpcActionExecutorContext } from '@/rpc/handlers/_actionDispatchAdapter';

import { WORKFLOW_CANCEL_REQUESTED_ABORT_REASON, WorkflowRuntimeInterruption } from './coordinator';
import {
  createWorkflowAttachedExecutionRunStepExecutor,
  createWorkflowDetachedExecutionRunStepExecutor,
  createWorkflowStepExecutorDispatcher,
  prepareWorkflowDetachedExecutionRunStep,
} from './executionRunStepExecutor';

const CLAUDE_TARGET = {
  kind: 'agent' as const,
  identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
};

const buildActionContext = () => ({
  surface: 'agent' as const,
  authority: 'account_automation' as const,
  callerPermissionMode: 'workspace_write',
  causalPermissionAuthority: {
    kind: 'admittedSessionInputV1' as const,
    admittedPermissionCeiling: 'workspace_write' as const,
  },
});

function isActionInput(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireActionInput(value: unknown): Record<string, unknown> {
  if (isActionInput(value)) return value;
  throw new Error('expected Action input object');
}

function completedRun(runId: string, localInputId: string, value: unknown) {
  return {
    run: {
      runId,
      callId: `call-${runId}`,
      sidechainId: `sidechain-${runId}`,
      intent: 'agent',
      backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
      permissionMode: 'workspace_write',
      retentionPolicy: 'resumable',
      runClass: 'long_lived',
      ioMode: 'request_response',
      status: 'running',
      startedAtMs: 1,
      inputTurns: {
        occurrenceId: `occurrence-${runId}`,
        last: {
          turnId: `turn-${localInputId}`,
          inputIds: [localInputId],
          state: 'completed',
          result: { kind: typeof value === 'string' ? 'text' : 'json', value },
        },
      },
    },
  };
}

function activeRun(runId: string, localInputId: string) {
  const { run } = completedRun(runId, localInputId, 'unused');
  return {
    run: {
      ...run,
      inputTurns: {
        occurrenceId: `occurrence-${runId}`,
        current: { turnId: `turn-${localInputId}`, inputIds: [localInputId], state: 'active' },
      },
    },
  };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'workflow-1',
    step: {
      kind: 'step',
      id: 'implement',
      document: { text: 'Implement it', references: [], attachments: [] },
      input: [],
      result: { kind: 'json', schema: { type: 'object' } },
    },
    invocation: {
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'implement', scope: [] },
      blockKind: 'step',
      attempt: '0',
      logicalInvocationRecordId: 'invocation-1',
    },
    input: { text: 'Implement it', references: [], attachments: [], values: [] },
    executionTarget: { kind: 'detached_run' },
    execution: {
      agentTarget: CLAUDE_TARGET,
      permissionMode: 'safe-yolo',
      modelSelection: {
        v: 1,
        updatedAt: 1,
        ref: {
          agentTargetKey: 'agent:happier.agent.claude:claude',
          providerConnectionId: null,
          modelId: 'sonnet',
        },
      },
      sessionConfigOptionOverrides: {
        v: 1,
        updatedAt: 1,
        overrides: { effort: { value: 'high', updatedAt: 1 } },
      },
      mcpSelection: {
        v: 1,
        managedServersEnabled: true,
        forceIncludeServerIds: ['repo'],
        forceExcludeServerIds: [],
      },
      connectedServices: { v: 2, bindingsByServiceId: {} },
      acpSessionModeId: 'plan',
      runtimeDescriptorV1: {
        v: 1,
        agentId: 'happier.agent.claude/claude',
        agent: { backendMode: 'acp' },
      },
      conversation: { kind: 'shared_run' },
    } satisfies WorkflowStepExecutionSelection,
    workspace: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' },
    authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
    onInputAccepted: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('workflow detached Execution Run step executor', () => {
  it('rejects a broader step permission than the immutable Run ceiling before any native mutation', async () => {
    const actionExecutor = { execute: vi.fn() };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });

    await expect(execute(baseParams({
      authorization: { admittedPermissionCeiling: 'read-only', principal: { kind: 'host' } },
      execution: { ...baseParams().execution, permissionMode: 'safe-yolo' },
    }) as never)).resolves.toEqual({
      kind: 'failed', code: 'workflow_permission_escalation_denied',
    });
    expect(actionExecutor.execute).not.toHaveBeenCalled();
  });

  it('uses the contextual default rather than widening an omitted step to the Run ceiling', async () => {
    let localInputId = '';
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.start') {
          localInputId = String(input.localInputId);
          return { ok: true as const, result: { runId: 'run-native-1', callId: 'call-1', sidechainId: 'sidechain-1' } };
        }
        if (actionId === 'execution.run.get') {
          return { ok: true as const, result: completedRun('run-native-1', localInputId, 'done') };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: async () => null,
      resolveProducerConversation: async () => null,
    });

    await expect(execute(baseParams({
      execution: { ...baseParams().execution, permissionMode: undefined },
      authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
    }) as never)).resolves.toMatchObject({ kind: 'completed' });
    expect(actionExecutor.execute.mock.calls[0]?.[1]).toMatchObject({ permissionMode: 'default' });
  });

  it('starts a general native Agent Run with exact selections and commits correspondence before observation', async () => {
    const events: string[] = [];
    let localInputId = '';
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.start') {
          localInputId = String(input.localInputId);
          return { ok: true as const, result: { runId: 'run-native-1', callId: 'call-1', sidechainId: 'sidechain-1' } };
        }
        if (actionId === 'execution.run.get') {
          events.push('observe');
          return { ok: true as const, result: completedRun('run-native-1', localInputId, { changed: true }) };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext: () => ({
        ...buildActionContext(),
        surface: 'ui',
        authority: 'present_user',
        actionCaller: { kind: 'host' },
      }),
      resolveSharedRunConversation: async () => null,
      resolveProducerConversation: async () => null,
    });
    const params = baseParams({
      onInputAccepted: async (correspondence: unknown) => {
        events.push('commit');
        localInputId = String((correspondence as { localInputId?: unknown }).localInputId);
        expect(correspondence).toEqual({
          kind: 'detached_run', runId: 'run-native-1', localInputId,
          runtimeSelection: projectWorkflowRetainedRuntimeSelectionV1(baseParams().execution),
        });
      },
    });

    await expect(execute(params as never)).resolves.toEqual({
      kind: 'completed', result: { changed: true }, resultEncoding: 'typed',
    });
    expect(events).toEqual(['commit', 'observe']);
    expect(actionExecutor.execute).toHaveBeenNthCalledWith(1, 'execution.run.start', expect.objectContaining({
      sessionId: null,
      intent: 'agent',
      backendTarget: CLAUDE_TARGET,
      instructions: 'Implement it',
      cwd: '/repo',
      permissionMode: 'safe-yolo',
      retentionPolicy: 'resumable',
      runClass: 'long_lived',
      ioMode: 'request_response',
      localInputId,
      resultContract: { kind: 'json', schema: { type: 'object' } },
      modelId: 'sonnet',
      modelSelection: expect.objectContaining({ modelId: 'sonnet' }),
      sessionConfigOptionOverrides: {
        v: 1,
        updatedAt: 1,
        overrides: { effort: { value: 'high', updatedAt: 1 } },
      },
      mcpSelection: expect.objectContaining({ forceIncludeServerIds: ['repo'] }),
      connectedServices: { v: 2, bindingsByServiceId: {} },
      acpSessionModeId: 'plan',
      runtimeDescriptorV1: {
        v: 1,
        agentId: 'happier.agent.claude/claude',
        agent: { backendMode: 'acp' },
      },
    }), expect.objectContaining({
      surface: 'ui',
      authority: 'present_user',
      actionCaller: {
        kind: 'workflowRun',
        runId: 'workflow-1',
        authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
      },
      executionRunTargetMachineId: 'machine-1',
    }));
  });

  it('keeps omitted, explicit-null, and equal-default Run selections distinct at Action admission', async () => {
    const starts: Record<string, unknown>[] = [];
    const actionExecutor = { execute: vi.fn(async (actionId: string, value: unknown) => {
      const input = requireActionInput(value);
      if (actionId !== 'execution.run.start') throw new Error(`unexpected action ${actionId}`);
      starts.push(input);
      return {
        ok: false as const,
        errorCode: 'execution_run_failed',
        error: 'execution_run_failed',
        details: { runCreation: 'noRunCreated' },
      };
    }) };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: async () => null,
      resolveProducerConversation: async () => null,
    });
    const authored = baseParams().execution;
    const { runtimeDescriptorV1: _runtimeDescriptorV1, ...withoutRuntimeDescriptor } = authored;

    await execute(baseParams({ execution: { ...authored, runtimeDescriptorV1: null } }) as never);
    await execute(baseParams({ execution: withoutRuntimeDescriptor }) as never);
    await execute(baseParams({ execution: { ...withoutRuntimeDescriptor, permissionMode: 'default' } }) as never);

    expect(starts[0]).toHaveProperty('runtimeDescriptorV1', null);
    expect(starts[1]).not.toHaveProperty('runtimeDescriptorV1');
    expect(starts[2]).toHaveProperty('permissionMode', 'default');
  });

  it('rejects Session-only launch fields that a detached Run cannot consume', async () => {
    const actionExecutor = { execute: vi.fn() };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: async () => null,
      resolveProducerConversation: async () => null,
    });

    const cases = [
      { execution: { ...baseParams().execution, transcriptStorage: 'direct' } },
      { execution: { ...baseParams().execution, terminal: null } },
      { execution: { ...baseParams().execution, windowsRemoteSessionLaunchMode: null } },
      { execution: { ...baseParams().execution, windowsRemoteSessionConsole: null } },
      { execution: { ...baseParams().execution, windowsTerminalWindowName: null } },
    ];
    for (const entry of cases) {
      await expect(execute(baseParams(entry) as never)).resolves.toEqual({
        kind: 'needs_attention', code: 'target_unavailable',
      });
    }
    expect(actionExecutor.execute).not.toHaveBeenCalled();
  });

  it('carries saved Composer references and portable attachments into a fresh native Run input', async () => {
    const reference = {
      kind: 'happier.file', ref: 'file:src/index.ts', token: '@src/index.ts', label: 'index.ts',
    };
    const attachment = {
      v: 1 as const,
      instanceId: 'review-1',
      attachment: { pluginId: 'acme.review', localId: 'comment' },
      key: 'comment-1',
      value: { reviewId: 'r1' },
      presentation: { label: 'Review', typeLabel: 'Comment' },
    };
    let localInputId = '';
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.start') {
          localInputId = String(input.localInputId);
          return { ok: true as const, result: { runId: 'run-native-1', callId: 'call-1', sidechainId: 'sidechain-1' } };
        }
        if (actionId === 'execution.run.get') {
          return { ok: true as const, result: completedRun('run-native-1', localInputId, 'done') };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: async () => null,
      resolveProducerConversation: async () => null,
    });

    await expect(execute(baseParams({
      step: {
        ...baseParams().step,
        document: { text: 'Review @src/index.ts', references: [reference], attachments: [attachment] },
      },
      input: {
        text: 'Review @src/index.ts', references: [reference], attachments: [attachment], values: [],
      },
    }) as never)).resolves.toMatchObject({ kind: 'completed' });

    expect(actionExecutor.execute.mock.calls[0]?.[1]).toMatchObject({
      structuredInput: { v: 1, mentions: [reference], composerAttachments: [attachment] },
    });
  });

  it('reobserves durable detached correspondence without starting, resuming, or replaying input', async () => {
    const actionExecutor = {
      execute: vi.fn(async (actionId: string) => actionId === 'execution.run.get'
        ? { ok: true as const, result: completedRun('run-existing', 'input-existing', 'retained') }
        : (() => { throw new Error(`unexpected action ${actionId}`); })()),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });
    const params = baseParams({
      invocation: {
        ...baseParams().invocation,
        execution: {
          kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing',
        },
      },
    });

    await expect(execute(params as never)).resolves.toEqual({ kind: 'completed', result: 'retained', resultEncoding: 'typed' });
    expect(actionExecutor.execute).toHaveBeenCalledTimes(1);
    expect(actionExecutor.execute).toHaveBeenCalledWith(
      'execution.run.get',
      { sessionId: null, runId: 'run-existing', includeStructured: false, waitForInputId: 'input-existing' },
      expect.objectContaining({ executionRunTargetMachineId: 'machine-1' }),
    );
  });

  it('ends only Workflow observation at the authored deadline without stopping the active Run', async () => {
    vi.useFakeTimers();
    try {
      const actionExecutor = {
        execute: vi.fn(async (actionId: string, _input: unknown, context?: RpcActionExecutorContext) => {
          if (actionId !== 'execution.run.get') throw new Error(`unexpected action ${actionId}`);
          return await new Promise<{ ok: false; errorCode: 'cancelled'; error: string }>((resolve) => {
            const settle = () => resolve({ ok: false, errorCode: 'cancelled', error: 'observation ended' });
            if (context?.signal?.aborted) settle();
            else context?.signal?.addEventListener('abort', settle, { once: true });
          });
        }),
      };
      const execute = createWorkflowDetachedExecutionRunStepExecutor({
        actionExecutor,
        buildActionContext,
        resolveSharedRunConversation: vi.fn(),
        resolveProducerConversation: vi.fn(),
      });
      const params = baseParams({
        invocation: {
          ...baseParams().invocation,
          observationDeadline: { kind: 'at', expiresAt: new Date(Date.now() + 100).toISOString() },
          execution: {
            kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing',
          },
        },
      });

      const result = execute(params as never);
      await vi.advanceTimersByTimeAsync(100);

      await expect(result).resolves.toEqual({ kind: 'needs_attention', code: 'workflow_step_timeout' });
      expect(actionExecutor.execute.mock.calls.map(([actionId]) => actionId)).toEqual(['execution.run.get']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues the shared retained Run with the next exact native input identity', async () => {
    let localInputId = '';
    const providerResumeIdentity = {
      kind: 'provider_session.v1' as const,
      backendTarget: { kind: 'backend' as const, backendId: 'claude', sourceKind: 'built_in' as const },
      providerSessionId: 'provider-session-1',
    };
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.send') {
          localInputId = String(input.localInputId);
          return { ok: true as const, result: { ok: true } };
        }
        if (actionId === 'execution.run.get') {
          return { ok: true as const, result: completedRun('run-shared', localInputId, 'second turn') };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: async () => ({
        runId: 'run-shared',
        machineId: 'machine-1',
        directory: 'C:\\Users\\Alice\\repo',
        runtimeSelection: projectWorkflowRetainedRuntimeSelectionV1(baseParams().execution),
        providerResumeIdentity,
      }),
      resolveProducerConversation: async () => null,
    });
    const reference = {
      kind: 'happier.file', ref: 'file:src/index.ts', token: '@src/index.ts', label: 'index.ts',
    };
    const attachment = {
      v: 1 as const,
      instanceId: 'review-1',
      attachment: { pluginId: 'acme.review', localId: 'comment' },
      key: 'comment-1', value: { reviewId: 'r1' },
      presentation: { label: 'Review', typeLabel: 'Comment' },
    };
    const onInputAccepted = vi.fn(async () => undefined);
    const params = baseParams({
      onInputAccepted,
      workspace: {
        machineId: 'machine-1',
        directory: 'c:/users/alice/repo',
        checkoutRootPath: 'c:/users/alice/repo',
      },
      input: {
        text: 'Implement it', references: [reference], attachments: [attachment], values: [],
      },
    });

    await expect(execute(params as never)).resolves.toEqual({ kind: 'completed', result: 'second turn', resultEncoding: 'typed' });
    expect(actionExecutor.execute).toHaveBeenNthCalledWith(1, 'execution.run.send', {
      sessionId: null,
      runId: 'run-shared',
      message: 'Implement it',
      delivery: 'prompt',
      resume: true,
      localInputId,
      resultContract: { kind: 'json', schema: { type: 'object' } },
      structuredInput: { v: 1, mentions: [reference], composerAttachments: [attachment] },
    }, expect.anything());
    expect(onInputAccepted).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-shared',
      providerResumeIdentity,
    }));
  });

  it('resumes the provider conversation for only the next authored input when the retained host Run is gone', async () => {
    let localInputId = '';
    const providerResumeIdentity = {
      kind: 'provider_session.v1' as const,
      backendTarget: { kind: 'backend' as const, backendId: 'claude', sourceKind: 'built_in' as const },
      providerSessionId: 'provider-session-1',
    };
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.send') {
          return { ok: false as const, errorCode: 'execution_run_not_found', error: 'gone' };
        }
        if (actionId === 'execution.run.start') {
          localInputId = String(input.localInputId);
          return { ok: true as const, result: { runId: 'run-resumed', callId: 'call-2', sidechainId: 'side-2' } };
        }
        if (actionId === 'execution.run.get') {
          return { ok: true as const, result: completedRun('run-resumed', localInputId, 'resumed turn') };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: async () => ({
        runId: 'run-old',
        machineId: 'machine-1',
        directory: '/repo',
        runtimeSelection: projectWorkflowRetainedRuntimeSelectionV1(baseParams().execution),
        providerResumeIdentity,
      }),
      resolveProducerConversation: async () => null,
    });
    const onInputAccepted = vi.fn(async () => undefined);

    await expect(execute(baseParams({
      onInputAccepted,
      onExecutionObservation: vi.fn(async () => undefined),
    }) as never)).resolves.toEqual({
      kind: 'completed', result: 'resumed turn', resultEncoding: 'typed',
    });
    expect(actionExecutor.execute).toHaveBeenNthCalledWith(2, 'execution.run.start', expect.objectContaining({
      instructions: 'Implement it',
      localInputId,
      resumeHandle: providerResumeIdentity,
    }), expect.objectContaining({
      actionRequestId: `${localInputId}:execution-run-start`,
      executionRunWorkflowObservationSink: expect.any(Object),
    }));
    expect(onInputAccepted).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'detached_run',
      runId: 'run-resumed',
      providerResumeIdentity,
    }));
  });

  it('fails closed when a vanished retained Run has no matching provider resume identity', async () => {
    const actionExecutor = {
      execute: vi.fn(async (actionId: string) => {
        if (actionId === 'execution.run.send') {
          return { ok: false as const, errorCode: 'execution_run_not_found', error: 'gone' };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    for (const providerResumeIdentity of [
      undefined,
      {
        kind: 'provider_session.v1' as const,
        backendTarget: { kind: 'backend' as const, backendId: 'codex', sourceKind: 'built_in' as const },
        providerSessionId: 'other-provider-session',
      },
    ]) {
      const execute = createWorkflowDetachedExecutionRunStepExecutor({
        actionExecutor,
        buildActionContext,
        resolveSharedRunConversation: async () => ({
          runId: 'run-old', machineId: 'machine-1', directory: '/repo',
          runtimeSelection: projectWorkflowRetainedRuntimeSelectionV1(baseParams().execution),
          ...(providerResumeIdentity ? { providerResumeIdentity } : {}),
        }),
        resolveProducerConversation: async () => null,
      });

      await expect(execute(baseParams() as never)).resolves.toEqual({
        kind: 'needs_attention', code: 'continuation_unavailable',
      });
    }
    expect(actionExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it('reuses the coordinator-prepared retained Run instead of resolving it after workspace selection', async () => {
    let localInputId = '';
    const resolveSharedRunConversation = vi.fn(async () => ({
      runId: 'run-shared', machineId: 'machine-1', directory: '/repo',
      runtimeSelection: projectWorkflowRetainedRuntimeSelectionV1(baseParams().execution),
    }));
    const deps = {
      buildActionContext,
      resolveSharedRunConversation,
      resolveProducerConversation: vi.fn(async () => null),
      actionExecutor: {
        execute: vi.fn(async (actionId: string, value: unknown) => {
          const input = requireActionInput(value);
          if (actionId === 'execution.run.send') {
            localInputId = String(input.localInputId);
            return { ok: true as const, result: { ok: true } };
          }
          if (actionId === 'execution.run.get') {
            return { ok: true as const, result: completedRun('run-shared', localInputId, 'done') };
          }
          throw new Error(`unexpected action ${actionId}`);
        }),
      },
    };
    const params = baseParams();
    const preparedStep = await prepareWorkflowDetachedExecutionRunStep(deps, params as never);
    const execute = createWorkflowDetachedExecutionRunStepExecutor(deps);

    await expect(execute({ ...params, preparedStep } as never)).resolves.toMatchObject({
      kind: 'completed', result: 'done',
    });
    expect(resolveSharedRunConversation).toHaveBeenCalledOnce();
  });

  it('fails closed before retained Run reuse when its effective runtime witness is absent or changed', async () => {
    const actionExecutor = { execute: vi.fn() };
    const requested = baseParams().execution;
    for (const runtimeSelection of [
      undefined,
      projectWorkflowRetainedRuntimeSelectionV1({ ...requested, profileId: 'different-profile' }),
    ]) {
      const execute = createWorkflowDetachedExecutionRunStepExecutor({
        actionExecutor,
        buildActionContext,
        resolveSharedRunConversation: async () => ({
          runId: 'run-shared', machineId: 'machine-1', directory: '/repo',
          ...(runtimeSelection ? { runtimeSelection } : {}),
        }),
        resolveProducerConversation: async () => null,
      });

      await expect(execute(baseParams() as never)).resolves.toEqual({
        kind: 'needs_attention', code: 'workflow_conversation_unavailable',
      });
    }
    expect(actionExecutor.execute).not.toHaveBeenCalled();
  });

  it('does not equate a Windows home sibling prefix when retaining a detached conversation', async () => {
    const actionExecutor = { execute: vi.fn() };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor, buildActionContext,
      resolveSharedRunConversation: async () => ({
        runId: 'run-shared', machineId: 'machine-1', directory: 'C:\\Users\\Alice2\\repo',
      }),
      resolveProducerConversation: async () => null,
    });

    await expect(execute(baseParams({
      workspace: {
        machineId: 'machine-1', directory: 'c:/users/alice/repo',
        checkoutRootPath: 'c:/users/alice/repo',
      },
    }) as never)).resolves.toEqual({
      kind: 'needs_attention', code: 'workflow_conversation_unavailable',
    });
    expect(actionExecutor.execute).not.toHaveBeenCalled();
  });

  it('settles cancellation through the canonical stop owner and reports uncertainty when stop custody is unknown', async () => {
    const controller = new AbortController();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown, context?: RpcActionExecutorContext) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.get') {
          controller.abort(WORKFLOW_CANCEL_REQUESTED_ABORT_REASON);
          return { ok: true as const, result: activeRun('run-existing', 'input-existing') };
        }
        if (actionId === 'execution.run.stop') {
          expect(input).toEqual({ sessionId: null, runId: 'run-existing' });
          expect(context?.signal).toBeUndefined();
          return { ok: false as const, errorCode: 'execution_run_failed', error: 'custody unknown' };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });
    const params = baseParams({
      signal: controller.signal,
      invocation: {
        ...baseParams().invocation,
        execution: {
          kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing',
        },
      },
    });

    await expect(execute(params as never)).resolves.toEqual({
      kind: 'outcome_uncertain', code: 'execution_run_failed',
    });
    expect(actionExecutor.execute.mock.calls.map(([actionId]) => actionId))
      .toEqual(['execution.run.get', 'execution.run.stop', 'execution.run.get']);
  });

  it('does not treat successful host stop acceptance as provider-terminal cancellation', async () => {
    const controller = new AbortController();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, _input: unknown, context?: RpcActionExecutorContext) => {
        if (actionId === 'execution.run.get') {
          controller.abort(WORKFLOW_CANCEL_REQUESTED_ABORT_REASON);
          // The host projection still reports the exact input active after
          // stop acceptance: no definitive fact, so custody stays unresolved.
          return { ok: true as const, result: activeRun('run-existing', 'input-existing') };
        }
        if (actionId === 'execution.run.stop') {
          expect(context?.signal).toBeUndefined();
          return { ok: true as const, result: { status: 'stopped' } };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });

    await expect(execute(baseParams({
      signal: controller.signal,
      invocation: {
        ...baseParams().invocation,
        execution: {
          kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing',
        },
      },
    }) as never)).resolves.toEqual({
      kind: 'outcome_uncertain', code: 'workflow_outcome_unresolved',
    });
    expect(actionExecutor.execute.mock.calls.map(([actionId]) => actionId))
      .toEqual(['execution.run.get', 'execution.run.stop', 'execution.run.get']);
  });

  it('records the host-cancelled exact input observed after stop instead of relabeling stop custody', async () => {
    const controller = new AbortController();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown, context?: RpcActionExecutorContext) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.get' && controller.signal.aborted) {
          expect(input).toEqual({ sessionId: null, runId: 'run-existing', includeStructured: false });
          expect(context?.signal).toBeUndefined();
          return { ok: true as const, result: {
            run: {
              ...activeRun('run-existing', 'input-existing').run,
              status: 'cancelled',
              inputTurns: {
                occurrenceId: 'occurrence-run-existing',
                last: { turnId: 'turn-input-existing', inputIds: ['input-existing'], state: 'cancelled' },
              },
            },
          } };
        }
        if (actionId === 'execution.run.get') {
          controller.abort(WORKFLOW_CANCEL_REQUESTED_ABORT_REASON);
          return { ok: false as const, errorCode: 'cancelled', error: 'observation aborted' };
        }
        if (actionId === 'execution.run.stop') return { ok: true as const, result: { status: 'stopped' } };
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });

    await expect(execute(baseParams({
      signal: controller.signal,
      invocation: {
        ...baseParams().invocation,
        execution: { kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing' },
      },
    }) as never)).resolves.toEqual({ kind: 'cancelled', code: 'execution_run_input_cancelled' });
    expect(actionExecutor.execute.mock.calls.map(([actionId]) => actionId))
      .toEqual(['execution.run.get', 'execution.run.stop', 'execution.run.get']);
  });

  it('reuses the exact completed result when cancellation loses the observation response of an already terminal turn', async () => {
    const controller = new AbortController();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string) => {
        if (actionId === 'execution.run.get' && controller.signal.aborted) {
          return { ok: true as const, result: completedRun('run-existing', 'input-existing', 'completed-before-stop') };
        }
        if (actionId === 'execution.run.get') {
          controller.abort(WORKFLOW_CANCEL_REQUESTED_ABORT_REASON);
          return { ok: false as const, errorCode: 'cancelled', error: 'observation aborted' };
        }
        if (actionId === 'execution.run.stop') {
          return { ok: false as const, errorCode: 'execution_run_not_allowed', error: 'Not running' };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });

    await expect(execute(baseParams({
      signal: controller.signal,
      invocation: {
        ...baseParams().invocation,
        execution: { kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing' },
      },
    }) as never)).resolves.toEqual({
      kind: 'completed', result: 'completed-before-stop', resultEncoding: 'typed',
    });
    expect(actionExecutor.execute.mock.calls.map(([actionId]) => actionId))
      .toEqual(['execution.run.get', 'execution.run.stop', 'execution.run.get']);
  });

  it('leaves a surviving Run untouched when the claim is interrupted without a cancellation reason', async () => {
    const controller = new AbortController();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string) => {
        if (actionId !== 'execution.run.get') throw new Error(`unexpected action ${actionId}`);
        controller.abort();
        return { ok: false as const, errorCode: 'cancelled', error: 'observation aborted' };
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });

    await expect(execute(baseParams({
      signal: controller.signal,
      invocation: {
        ...baseParams().invocation,
        execution: { kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing' },
      },
    }) as never)).rejects.toBeInstanceOf(WorkflowRuntimeInterruption);
    expect(actionExecutor.execute.mock.calls.map(([actionId]) => actionId)).toEqual(['execution.run.get']);
  });

  it('keeps exact terminal input evidence when cancellation races the observation response', async () => {
    const controller = new AbortController();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string) => {
        if (actionId !== 'execution.run.get') throw new Error(`unexpected action ${actionId}`);
        controller.abort();
        return {
          ok: true as const,
          result: completedRun('run-existing', 'input-existing', 'completed-before-stop'),
        };
      }),
    };
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: vi.fn(),
      resolveProducerConversation: vi.fn(),
    });

    await expect(execute(baseParams({
      signal: controller.signal,
      invocation: {
        ...baseParams().invocation,
        execution: {
          kind: 'detached_run', runId: 'run-existing', localInputId: 'input-existing',
        },
      },
    }) as never)).resolves.toEqual({
      kind: 'completed', result: 'completed-before-stop', resultEncoding: 'typed',
    });
    expect(actionExecutor.execute).toHaveBeenCalledOnce();
  });
});

describe('workflow attached Execution Run step executor', () => {
  it('starts in the owning Session and persists discriminated Run correspondence before observation', async () => {
    let localInputId = '';
    const events: string[] = [];
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown) => {
        const input = requireActionInput(value);
        if (actionId === 'execution.run.start') {
          return { ok: true as const, result: { runId: 'run-attached', callId: 'call-1', sidechainId: 'side-1' } };
        }
        if (actionId === 'execution.run.get') {
          events.push('observe');
          return { ok: true as const, result: completedRun('run-attached', localInputId, 'attached') };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const sendInput = vi.fn(async (input: {
      localInputId: string;
      resultContract: unknown;
    }) => {
      localInputId = input.localInputId;
      events.push('admit');
      return { kind: 'accepted' as const };
    });
    const execute = createWorkflowAttachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      materializeConversation: async () => ({ sessionId: 'session-1', machineId: 'machine-1', directory: '/repo' }),
      resolveRunSession: async () => null,
      sendInput,
    });
    const params = baseParams({
      executionTarget: { kind: 'attached_run' },
      input: {
        text: 'Implement it',
        references: [{ kind: 'file', path: 'src/index.ts' }],
        attachments: [{
          v: 1,
          instanceId: 'review-1',
          attachment: { pluginId: 'acme.review', localId: 'comment' },
          key: 'comment-1', value: { reviewId: 'r1' },
          presentation: { label: 'Review', typeLabel: 'Comment' },
        }],
        values: [],
      },
      authorization: {
        admittedPermissionCeiling: 'safe-yolo',
        principal: { kind: 'host' },
        sourceAuthority: {
          mediatorPluginId: 'happier.channels',
          sourceRef: 'channels:binding:binding-1',
          sourceRevisionOrEpoch: '4:7',
          remoteApprovalMaxScope: 'session',
        },
      },
      onInputAccepted: async (correspondence: unknown) => {
        events.push('commit');
        expect(correspondence).toMatchObject({
          kind: 'attached_run',
          sessionId: 'session-1',
          runId: 'run-attached',
          localInputId: expect.stringMatching(/^workflow-input-v2:/),
        });
        localInputId = (correspondence as { localInputId: string }).localInputId;
      },
    });

    await expect(execute(params as never)).resolves.toEqual({ kind: 'completed', result: 'attached', resultEncoding: 'typed' });
    expect(events).toEqual(['commit', 'admit', 'observe']);
    expect(actionExecutor.execute).toHaveBeenNthCalledWith(1, 'execution.run.start', expect.objectContaining({
      sessionId: 'session-1', intent: 'agent', cwd: '/repo',
      initialInput: { kind: 'deferred_session_pending' },
    }), expect.objectContaining({
      actionRequestId: expect.stringMatching(/:execution-run-start$/),
    }));
    expect(actionExecutor.execute.mock.calls[0]?.[1]).not.toHaveProperty('instructions');
    expect(actionExecutor.execute.mock.calls[0]?.[1]).not.toHaveProperty('localInputId');
    expect(actionExecutor.execute.mock.calls[0]?.[1]).not.toHaveProperty('resultContract');
    expect(sendInput).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'session-1',
      runId: 'run-attached',
      workflowRunId: 'workflow-1',
      invocationRecordId: 'invocation-1',
      text: 'Implement it',
      references: [{ kind: 'file', path: 'src/index.ts' }],
      attachments: [{
        v: 1,
        instanceId: 'review-1',
        attachment: { pluginId: 'acme.review', localId: 'comment' },
        key: 'comment-1', value: { reviewId: 'r1' },
        presentation: { label: 'Review', typeLabel: 'Comment' },
      }],
      localInputId,
      resultContract: { kind: 'json', schema: { type: 'object' } },
      permissionMode: 'safe-yolo',
      sourceAuthority: {
        mediatorPluginId: 'happier.channels',
        sourceRef: 'channels:binding:binding-1',
        sourceRevisionOrEpoch: '4:7',
        remoteApprovalMaxScope: 'session',
      },
      modelSelectionInput: baseParams().execution.modelSelection,
    });
    expect(actionExecutor.execute).toHaveBeenNthCalledWith(2, 'execution.run.get', {
      sessionId: 'session-1', runId: 'run-attached', includeStructured: false, waitForInputId: localInputId,
    }, expect.anything());
  });

  it('reclaims one attached Run and never admits input before durable correspondence', async () => {
    const startedRunIds = new Map<string, string>();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, _value: unknown, context?: RpcActionExecutorContext) => {
        if (actionId === 'execution.run.start') {
          const requestId = context?.actionRequestId;
          if (!requestId) throw new Error('missing stable Workflow start request id');
          let runId = startedRunIds.get(requestId);
          if (!runId) {
            runId = `run-${startedRunIds.size + 1}`;
            startedRunIds.set(requestId, runId);
          }
          return { ok: true as const, result: { runId, callId: 'call-1', sidechainId: 'side-1' } };
        }
        if (actionId === 'execution.run.get') {
          return { ok: true as const, result: activeRun('run-1', 'unused') };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const sendInput = vi.fn(async () => ({ kind: 'accepted' as const }));
    let commitAttempts = 0;
    const accepted: unknown[] = [];
    const execute = createWorkflowAttachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      materializeConversation: async () => ({ sessionId: 'session-1', machineId: 'machine-1', directory: '/repo' }),
      resolveRunSession: async () => null,
      sendInput,
    });
    const invocation = baseParams({
      executionTarget: { kind: 'attached_run' },
      onInputAccepted: async (correspondence: unknown) => {
        commitAttempts += 1;
        if (commitAttempts === 1) throw new Error('durable correspondence write failed');
        accepted.push(correspondence);
      },
    });

    await expect(execute(invocation as never)).rejects.toThrow('durable correspondence write failed');
    expect(sendInput).not.toHaveBeenCalled();
    await expect(execute(invocation as never)).resolves.toEqual({
      kind: 'outcome_uncertain',
      code: 'execution_run_input_result_unavailable',
    });

    expect(startedRunIds.size).toBe(1);
    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(accepted).toEqual([expect.objectContaining({ runId: 'run-1' })]);
    const starts = actionExecutor.execute.mock.calls.filter(([actionId]) => actionId === 'execution.run.start');
    expect(starts).toHaveLength(2);
    expect(starts[0]?.[2]).toMatchObject({ actionRequestId: expect.any(String) });
    expect(starts[1]?.[2]).toMatchObject({ actionRequestId: starts[0]?.[2]?.actionRequestId });
  });

  it('retries detached post-start persistence with one stable Run start identity', async () => {
    const startRequestIds: string[] = [];
    let localInputId = '';
    const actionExecutor = {
      execute: vi.fn(async (actionId: string, value: unknown, context?: RpcActionExecutorContext) => {
        if (actionId === 'execution.run.start') {
          const input = requireActionInput(value);
          localInputId = String(input.localInputId);
          startRequestIds.push(String(context?.actionRequestId));
          return { ok: true as const, result: { runId: 'run-stable', callId: 'call-1', sidechainId: 'side-1' } };
        }
        if (actionId === 'execution.run.get') {
          return { ok: true as const, result: activeRun('run-stable', localInputId) };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    let commitAttempts = 0;
    const execute = createWorkflowDetachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      resolveSharedRunConversation: async () => null,
      resolveProducerConversation: async () => null,
    });
    const invocation = baseParams({
      onInputAccepted: async () => {
        commitAttempts += 1;
        if (commitAttempts === 1) throw new Error('durable correspondence write failed');
      },
    });

    await expect(execute(invocation as never)).rejects.toThrow('durable correspondence write failed');
    await expect(execute(invocation as never)).resolves.toEqual({
      kind: 'outcome_uncertain',
      code: 'execution_run_input_result_unavailable',
    });
    expect(startRequestIds).toHaveLength(2);
    expect(startRequestIds[0]).toMatch(/:execution-run-start$/);
    expect(startRequestIds[1]).toBe(startRequestIds[0]);
  });

  it('persists the known attached Run/input correspondence when Session Pending admission is outcome-unknown', async () => {
    const actionExecutor = {
      execute: vi.fn(async (actionId: string) => {
        if (actionId === 'execution.run.start') {
          return { ok: true as const, result: { runId: 'run-attached', callId: 'call-1', sidechainId: 'side-1' } };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const sendInput = vi.fn(async () => ({
      kind: 'outcome_uncertain' as const,
      code: 'session_input_admission_outcome_unknown',
    }));
    const onInputAccepted = vi.fn(async () => undefined);
    const execute = createWorkflowAttachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      materializeConversation: async () => ({ sessionId: 'session-1', machineId: 'machine-1', directory: '/repo' }),
      resolveRunSession: async () => null,
      sendInput,
    });

    await expect(execute(baseParams({
      executionTarget: { kind: 'attached_run' },
      onInputAccepted,
    }) as never)).resolves.toEqual({
      kind: 'outcome_uncertain',
      code: 'session_input_admission_outcome_unknown',
    });
    expect(onInputAccepted).toHaveBeenCalledWith({
      kind: 'attached_run',
      sessionId: 'session-1',
      runId: 'run-attached',
      localInputId: expect.any(String),
    });
  });

  it('does not persist attached input correspondence when claim interruption caused uncertain admission', async () => {
    const controller = new AbortController();
    const actionExecutor = {
      execute: vi.fn(async (actionId: string) => {
        if (actionId === 'execution.run.start') {
          return { ok: true as const, result: { runId: 'run-attached', callId: 'call-1', sidechainId: 'side-1' } };
        }
        throw new Error(`unexpected action ${actionId}`);
      }),
    };
    const sendInput = vi.fn(async () => {
      controller.abort(new Error('claim lost'));
      return {
        kind: 'outcome_uncertain' as const,
        code: 'session_input_admission_outcome_unknown',
      };
    });
    const onInputAccepted = vi.fn(async () => undefined);
    const execute = createWorkflowAttachedExecutionRunStepExecutor({
      actionExecutor,
      buildActionContext,
      materializeConversation: async () => ({ sessionId: 'session-1', machineId: 'machine-1', directory: '/repo' }),
      resolveRunSession: async () => null,
      sendInput,
    });

    await expect(execute(baseParams({
      executionTarget: { kind: 'attached_run' },
      onInputAccepted,
      signal: controller.signal,
    }) as never)).rejects.toBeInstanceOf(WorkflowRuntimeInterruption);
    expect(onInputAccepted).toHaveBeenCalledWith({
      kind: 'attached_run',
      sessionId: 'session-1',
      runId: 'run-attached',
      localInputId: expect.any(String),
    });
  });
});

describe('workflow step executor target dispatch', () => {
  it('selects one leaf only from the immutable Run execution target', async () => {
    const session = vi.fn(async () => ({ kind: 'completed' as const, result: 'session' }));
    const attachedRun = vi.fn(async () => ({ kind: 'completed' as const, result: 'attached' }));
    const detachedRun = vi.fn(async () => ({ kind: 'completed' as const, result: 'detached' }));
    const execute = createWorkflowStepExecutorDispatcher({ session, attachedRun, detachedRun });
    const base = baseParams();

    await expect(execute({ ...base, executionTarget: { kind: 'session' }, execution: { agentTarget: CLAUDE_TARGET } } as never))
      .resolves.toMatchObject({ result: 'session' });
    await expect(execute({ ...base, executionTarget: { kind: 'attached_run' }, execution: { agentTarget: CLAUDE_TARGET } } as never))
      .resolves.toMatchObject({ result: 'attached' });
    await expect(execute({ ...base, executionTarget: { kind: 'detached_run' }, execution: { agentTarget: CLAUDE_TARGET } } as never))
      .resolves.toMatchObject({ result: 'detached' });
    expect(session).toHaveBeenCalledTimes(1);
    expect(attachedRun).toHaveBeenCalledTimes(1);
    expect(detachedRun).toHaveBeenCalledTimes(1);
  });
});
