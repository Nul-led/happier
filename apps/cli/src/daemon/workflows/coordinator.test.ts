import { describe, expect, it, vi } from 'vitest';

import {
  projectWorkflowRetainedRuntimeSelectionV1,
  type WorkflowDefinitionV1,
  type WorkflowProgressEnvelopeV1,
  type WorkflowStepExecutionSelection,
} from '@happier-dev/protocol';
import { abortAutomationRunForAuthoritativeCancellation } from '@/daemon/automation/automationRunCancellation';
import {
  createInMemoryWorkflowCoordinatorStore,
  createWorkflowCoordinator,
  doesWorkflowImmediateEligibleStepTargetSession,
  WORKFLOW_CANCEL_REQUESTED_ABORT_REASON,
  WorkflowRuntimeInterruption,
  workflowInvocationKey,
  type WorkflowCoordinatorStore,
  type WorkflowStepExecutor,
  type WorkflowWorkspaceResolver,
} from './coordinator';

const agentTarget = { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } } as const;
const workspace = { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } as const;
const executionTarget = { kind: 'session' } as const;
const authorization = { admittedPermissionCeiling: 'default', principal: { kind: 'host' } } as const;
const resolveWorkspace = vi.fn(async () => ({ ok: true as const, workspace }));

function step(id: string, text = id) {
  return {
    kind: 'step' as const,
    id,
    document: { text, references: [], attachments: [] },
    input: [],
    result: { kind: 'text' as const },
  };
}

function freshStep(id: string, text = id) {
  return { ...step(id, text), execution: { conversation: { kind: 'fresh' as const } } };
}

/**
 * Detached correspondence exactly as the Execution Run executor persists it:
 * the effective admitted runtime selection travels with the native Run identity.
 */
function detachedRun(
  runId: string,
  localInputId: string,
  execution: WorkflowStepExecutionSelection = { agentTarget },
) {
  return {
    kind: 'detached_run' as const,
    runId,
    localInputId,
    runtimeSelection: projectWorkflowRetainedRuntimeSelectionV1(execution),
  };
}

function definition(blocks: WorkflowDefinitionV1['blocks']): WorkflowDefinitionV1 {
  return { version: 1, inputs: [], defaults: { agentTarget }, blocks };
}

describe('workflow coordinator', () => {
  it('keeps an acknowledged stop request interrupted until exact terminal observation', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const controller = new AbortController();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store, resolveWorkspace,
      executeStep: async ({ onInputAccepted }) => {
        await onInputAccepted({ kind: 'session', sessionId: 'session-1', localInputId: 'input-1' });
        controller.abort('workflow_cancel_requested');
        return { kind: 'cancelled', code: 'session_input_turn_cancel_requested' };
      },
    });
    await expect(coordinator.run({
      runId: 'run-stop-pending', definition: definition([step('work')]), inputs: {},
      executionTarget, authorization, signal: controller.signal,
    })).resolves.toEqual({ state: 'interrupted', reason: 'session_input_turn_cancel_requested' });
    expect([...store.records.values()].find((record) => record.blockId === 'work')?.lifecycle)
      .toBe('cancel_requested');
  });

  it('reports authority revocation as interruption after the incumbent child owner confirms stop', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const controller = new AbortController();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ onInputAccepted }) => {
        await onInputAccepted({ kind: 'session', sessionId: 'session-1', localInputId: 'input-1' });
        controller.abort('workflow_authorization_not_current');
        return { kind: 'cancelled', code: 'session_input_turn_cancel_requested' };
      },
    });

    await expect(coordinator.run({
      runId: 'run-revoked',
      definition: definition([step('work')]),
      inputs: {},
      executionTarget,
      authorization,
      signal: controller.signal,
    })).resolves.toEqual({
      state: 'interrupted',
      reason: 'workflow_authorization_not_current',
    });
    expect(store.read(workflowInvocationKey({
      runId: 'run-revoked', blockId: 'work', scope: [], attempt: 0,
    }))).toMatchObject({
      lifecycle: 'cancelled',
      reason: 'workflow_authorization_not_current',
    });
  });

  it('projects only a directly addressable immediate frozen Session binding for self-wait prevention', () => {
    const workflow = definition([
      { ...step('first'), execution: { conversation: { kind: 'existing_session', sessionId: 'session-a', machineId: 'machine-1' } } },
      step('second'),
    ]);
    const checkpoint = {
      kind: 'happier.workflow-checkpoint.v1' as const,
      rootRecordId: 'root-1',
      nextSequence: '1',
      frontier: { nextBlockOrdinal: 0, paused: false },
    };
    expect(doesWorkflowImmediateEligibleStepTargetSession({
      definition: workflow,
      checkpoint: null,
      executionTarget,
      sessionId: 'session-a',
    })).toBe(true);
    expect(doesWorkflowImmediateEligibleStepTargetSession({
      definition: workflow,
      checkpoint,
      executionTarget,
      sessionId: 'session-b',
    })).toBe(false);
    expect(doesWorkflowImmediateEligibleStepTargetSession({
      definition: workflow,
      checkpoint,
      executionTarget: { kind: 'detached_run' },
      sessionId: 'session-a',
    })).toBe(false);
    expect(doesWorkflowImmediateEligibleStepTargetSession({
      definition: workflow,
      checkpoint: { ...checkpoint, frontier: { ...checkpoint.frontier, paused: true } },
      executionTarget,
      sessionId: 'session-a',
    })).toBe(false);
    expect(doesWorkflowImmediateEligibleStepTargetSession({
      definition: definition([{
        ...step('conditional'),
        onlyWhen: { kind: 'compare', operator: 'eq', left: { kind: 'literal', value: true }, right: { kind: 'literal', value: true } },
        execution: { conversation: { kind: 'existing_session', sessionId: 'session-a', machineId: 'machine-1' } },
      }]),
      checkpoint: null,
      executionTarget,
      sessionId: 'session-a',
    })).toBe(false);
  });

  it('executes depth-first declaration order and resumes without replaying completed invocations', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const commitFrontier = vi.fn(async (
      _value: Parameters<NonNullable<WorkflowCoordinatorStore['commitFrontier']>>[0],
    ) => undefined);
    const durableStore = { ...store, commitFrontier };
    const calls: string[] = [];
    const executeStep = vi.fn(async ({ step: current }: { step: { id: string } }) => {
      calls.push(current.id);
      return { kind: 'completed' as const, result: `${current.id}-result` };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store: durableStore, executeStep, resolveWorkspace });
    const workflow = definition([step('a'), step('b')]);

    await expect(coordinator.run({ runId: 'run-1', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'succeeded' });
    await expect(coordinator.run({ runId: 'run-1', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(calls).toEqual(['a', 'b']);
    expect(commitFrontier.mock.calls.map(([value]) => value)).toEqual([
      { nextBlockOrdinal: 1 },
      { nextBlockOrdinal: 2 },
      { nextBlockOrdinal: 1 },
      { nextBlockOrdinal: 2 },
    ]);
    expect(store.read(workflowInvocationKey({ runId: 'run-1', blockId: 'a', scope: [], attempt: 0 }))?.result)
      .toBe('a-result');
  });

  it('binds the final result to its exact persisted producer invocation', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ step: current }) => ({ kind: 'completed', result: `${current.id}-result` }),
    });
    const workflow = {
      ...definition([step('analyze'), step('publish')]),
      finalOutput: {
        kind: 'result' as const,
        producer: { blockId: 'publish', scope: { kind: 'current' as const } },
        path: [],
      },
    };

    const result = await coordinator.run({
      runId: 'run-final-producer', definition: workflow, inputs: {}, executionTarget, authorization,
    });
    const producer = await store.read(workflowInvocationKey({
      runId: 'run-final-producer', blockId: 'publish', scope: [], attempt: 0,
    }));

    expect(result).toMatchObject({
      state: 'succeeded',
      finalOutput: 'publish-result',
      finalResult: {
        kind: 'happier.workflow-final-result.v1',
        result: { kind: 'text', value: 'publish-result' },
        producerInvocation: { recordId: producer?.recordId },
      },
    });
  });

  it('retains a top-level container final output with its exact producer invocation', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ step: current }) => ({ kind: 'completed', result: `${current.id}-result` }),
    });
    const workflow: WorkflowDefinitionV1 = {
      ...definition([{
        kind: 'parallel', id: 'fan', failurePolicy: 'fail_stop', branches: [
          { id: 'first', blocks: [step('a')] },
          { id: 'second', blocks: [step('b')] },
        ],
      }]),
      finalOutput: {
        kind: 'result', producer: { blockId: 'fan', scope: { kind: 'current' } }, path: [],
      },
    };

    const result = await coordinator.run({
      runId: 'run-container-final-producer', definition: workflow, inputs: {}, executionTarget, authorization,
    });
    const producer = await store.read(workflowInvocationKey({
      runId: 'run-container-final-producer', blockId: 'fan', scope: [], attempt: 0,
    }));

    expect(result).toMatchObject({
      state: 'succeeded',
      finalResult: {
        kind: 'happier.workflow-final-result.v1',
        result: { kind: 'json' },
        producerInvocation: { recordId: producer?.recordId },
      },
    });
  });

  it('persists owner-reported usage on the exact completed leaf invocation', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async () => ({
        kind: 'completed',
        result: 'done',
        usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
      }),
    });

    await coordinator.run({
      runId: 'run-usage', definition: definition([step('work')]), inputs: {}, executionTarget, authorization,
    });

    expect(store.read(workflowInvocationKey({
      runId: 'run-usage', blockId: 'work', scope: [], attempt: 0,
    }))).toMatchObject({
      lifecycle: 'completed',
      usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
    });
  });

  it('keeps pre-terminal detached identity and usage when input acceptance arrives afterward', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const execution = detachedRun('native-run-1', 'workflow-input-1');
    const providerResumeIdentity = {
      kind: 'provider_session.v1' as const,
      backendTarget: { kind: 'backend' as const, backendId: 'test', sourceKind: 'built_in' as const },
      providerSessionId: 'provider-session-1',
    };
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ onExecutionObservation, onInputAccepted }) => {
        await onExecutionObservation?.({
          execution: { ...execution, providerResumeIdentity },
        });
        await onExecutionObservation?.({
          execution,
          usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
        });
        await onInputAccepted(execution);
        return { kind: 'completed', result: 'done' };
      },
    });

    await expect(coordinator.run({
      runId: 'run-detached-observation',
      definition: definition([step('work')]),
      inputs: {},
      executionTarget: { kind: 'detached_run' },
      authorization,
    })).resolves.toMatchObject({ state: 'succeeded' });

    expect(store.read(workflowInvocationKey({
      runId: 'run-detached-observation', blockId: 'work', scope: [], attempt: 0,
    }))).toMatchObject({
      lifecycle: 'completed',
      execution: { ...execution, providerResumeIdentity },
      usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
    });
  });

  it('persists owner-reported usage on the exact failed leaf invocation', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async () => ({
        kind: 'failed',
        code: 'provider_failed',
        usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
      }),
    });

    await expect(coordinator.run({
      runId: 'run-failed-usage', definition: definition([step('work')]), inputs: {}, executionTarget, authorization,
    })).resolves.toEqual({ state: 'interrupted', reason: 'provider_failed' });

    expect(store.read(workflowInvocationKey({
      runId: 'run-failed-usage', blockId: 'work', scope: [], attempt: 0,
    }))).toMatchObject({
      lifecycle: 'failed',
      usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
    });
  });

  it('persists owner-reported usage on the exact cancelled leaf invocation', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async () => ({
        kind: 'cancelled',
        code: 'provider_cancelled',
        usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
      }),
    });

    await expect(coordinator.run({
      runId: 'run-cancelled-usage', definition: definition([step('work')]), inputs: {}, executionTarget, authorization,
    })).resolves.toEqual({ state: 'cancelled', reason: 'provider_cancelled' });

    expect(store.read(workflowInvocationKey({
      runId: 'run-cancelled-usage', blockId: 'work', scope: [], attempt: 0,
    }))).toMatchObject({
      lifecycle: 'cancelled',
      usage: { inputTokens: 8, outputTokens: 3, costUsd: 0.02 },
    });
  });

  it('materializes the exact persisted producer workspace path into a downstream step input', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const consumed: unknown[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace: async ({ step: current, invocation }) => {
        const selected = current.id === 'analyze'
          ? { machineId: 'machine-1', directory: '/worktrees/analyze/packages/app', checkoutRootPath: '/worktrees/analyze' }
          : workspace;
        await store.commitFact({
          key: invocation.key,
          lifecycle: invocation.lifecycle,
          workspace: { descriptor: selected },
        });
        return { ok: true, workspace: selected };
      },
      executeStep: async ({ step: current, input }) => {
        if (current.id === 'implement') consumed.push(...input.values);
        return { kind: 'completed', result: `${current.id}-result` };
      },
    });
    const workflow = definition([
      step('analyze'),
      {
        ...step('implement'),
        input: [{
          kind: 'workspace',
          producer: { blockId: 'analyze', scope: { kind: 'current' } },
          field: 'directory',
        }],
      },
    ]);

    await expect(coordinator.run({
      runId: 'run-workspace-input', definition: workflow, inputs: {}, executionTarget, authorization,
    })).resolves.toEqual({ state: 'succeeded' });
    expect(consumed).toEqual(['/worktrees/analyze/packages/app']);
  });

  it('persists the prepared objective and resolved context before executing a step', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const executeStep = vi.fn(async () => ({ kind: 'completed' as const, result: 'done' }));
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace,
    });
    const authoredStep = {
      ...step('prepared', 'Finish the reviewed objective'),
      input: [{ kind: 'input' as const, name: 'selectedContext' }],
    };

    await expect(coordinator.run({
      runId: 'run-prepared',
      definition: { ...definition([authoredStep]), inputs: [{ name: 'selectedContext', valueType: 'string', required: true }] },
      inputs: { selectedContext: 'recorded context' }, executionTarget, authorization,
    })).resolves.toMatchObject({ state: 'succeeded' });

    expect(store.read(workflowInvocationKey({
      runId: 'run-prepared', blockId: 'prepared', scope: [], attempt: 0,
    }))).toMatchObject({
      input: {
        document: authoredStep.document,
        input: ['recorded context'],
      },
    });
  });

  it('runs parallel item bodies as independent ordered pipelines and enforces only authored capacity', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const events: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const gates = new Map<string, () => void>();
    const executeStep = vi.fn(async ({ step: current, item }: { step: { id: string }; item?: { index: number } }) => {
      const label = `${current.id}:${item?.index}`;
      events.push(`start:${label}`);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => gates.set(label, resolve));
      active -= 1;
      events.push(`end:${label}`);
      return { kind: 'completed' as const, result: label };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });
    const workflow = definition([{
      kind: 'loop', id: 'items',
      repetition: {
        kind: 'items', items: { kind: 'literal', value: ['A', 'A', 'B'] },
        execution: 'parallel', failurePolicy: 'collect_outcomes', maxConcurrent: 2,
      },
      body: [freshStep('analyze'), freshStep('verify')],
    }]);

    const running = coordinator.run({ runId: 'run-2', definition: workflow, inputs: {}, executionTarget, authorization });
    await vi.waitFor(() => expect(events).toEqual(['start:analyze:0', 'start:analyze:1']));
    expect(maximumActive).toBe(2);
    expect([...store.records.values()].find((record) =>
      record.blockId === 'items'
      && record.frame?.source.kind === 'item'
      && record.path.scope[0]?.kind === 'iteration'
      && record.path.scope[0].index === 2)).toBeUndefined();
    gates.get('analyze:0')!();
    await vi.waitFor(() => expect(events).toContain('start:verify:0'));
    expect(events).not.toContain('start:analyze:2');
    gates.get('verify:0')!();
    await vi.waitFor(() => expect(events).toContain('start:analyze:2'));
    gates.get('analyze:1')!();
    await vi.waitFor(() => expect(events).toContain('start:verify:1'));
    gates.get('verify:1')!();
    gates.get('analyze:2')!();
    await vi.waitFor(() => expect(events).toContain('start:verify:2'));
    gates.get('verify:2')!();
    await expect(running).resolves.toMatchObject({ state: 'succeeded' });
    expect(maximumActive).toBe(2);
    const itemFrames = [...store.records.values()]
      .filter((record) => record.blockId === 'items' && record.frame?.source.kind === 'item')
      .sort((left, right) => left.path.scope[0]!.kind === 'iteration' && right.path.scope[0]!.kind === 'iteration'
        ? left.path.scope[0]!.index - right.path.scope[0]!.index : 0)
      .map((record) => record.memberOrdinal);
    expect(itemFrames).toEqual(['0', '1', '2']);
    expect([...store.records.values()]
      .filter((record) => record.blockId === 'analyze')
      .map((record) => record.memberOrdinal)).toEqual(['0', '0', '0']);
    expect([...store.records.values()].find((record) =>
      record.blockId === 'items' && record.path.scope.length === 0)?.container).toEqual({
      kind: 'loop',
      mode: 'items',
      source: { kind: 'definition', reference: { kind: 'literal', value: ['A', 'A', 'B'] } },
      itemCount: '3',
      nextMemberIndex: '3',
      nextBodyBlockOrdinal: '0',
    });
  });

  it('admits only the authored active item window and refills it after a durable item result', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const releases = new Map<number, () => void>();
    const started: number[] = [];
    const workflow = { ...definition([{
      kind: 'loop', id: 'bounded-items',
      repetition: {
        kind: 'items', items: { kind: 'literal', value: Array.from({ length: 8 }, (_, index) => index) },
        execution: 'parallel', failurePolicy: 'collect_outcomes', maxConcurrent: 2,
      },
      body: [freshStep('work')],
    }]), finalOutput: { kind: 'result' as const, producer: { blockId: 'bounded-items', scope: { kind: 'current' as const } }, path: [] } };
    const running = createWorkflowCoordinator({
      store, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true,
      executeStep: async ({ item }) => {
        started.push(item!.index);
        await new Promise<void>((resolve) => releases.set(item!.index, resolve));
        return { kind: 'completed', result: `result-${item!.index}` };
      },
    }).run({ runId: 'run-bounded-items', definition: workflow, inputs: {}, executionTarget, authorization });

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    const itemFrames = () => [...store.records.values()].filter((record) =>
      record.blockId === 'bounded-items' && record.frame?.source.kind === 'item');
    expect(itemFrames()).toHaveLength(2);
    releases.get(0)!();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    expect(itemFrames()).toHaveLength(3);
    for (let index = 1; index < 8; index += 1) {
      releases.get(index)!();
      if (index < 7) await vi.waitFor(() => expect(started).toContain(index + 1));
    }
    await expect(running).resolves.toMatchObject({
      state: 'succeeded',
      finalOutput: Array.from({ length: 8 }, (_, index) => ({
        index, status: 'completed', results: { work: `result-${index}` },
      })),
    });
    expect(itemFrames()).toHaveLength(8);
  });

  it.each([
    ['pause_requested', 'paused'],
    ['cancel_requested', 'cancelled'],
  ] as const)('does not admit future bounded items after %s wins while the active window drains', async (requestedControl, expectedState) => {
    const baseStore = createInMemoryWorkflowCoordinatorStore();
    let control: 'running' | 'pause_requested' | 'cancel_requested' = 'running';
    const store = { ...baseStore, readControl: async () => control };
    const releases = new Map<number, () => void>();
    const started: number[] = [];
    const workflow = definition([{
      kind: 'loop', id: 'bounded-items',
      repetition: {
        kind: 'items', items: { kind: 'literal', value: [0, 1, 2, 3, 4] },
        execution: 'parallel', failurePolicy: 'fail_stop', maxConcurrent: 2,
      },
      body: [freshStep('work')],
    }]);
    const running = createWorkflowCoordinator({
      store, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true,
      executeStep: async ({ item }) => {
        started.push(item!.index);
        await new Promise<void>((resolve) => releases.set(item!.index, resolve));
        return { kind: 'completed', result: `result-${item!.index}` };
      },
    }).run({ runId: `run-bounded-items-${requestedControl}`, definition: workflow, inputs: {}, executionTarget, authorization });

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    control = requestedControl;
    releases.get(0)!();
    releases.get(1)!();
    await expect(running).resolves.toMatchObject({ state: expectedState });
    expect(started).toEqual([0, 1]);
    expect([...baseStore.records.values()].filter((record) =>
      record.blockId === 'bounded-items' && record.frame?.source.kind === 'item')).toHaveLength(2);
  });

  it('settles accepted parallel inputs at pause and admits no next frontier until resume', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    let control: 'running' | 'pause_requested' = 'running';
    const releases = new Map<string, () => void>();
    const events: string[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: { ...store, readControl: async () => control }, resolveWorkspace,
      executeStep: async ({ step: current, execution, onInputAccepted }) => {
        events.push(`start:${current.id}`);
        await onInputAccepted(detachedRun(`native-${current.id}`, `input-${current.id}`, execution));
        if (current.id !== 'b') await new Promise<void>((resolve) => releases.set(current.id, resolve));
        events.push(`settled:${current.id}`);
        return { kind: 'completed', result: current.id };
      },
    });
    const workflow = definition([{
      kind: 'parallel', id: 'active', failurePolicy: 'fail_stop',
      branches: [
        { id: 'left', blocks: [freshStep('a-left')] },
        { id: 'right', blocks: [freshStep('a-right')] },
      ],
    }, freshStep('b')]);
    const pausing = coordinator.run({ runId: 'run-pause-boundary', definition: workflow, inputs: {}, executionTarget, authorization });
    await vi.waitFor(() => expect(events.filter((event) => event.startsWith('start:a-'))).toHaveLength(2));
    control = 'pause_requested';
    releases.get('a-left')!();
    releases.get('a-right')!();
    await expect(pausing).resolves.toEqual({ state: 'paused' });
    expect(events).toEqual(expect.arrayContaining(['settled:a-left', 'settled:a-right']));
    expect(events).not.toContain('start:b');
    control = 'running';
    await expect(coordinator.run({ runId: 'run-pause-boundary', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'succeeded' });
    expect(events.filter((event) => event === 'start:a-left')).toHaveLength(1);
    expect(events.filter((event) => event === 'start:a-right')).toHaveLength(1);
    expect(events).toContain('start:b');
  });

  it.each([
    {
      label: 'parallel branch',
      pauseBefore: (stepId: string, _invocation: { path: { scope: readonly unknown[] } }) =>
        stepId === 'paused-before-admission',
      blocks: [{
        kind: 'parallel' as const, id: 'active', failurePolicy: 'fail_stop' as const,
        branches: [
          { id: 'left', blocks: [freshStep('admitted')] },
          { id: 'right', blocks: [freshStep('completed-before-pause'), freshStep('paused-before-admission')] },
        ],
      }],
    },
    {
      label: 'parallel item',
      pauseBefore: (stepId: string, invocation: { path: { scope: readonly unknown[] } }) =>
        stepId === 'second' && (invocation.path.scope.at(-1) as { index?: number } | undefined)?.index === 1,
      blocks: [{
        kind: 'loop' as const, id: 'active',
        repetition: {
          kind: 'items' as const,
          items: { kind: 'literal' as const, value: ['admitted', 'paused'] },
          execution: 'parallel' as const,
          failurePolicy: 'fail_stop' as const,
        },
        body: [freshStep('first'), freshStep('second')],
      }],
    },
  ])('does not abort an admitted $label sibling when pause closes another admission', async ({ blocks, pauseBefore }) => {
    const store = createInMemoryWorkflowCoordinatorStore();
    let control: 'running' | 'pause_requested' = 'running';
    let releaseAdmitted!: () => void;
    let admittedSettled = false;
    let completedBeforePause = false;
    const coordinator = createWorkflowCoordinator({
      store: { ...store, readControl: async () => control },
      resolveWorkspace: async ({ step: current, invocation }) => {
        if (pauseBefore(current.id, invocation)) control = 'pause_requested';
        return { ok: true as const, workspace };
      },
      isAcceptedAuthorizationCurrent: async () => true,
      executeStep: async ({ step: current, item, signal }) => {
        const isAdmittedSibling = current.id === 'admitted' || (current.id === 'first' && item?.index === 0);
        if (!isAdmittedSibling) {
          completedBeforePause = true;
          return { kind: 'completed', result: 'before-pause' };
        }
        await new Promise<void>((resolve, reject) => {
          releaseAdmitted = resolve;
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        admittedSettled = true;
        return { kind: 'completed', result: 'done' };
      },
    });
    const running = coordinator.run({
      runId: `run-pause-${blocks[0]!.kind}`,
      definition: definition(blocks),
      inputs: {}, executionTarget, authorization,
    });
    await vi.waitFor(() => expect(control).toBe('pause_requested'));
    expect(completedBeforePause).toBe(true);
    releaseAdmitted();
    await expect(running).resolves.toEqual({ state: 'paused' });
    expect(admittedSettled).toBe(true);
  });

  it('does not invent a concurrency fallback when maxConcurrent is omitted', async () => {
    const releases: Array<() => void> = [];
    let started = 0;
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async () => {
        started += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
        return { kind: 'completed', result: 'done' };
      },
    });
    const running = coordinator.run({
      runId: 'run-3',
      definition: definition([{
        kind: 'parallel', id: 'p', failurePolicy: 'collect_outcomes',
        branches: Array.from({ length: 20 }, (_, index) => ({ id: `b${index}`, blocks: [freshStep(`s${index}`)] })),
      }]),
      inputs: {},
      executionTarget,
      authorization,
    });
    await vi.waitFor(() => expect(started).toBe(20));
    releases.forEach((release) => release());
    await expect(running).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('serializes a shared conversation until the preceding exact result is committed', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    let releaseFirst!: () => void;
    const executeStep = vi.fn(async ({ step: current, onInputAccepted }: Parameters<Parameters<typeof createWorkflowCoordinator>[0]['executeStep']>[0]) => {
      await onInputAccepted({ kind: 'session', sessionId: 'shared', localInputId: `input-${current.id}` });
      if (current.id === 'first') {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      return { kind: 'completed' as const, result: current.id };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store, resolveWorkspace, executeStep,
    });
    const running = coordinator.run({
      runId: 'run-shared-admission',
      definition: definition([{
        kind: 'parallel', id: 'parallel', failurePolicy: 'fail_stop',
        branches: [{ id: 'one', blocks: [step('first')] }, { id: 'two', blocks: [step('second')] }],
      }]),
      inputs: {},
      executionTarget,
      authorization,
    });
    await vi.waitFor(() => expect(executeStep).toHaveBeenCalledTimes(1));
    expect(executeStep.mock.calls[0]?.[0].step.id).toBe('first');
    releaseFirst();
    await vi.waitFor(() => expect(executeStep).toHaveBeenCalledTimes(2));
    expect(store.read(workflowInvocationKey({
      runId: 'run-shared-admission', blockId: 'first', scope: [{ kind: 'branch', blockId: 'parallel', branchId: 'one' }], attempt: 0,
    }))?.result).toBe('first');
    await expect(running).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('serializes parallel detached leaves that reuse the same producer Run until each exact result is committed', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    let releaseFirstReuse!: () => void;
    let activeReuse = 0;
    let maximumActiveReuse = 0;
    const sends: string[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      prepareStep: async ({ step: current }) => current.id === 'producer'
        ? {}
        : { conversationAdmissionKey: 'native-producer-run' },
      executeStep: async ({ step: current, execution, onInputAccepted }) => {
        await onInputAccepted(detachedRun('native-producer-run', `input-${current.id}`, execution));
        if (current.id === 'producer') return { kind: 'completed', result: 'producer' };
        sends.push(current.id);
        activeReuse += 1;
        maximumActiveReuse = Math.max(maximumActiveReuse, activeReuse);
        if (activeReuse > 1) {
          return { kind: 'failed', code: 'execution_run_busy' };
        }
        if (current.id === 'reuse-b') {
          await new Promise<void>((resolve) => { releaseFirstReuse = resolve; });
        }
        activeReuse -= 1;
        return { kind: 'completed', result: current.id };
      },
    });
    const fromProducer = { kind: 'from_step' as const, producer: { blockId: 'producer', scope: { kind: 'current' as const } } };
    const running = coordinator.run({
      runId: 'run-detached-reuse-admission',
      definition: definition([
        { ...step('producer'), execution: { conversation: { kind: 'fresh' } } },
        {
          kind: 'parallel', id: 'reuse', failurePolicy: 'fail_stop',
          branches: [
            { id: 'b', blocks: [{ ...step('reuse-b'), execution: { conversation: fromProducer } }] },
            { id: 'c', blocks: [{ ...step('reuse-c'), execution: { conversation: fromProducer } }] },
          ],
        },
      ]),
      inputs: {}, executionTarget, authorization,
    });

    await vi.waitFor(() => expect(sends).toEqual(['reuse-b']));
    expect(maximumActiveReuse).toBe(1);
    releaseFirstReuse();
    await expect(running).resolves.toMatchObject({ state: 'succeeded' });
    expect(sends).toEqual(['reuse-b', 'reuse-c']);
    expect(maximumActiveReuse).toBe(1);
    expect([...store.records.values()].find((record) => record.blockId === 'reuse-b')?.result).toBe('reuse-b');
  });

  it.each([
    ['pause_requested', 'paused'],
    ['cancel_requested', 'cancelled'],
  ] as const)('does not send the next detached producer reuse after %s wins while it waits', async (requestedControl, expectedState) => {
    const baseStore = createInMemoryWorkflowCoordinatorStore();
    let control: 'running' | 'pause_requested' | 'cancel_requested' = 'running';
    const store = { ...baseStore, readControl: async () => control };
    let releaseFirstReuse!: () => void;
    const sends: string[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      prepareStep: async ({ step: current }) => current.id === 'producer'
        ? {}
        : { conversationAdmissionKey: 'native-producer-run' },
      executeStep: async ({ step: current, execution, onInputAccepted }) => {
        await onInputAccepted(detachedRun('native-producer-run', `input-${current.id}`, execution));
        if (current.id === 'producer') return { kind: 'completed', result: 'producer' };
        sends.push(current.id);
        await new Promise<void>((resolve) => { releaseFirstReuse = resolve; });
        return { kind: 'completed', result: current.id };
      },
    });
    const fromProducer = { kind: 'from_step' as const, producer: { blockId: 'producer', scope: { kind: 'current' as const } } };
    const running = coordinator.run({
      runId: `run-detached-reuse-${requestedControl}`,
      definition: definition([
        { ...step('producer'), execution: { conversation: { kind: 'fresh' } } },
        {
          kind: 'parallel', id: 'reuse', failurePolicy: 'fail_stop',
          branches: [
            { id: 'b', blocks: [{ ...step('reuse-b'), execution: { conversation: fromProducer } }] },
            { id: 'c', blocks: [{ ...step('reuse-c'), execution: { conversation: fromProducer } }] },
          ],
        },
      ]),
      inputs: {}, executionTarget, authorization,
    });

    await vi.waitFor(() => expect(sends).toEqual(['reuse-b']));
    control = requestedControl;
    releaseFirstReuse();
    await expect(running).resolves.toMatchObject({ state: expectedState });
    expect(sends).toEqual(['reuse-b']);
  });

  it('keeps a recovered exact shared turn ahead of an unadmitted sibling', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const firstScope = [{ kind: 'branch' as const, blockId: 'parallel', branchId: 'one' }];
    const firstKey = workflowInvocationKey({
      runId: 'run-shared-rejoin', blockId: 'first', scope: firstScope, attempt: 0,
    });
    await store.ensureIntent({
      key: firstKey,
      recordId: 'first-record',
      runId: 'run-shared-rejoin',
      blockId: 'first',
      path: { blockId: 'first', scope: firstScope },
      attempt: 0,
      acceptedAtMs: 1,
      lifecycle: 'running',
      execution: detachedRun('native-shared', 'input-first'),
      memberOrdinal: '0',
    });
    let releaseFirst!: () => void;
    const started: string[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ step: current, invocation, execution, onInputAccepted }) => {
        started.push(current.id);
        if (current.id === 'first') {
          expect(invocation.execution).toEqual(detachedRun('native-shared', 'input-first'));
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        } else {
          await onInputAccepted(detachedRun('native-shared', 'input-second', execution));
        }
        return { kind: 'completed', result: current.id };
      },
    });
    const running = coordinator.run({
      runId: 'run-shared-rejoin',
      definition: definition([{
        kind: 'parallel', id: 'parallel', failurePolicy: 'fail_stop',
        branches: [{ id: 'one', blocks: [step('first')] }, { id: 'two', blocks: [step('second')] }],
      }]),
      inputs: {},
      executionTarget,
      authorization,
    });
    await vi.waitFor(() => expect(started).toEqual(['first']));
    releaseFirst();
    await expect(running).resolves.toMatchObject({ state: 'succeeded' });
    expect(started).toEqual(['first', 'second']);
  });

  it('reconstructs authored capacity from persisted active descendants after restart', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const workflow = definition([{
      kind: 'loop', id: 'items',
      repetition: {
        kind: 'items', items: { kind: 'literal', value: ['A', 'B', 'C'] },
        execution: 'parallel', failurePolicy: 'collect_outcomes', maxConcurrent: 2,
      },
      body: [freshStep('analyze')],
    }]);
    const loopKey = workflowInvocationKey({ runId: 'run-restart-capacity', blockId: 'items', scope: [], attempt: 0 });
    await store.ensureIntent({ key: loopKey, recordId: 'loop', runId: 'run-restart-capacity', blockId: 'items',
      path: { blockId: 'items', scope: [] }, attempt: 0, acceptedAtMs: 1, lifecycle: 'running', memberOrdinal: '0' });
    for (const index of [0, 2]) {
      const scope = [{ kind: 'iteration' as const, blockId: 'items', index }];
      const key = workflowInvocationKey({ runId: 'run-restart-capacity', blockId: 'analyze', scope, attempt: 0 });
      await store.ensureIntent({ key, recordId: `active-${index}`, runId: 'run-restart-capacity', blockId: 'analyze',
        parentKey: loopKey, memberOrdinal: String(index), path: { blockId: 'analyze', scope }, attempt: 0,
        acceptedAtMs: 1, lifecycle: 'running',
        execution: { kind: 'session', sessionId: `session-${index}`, localInputId: `input-${index}` } });
    }
    const started: number[] = [];
    const releases = new Map<number, () => void>();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ item }) => {
        started.push(item!.index);
        await new Promise<void>((resolve) => releases.set(item!.index, resolve));
        return { kind: 'completed', result: `done-${item!.index}` };
      },
    });

    const running = coordinator.run({ runId: 'run-restart-capacity', definition: workflow, inputs: {}, executionTarget, authorization });
    await vi.waitFor(() => expect(started).toEqual([0, 2]));
    expect([...store.records.values()].find((record) =>
      record.path.scope[0]?.kind === 'iteration' && record.path.scope[0].index === 1)).toBeUndefined();
    releases.get(0)!();
    await vi.waitFor(() => expect(started).toEqual([0, 2, 1]));
    releases.get(2)!();
    releases.get(1)!();
    await expect(running).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('closes a fail-stop parallel frontier and aborts active siblings before returning', async () => {
    const started: string[] = [];
    let siblingAborted = false;
    let releaseFailure!: () => void;
    let markSiblingStarted!: () => void;
    const siblingStarted = new Promise<void>((resolve) => { markSiblingStarted = resolve; });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async ({ step: current, signal }) => {
        started.push(current.id);
        if (current.id === 'fails') {
          await new Promise<void>((release) => { releaseFailure = release; });
          return { kind: 'failed', code: 'branch_failed' };
        }
        if (current.id === 'active') {
          markSiblingStarted();
          await new Promise<void>((finish) => {
            signal?.addEventListener('abort', () => {
              siblingAborted = true;
              finish();
            }, { once: true });
          });
          return { kind: 'cancelled', code: 'sibling_failed' };
        }
        return { kind: 'completed', result: 'must-not-run' };
      },
    });
    const running = coordinator.run({
      runId: 'run-fail-stop',
      definition: definition([{
        kind: 'parallel', id: 'parallel', failurePolicy: 'fail_stop',
        branches: [
          { id: 'failure', blocks: [freshStep('fails')] },
          { id: 'sibling', blocks: [freshStep('active'), freshStep('downstream')] },
        ],
      }]),
      inputs: {},
      executionTarget,
      authorization,
      signal: new AbortController().signal,
    });
    await siblingStarted;
    releaseFailure();
    await expect(running).resolves.toEqual({ state: 'interrupted', reason: 'branch_failed' });
    expect(siblingAborted).toBe(true);
    expect(started).toEqual(['fails', 'active']);
  });

  it('collects definitive member failures but keeps unresolved effects actionable', async () => {
    const definitiveCalls: string[] = [];
    const definitive = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async ({ step: current }) => {
        definitiveCalls.push(current.id);
        return current.id === 'fails'
          ? { kind: 'failed', code: 'provider_failed' }
          : { kind: 'completed', result: 'ok' };
      },
    });
    const workflow = definition([{
      kind: 'parallel', id: 'p', failurePolicy: 'collect_outcomes',
      branches: [
        { id: 'bad', blocks: [step('fails'), step('must-not-run')] },
        { id: 'good', blocks: [step('healthy')] },
      ],
    }]);
    await expect(definitive.run({ runId: 'run-collect', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded', completedWithFailures: true });
    expect(definitiveCalls).toEqual(expect.arrayContaining(['fails', 'healthy']));
    expect(definitiveCalls).not.toContain('must-not-run');

    const unresolved = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async ({ step: current }) => current.id === 'uncertain'
        ? { kind: 'outcome_uncertain', code: 'result_unavailable' }
        : { kind: 'completed', result: 'ok' },
    });
    await expect(unresolved.run({
      runId: 'run-unresolved',
      definition: definition([{
        kind: 'parallel', id: 'p', failurePolicy: 'collect_outcomes',
        branches: [{ id: 'uncertain-branch', blocks: [step('uncertain')] }, { id: 'good', blocks: [step('healthy')] }],
      }]),
      inputs: {},
      executionTarget,
      authorization,
    })).resolves.toEqual({ state: 'outcome_uncertain', reason: 'result_unavailable' });
  });

  it.each([
    {
      failurePolicy: 'collect_outcomes' as const,
      expected: { state: 'succeeded', completedWithFailures: true },
      expectedExecutedSteps: ['healthy'],
    },
    {
      failurePolicy: 'fail_stop' as const,
      expected: { state: 'interrupted', reason: 'provider_failed' },
      expectedExecutedSteps: [],
    },
  ])('reconstructs a persisted definitive failure in a fresh store under $failurePolicy', async ({
    failurePolicy,
    expected,
    expectedExecutedSteps,
  }) => {
    const persistedStore = createInMemoryWorkflowCoordinatorStore();
    const runId = `run-fresh-${failurePolicy}`;
    const parentKey = workflowInvocationKey({ runId, blockId: 'p', scope: [], attempt: 0 });
    const failedScope = [{ kind: 'branch' as const, blockId: 'p', branchId: 'bad' }];
    const failedKey = workflowInvocationKey({ runId, blockId: 'fails', scope: failedScope, attempt: 0 });
    await persistedStore.ensureIntent({
      key: failedKey,
      recordId: 'persisted-failed-leaf',
      runId,
      blockId: 'fails',
      parentKey: workflowInvocationKey({ runId, blockId: 'p', scope: failedScope, attempt: 0 }),
      memberOrdinal: '0',
      path: { blockId: 'fails', scope: failedScope },
      attempt: 0,
      acceptedAtMs: 1,
      lifecycle: 'failed',
      reason: 'provider_failed',
    });
    // Recreate the store to exclude process-local materialized container state:
    // restart reconstruction has only the durable invocation fact.
    const store = createInMemoryWorkflowCoordinatorStore();
    for (const [key, record] of persistedStore.records) store.records.set(key, record);
    const executeStep = vi.fn(async ({ step: current }: { step: { id: string } }) => ({
      kind: 'completed' as const,
      result: current.id,
    }));
    const coordinator = createWorkflowCoordinator({
      store,
      resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => true,
      executeStep,
    });
    const workflow = definition([{
      kind: 'parallel', id: 'p', failurePolicy,
      branches: [
        { id: 'bad', blocks: [step('fails'), step('must-not-replay')] },
        { id: 'good', blocks: [step('healthy')] },
      ],
    }]);

    await expect(coordinator.run({ runId, definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject(expected);
    expect(executeStep.mock.calls.map(([params]) => params.step.id)).toEqual(expectedExecutedSteps);
    expect(store.read(parentKey)).toBeDefined();
  });

  it('persists only a constant-size selector on completed containers', async () => {
    const baseStore = createInMemoryWorkflowCoordinatorStore();
    const commitContainerResult = vi.fn(async (params: { key: string; result: import('./input').WorkflowJsonValue }) =>
      await baseStore.commitContainerResult!(params));
    const store = { ...baseStore, commitContainerResult };
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ step: current }) => ({ kind: 'completed', result: `${current.id}-result` }),
    });
    const workflow = definition([{
      kind: 'parallel', id: 'p', failurePolicy: 'collect_outcomes',
      branches: [{ id: 'one', blocks: [step('a')] }, { id: 'two', blocks: [step('b')] }],
    }]);

    await expect(coordinator.run({ runId: 'run-selector', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    const container = store.read(workflowInvocationKey({
      runId: 'run-selector', blockId: 'p', scope: [], attempt: 0,
    }));
    expect(container).toMatchObject({
      lifecycle: 'completed',
      containerResult: { kind: 'container', containerRecordId: container?.recordId },
    });
    expect(container?.result).toBeUndefined();
    const parentKey = workflowInvocationKey({ runId: 'run-selector', blockId: 'p', scope: [], attempt: 0 });
    expect(commitContainerResult.mock.calls.filter(([value]) => value.key === parentKey)).toHaveLength(1);
  });

  it('persists sequential loop body frames and reconstructs every source-ordered outcome after restart', async () => {
    const firstStore = createInMemoryWorkflowCoordinatorStore();
    const workflow = {
      ...definition([{
        kind: 'loop' as const,
        id: 'repeat',
        repetition: { kind: 'count' as const, count: { kind: 'literal' as const, value: 3 } },
        body: [freshStep('work')],
      }]),
      finalOutput: { kind: 'result' as const, producer: { blockId: 'repeat', scope: { kind: 'current' as const } }, path: [] },
    };
    const executeStep = vi.fn(async ({ iteration }: { iteration?: { index: number } }) => ({
      kind: 'completed' as const,
      result: `iteration-${iteration?.index}`,
    }));
    const firstCoordinator = createWorkflowCoordinator({
      store: firstStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true, executeStep,
    });

    await expect(firstCoordinator.run({ runId: 'run-count-restart', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({
        state: 'succeeded',
        finalOutput: [
          { work: 'iteration-0' },
          { work: 'iteration-1' },
          { work: 'iteration-2' },
        ],
      });
    expect([...firstStore.records.values()].filter((record) =>
      record.blockId === 'repeat' && record.frame?.source.kind === 'iteration')).toHaveLength(3);

    const restartedStore = createInMemoryWorkflowCoordinatorStore();
    for (const [key, record] of firstStore.records) restartedStore.records.set(key, record);
    const restartedExecuteStep = vi.fn(async () => ({ kind: 'completed' as const, result: 'must-not-replay' }));
    const restartedCoordinator = createWorkflowCoordinator({
      store: restartedStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true,
      executeStep: restartedExecuteStep,
    });

    await expect(restartedCoordinator.run({ runId: 'run-count-restart', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({
        state: 'succeeded',
        finalOutput: [
          { work: 'iteration-0' },
          { work: 'iteration-1' },
          { work: 'iteration-2' },
        ],
      });
    expect(restartedExecuteStep).not.toHaveBeenCalled();
  });

  it('treats count zero as an empty loop and rejects a non-safe resolved count', async () => {
    const executeStep = vi.fn(async () => ({ kind: 'completed' as const, result: 'must-not-run' }));
    const zero = definition([{
      kind: 'loop', id: 'zero',
      repetition: { kind: 'count', count: { kind: 'literal', value: 0 } },
      body: [freshStep('work')],
    }]);
    await expect(createWorkflowCoordinator({
      store: createInMemoryWorkflowCoordinatorStore(), resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => true, executeStep,
    }).run({ runId: 'run-count-zero', definition: zero, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(executeStep).not.toHaveBeenCalled();

    const unsafe = definition([{
      kind: 'loop', id: 'unsafe',
      repetition: { kind: 'count', count: { kind: 'input', name: 'count' } },
      body: [freshStep('work')],
    }]);
    await expect(createWorkflowCoordinator({
      store: createInMemoryWorkflowCoordinatorStore(), resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => true, executeStep,
    }).run({
      runId: 'run-count-unsafe', definition: unsafe,
      inputs: { count: Number.MAX_SAFE_INTEGER + 1 }, executionTarget, authorization,
    })).resolves.toEqual({ state: 'failed', reason: 'invalid_reference_scope' });
  });

  it('binds stable parallel branch IDs to their body-frame results across reverse completion and restart', async () => {
    const firstStore = createInMemoryWorkflowCoordinatorStore();
    let releaseFirst!: () => void;
    const consumed: unknown[] = [];
    const workflow = definition([{
      kind: 'parallel', id: 'fan', failurePolicy: 'collect_outcomes', branches: [
        { id: 'left', blocks: [freshStep('left-leaf')] },
        { id: 'right', blocks: [freshStep('right-leaf')] },
      ],
    }, {
      ...freshStep('consume'),
      input: [
        { kind: 'result', producer: { blockId: 'left', scope: { kind: 'current' } }, path: ['left-leaf'] },
        { kind: 'result', producer: { blockId: 'right', scope: { kind: 'current' } }, path: ['right-leaf'] },
      ],
    }]);
    const executeStep = vi.fn(async ({ step: current, input }: Parameters<Parameters<typeof createWorkflowCoordinator>[0]['executeStep']>[0]) => {
      if (current.id === 'left-leaf') await new Promise<void>((resolve) => { releaseFirst = resolve; });
      if (current.id === 'consume') consumed.push(...input.values);
      return { kind: 'completed' as const, result: `${current.id}-result` };
    });
    const coordinator = createWorkflowCoordinator({
      store: firstStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true, executeStep,
    });
    const running = coordinator.run({ runId: 'run-branch-binding', definition: workflow, inputs: {}, executionTarget, authorization });
    await vi.waitFor(() => expect(executeStep.mock.calls.some(([params]) => params.step.id === 'right-leaf')).toBe(true));
    releaseFirst();
    await expect(running).resolves.toMatchObject({ state: 'succeeded' });
    expect(consumed).toEqual(['left-leaf-result', 'right-leaf-result']);

    const restartedStore = createInMemoryWorkflowCoordinatorStore();
    for (const [key, record] of firstStore.records) restartedStore.records.set(key, record);
    const restartedExecuteStep = vi.fn(async () => ({ kind: 'completed' as const, result: 'must-not-replay' }));
    await expect(createWorkflowCoordinator({
      store: restartedStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true,
      executeStep: restartedExecuteStep,
    }).run({ runId: 'run-branch-binding', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(restartedExecuteStep).not.toHaveBeenCalled();
  });

  it.each([
    { history: 'none' as const, expected: [[], [], []] },
    {
      history: 'latest' as const,
      expected: [[], [{ kind: 'evaluation_history', evaluations: ['continue'] }],
        [{ kind: 'evaluation_history', evaluations: ['continue'] }]],
    },
    {
      history: 'all' as const,
      expected: [[], [{ kind: 'evaluation_history', evaluations: ['continue'] }],
        [{ kind: 'evaluation_history', evaluations: ['continue', 'continue'] }]],
    },
  ])('materializes exact prior evaluator outcomes for $history across restart', async ({ history, expected }) => {
    const firstStore = createInMemoryWorkflowCoordinatorStore();
    const workflow = definition([{
      kind: 'loop', id: 'judge',
      repetition: {
        kind: 'evaluate', maxIterations: 3, history,
        evaluator: {
          ...freshStep('evaluate'),
          result: { kind: 'decision', decisions: ['continue', 'stop'] },
        },
      },
      body: [freshStep('body')],
    }]);
    const evaluatorInputs: unknown[][] = [];
    let crash = true;
    const executeStep = vi.fn(async ({ step: current, iteration, input }: Parameters<Parameters<typeof createWorkflowCoordinator>[0]['executeStep']>[0]) => {
      if (current.id === 'body' && iteration?.index === 2 && crash) {
        crash = false;
        throw new Error('simulated_process_crash');
      }
      if (current.id === 'evaluate') {
        evaluatorInputs.push([...input.values]);
        return {
          kind: 'completed' as const,
          resultEncoding: 'typed' as const,
          result: iteration?.index === 2 ? 'stop' : 'continue',
        };
      }
      return { kind: 'completed' as const, result: `body-${iteration?.index}` };
    });
    await expect(createWorkflowCoordinator({
      store: firstStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true, executeStep,
    }).run({ runId: `run-evaluator-${history}`, definition: workflow, inputs: {}, executionTarget, authorization }))
      .rejects.toThrow('simulated_process_crash');

    const restartedStore = createInMemoryWorkflowCoordinatorStore();
    for (const [key, record] of firstStore.records) restartedStore.records.set(key, record);
    const restartedResult = await createWorkflowCoordinator({
      store: restartedStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true, executeStep,
    }).run({ runId: `run-evaluator-${history}`, definition: workflow, inputs: {}, executionTarget, authorization });
    expect(restartedResult, JSON.stringify(restartedResult)).toMatchObject({ state: 'succeeded' });
    expect(evaluatorInputs).toEqual(expected);
  });

  it('keeps an identified uncertain execution interrupted until observation resolves it, but terminalizes identity-less uncertainty', async () => {
    const recoverableStore = createInMemoryWorkflowCoordinatorStore();
    const identified = createWorkflowCoordinator({
      store: recoverableStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true,
      executeStep: async ({ onInputAccepted }) => {
        await onInputAccepted({ kind: 'session', sessionId: 'session-1', localInputId: 'input-1' });
        return { kind: 'outcome_uncertain', code: 'result_unavailable' };
      },
    });
    await expect(identified.run({
      runId: 'run-uncertain-identified', definition: definition([step('work')]), inputs: {}, executionTarget, authorization,
    })).resolves.toEqual({ state: 'interrupted', reason: 'result_unavailable' });

    const uncertain = [...recoverableStore.records.values()].find((record) => record.blockId === 'work')!;
    const stillUncertainReplay = vi.fn(async () => ({ kind: 'completed' as const, result: 'must-not-replay' }));
    await expect(createWorkflowCoordinator({
      store: recoverableStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true,
      executeStep: stillUncertainReplay,
    }).run({ runId: 'run-uncertain-identified', definition: definition([step('work')]), inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'interrupted', reason: 'result_unavailable' });
    expect(stillUncertainReplay).not.toHaveBeenCalled();

    recoverableStore.records.set(uncertain.key, { ...uncertain, lifecycle: 'completed', result: 'observed-result' });
    const replay = vi.fn(async () => ({ kind: 'completed' as const, result: 'must-not-replay' }));
    await expect(createWorkflowCoordinator({
      store: recoverableStore, resolveWorkspace, isAcceptedAuthorizationCurrent: async () => true, executeStep: replay,
    }).run({ runId: 'run-uncertain-identified', definition: definition([step('work')]), inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(replay).not.toHaveBeenCalled();

    await expect(createWorkflowCoordinator({
      store: createInMemoryWorkflowCoordinatorStore(), resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => true,
      executeStep: async () => ({ kind: 'outcome_uncertain', code: 'start_ambiguous_without_identity' }),
    }).run({ runId: 'run-uncertain-identityless', definition: definition([step('work')]), inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'outcome_uncertain', reason: 'start_ambiguous_without_identity' });
  });

  it('persists invocation intent before invoking the Session step executor', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const executeStep = vi.fn(async ({ invocation }: { invocation: WorkflowProgressEnvelopeV1 }) => {
      expect(store.readByLogicalInvocation(invocation.logicalInvocationRecordId)?.lifecycle).toBe('admitting');
      return { kind: 'completed' as const, result: 'done' };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });
    await coordinator.run({ runId: 'run-4', definition: definition([step('a')]), inputs: {}, executionTarget, authorization });
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it('reuses one logical invocation identity after correspondence persistence fails', async () => {
    const baseStore = createInMemoryWorkflowCoordinatorStore();
    let failCorrespondenceCommit = true;
    const store: WorkflowCoordinatorStore = {
      ...baseStore,
      commitFact: async (params) => {
        if (failCorrespondenceCommit && params.lifecycle === 'running' && params.execution) {
          failCorrespondenceCommit = false;
          throw new Error('simulated_correspondence_write_failure');
        }
        return await baseStore.commitFact(params);
      },
    };
    const logicalInvocationIds: string[] = [];
    const executeStep: WorkflowStepExecutor = async ({ invocation, onInputAccepted }) => {
      logicalInvocationIds.push(invocation.logicalInvocationRecordId);
      await onInputAccepted({
        kind: 'attached_run',
        sessionId: 'session-1',
        runId: 'run-request-bound',
        localInputId: `workflow-input:${invocation.logicalInvocationRecordId}`,
      });
      return { kind: 'completed', result: 'done' };
    };
    const run = {
      runId: 'run-correspondence-retry',
      definition: definition([step('a')]),
      inputs: {},
      executionTarget: { kind: 'attached_run' as const },
      authorization,
    };

    await expect(createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      executeStep,
      resolveWorkspace,
    }).run(run)).rejects.toThrow('simulated_correspondence_write_failure');

    await expect(createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      executeStep,
      resolveWorkspace,
    }).run(run)).resolves.toMatchObject({ state: 'succeeded' });

    expect(logicalInvocationIds).toHaveLength(2);
    expect(logicalInvocationIds[1]).toBe(logicalInvocationIds[0]);
    expect([...baseStore.records.values()].find((record) => record.blockId === 'a'))
      .toMatchObject({
        lifecycle: 'completed',
        execution: { kind: 'attached_run', runId: 'run-request-bound' },
      });
  });

  it('closes the launch frontier when durable parent cancellation arrives between steps', async () => {
    const baseStore = createInMemoryWorkflowCoordinatorStore();
    let firstStepCompleted = false;
    const store = {
      ...baseStore,
      readControl: async () => (firstStepCompleted ? 'cancel_requested' as const : 'running' as const),
    };
    const executeStep = vi.fn(async ({ step: current }) => {
      firstStepCompleted = true;
      return { kind: 'completed' as const, result: current.id };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });

    await expect(coordinator.run({ runId: 'run-cancel-boundary', definition: definition([step('a'), step('b')]), inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'cancelled' });
    expect(executeStep.mock.calls.map(([value]) => value.step.id)).toEqual(['a']);
    expect([...baseStore.records.values()].some((record) => record.blockId === 'b')).toBe(false);
  });

  it('closes the launch frontier as cancelled only for a persisted or authoritative cancel abort', async () => {
    for (const abortWith of [
      (controller: AbortController) => controller.abort(WORKFLOW_CANCEL_REQUESTED_ABORT_REASON),
      (controller: AbortController) => abortAutomationRunForAuthoritativeCancellation(controller),
    ]) {
      const store = createInMemoryWorkflowCoordinatorStore();
      const controller = new AbortController();
      const executeStep = vi.fn(async ({ step: current }) => {
        abortWith(controller);
        return { kind: 'completed' as const, result: current.id };
      });
      const coordinator = createWorkflowCoordinator({
        isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });

      await expect(coordinator.run({
        runId: 'run-cancel-abort', definition: definition([step('a'), step('b')]), inputs: {},
        executionTarget, authorization, signal: controller.signal,
      })).resolves.toEqual({ state: 'cancelled' });
      expect(executeStep.mock.calls.map(([value]) => value.step.id)).toEqual(['a']);
    }
  });

  it('unwinds a bare claim abort as a runtime interruption instead of settling the Run as cancelled', async () => {
    // Daemon shutdown, lease-heartbeat loss and stale-attempt invalidation
    // abort the claim without a cancellation reason. This attempt lost its
    // currentness: it must neither write a terminal lie nor close the frontier.
    const store = createInMemoryWorkflowCoordinatorStore();
    const controller = new AbortController();
    const executeStep = vi.fn(async ({ step: current }) => {
      controller.abort();
      return { kind: 'completed' as const, result: current.id };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });

    await expect(coordinator.run({
      runId: 'run-interrupted-abort', definition: definition([step('a'), step('b')]), inputs: {},
      executionTarget, authorization, signal: controller.signal,
    })).rejects.toBeInstanceOf(WorkflowRuntimeInterruption);
    expect(executeStep.mock.calls.map(([value]) => value.step.id)).toEqual(['a']);
    expect(store.read(workflowInvocationKey({ runId: 'run-interrupted-abort', blockId: 'a', scope: [], attempt: 0 })))
      .toMatchObject({ lifecycle: 'completed', result: 'a' });
    expect([...store.records.values()].some((record) => record.blockId === 'b')).toBe(false);
  });

  it('propagates a leaf runtime interruption without writing a terminal leaf or container fact', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const executeStep = vi.fn(async ({ step: current, onInputAccepted }) => {
      if (current.id === 'b') {
        await onInputAccepted({ kind: 'session', sessionId: 'session-1', localInputId: 'input-b' });
        throw new WorkflowRuntimeInterruption();
      }
      return { kind: 'completed' as const, result: current.id };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });
    const parallel = {
      kind: 'parallel' as const, id: 'group', failurePolicy: 'fail_stop' as const,
      branches: [{ id: 'left', blocks: [step('a')] }, { id: 'right', blocks: [step('b')] }],
    };

    await expect(coordinator.run({
      runId: 'run-leaf-interruption', definition: definition([parallel]), inputs: {},
      executionTarget, authorization,
    })).rejects.toBeInstanceOf(WorkflowRuntimeInterruption);
    const rightScope = [{ kind: 'branch' as const, blockId: 'group', branchId: 'right' }];
    expect(store.read(workflowInvocationKey({ runId: 'run-leaf-interruption', blockId: 'b', scope: rightScope, attempt: 0 })))
      .toMatchObject({ lifecycle: 'running', execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-b' } });
    expect(store.read(workflowInvocationKey({ runId: 'run-leaf-interruption', blockId: 'group', scope: [], attempt: 0 })))
      .toMatchObject({ lifecycle: 'running' });
  });

  it('rejoins an already accepted Session input by its durable correspondence without a fresh intent', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const key = workflowInvocationKey({ runId: 'run-rejoin', blockId: 'a', scope: [], attempt: 0 });
    await store.ensureIntent({
      key,
      recordId: '7be4d65c-d3b7-4868-a416-b18d9ee29c1c',
      runId: 'run-rejoin',
      blockId: 'a',
      path: { blockId: 'a', scope: [] },
      attempt: 0,
      acceptedAtMs: 1_000,
      lifecycle: 'running',
      execution: { kind: 'session', sessionId: 'session-1', localInputId: 'workflow-input-1' },
    });
    const executeStep = vi.fn(async ({ invocation }: { invocation: WorkflowProgressEnvelopeV1 }) => {
      expect(invocation.execution).toEqual({ kind: 'session', sessionId: 'session-1', localInputId: 'workflow-input-1' });
      return { kind: 'completed' as const, result: 'rejoined-result' };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });
    await expect(coordinator.run({ runId: 'run-rejoin', definition: definition([step('a')]), inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(executeStep).toHaveBeenCalledOnce();
    expect(store.read(key)?.result).toBe('rejoined-result');
  });

  it('continues from the newest persisted retry attempt instead of replaying attempt zero', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const firstKey = workflowInvocationKey({ runId: 'run-retry', blockId: 'a', scope: [], attempt: 0 });
    await store.ensureIntent({ key: firstKey, recordId: 'attempt-0', runId: 'run-retry', blockId: 'a',
      memberOrdinal: '0', path: { blockId: 'a', scope: [] }, attempt: 0, acceptedAtMs: 1_000, lifecycle: 'failed', reason: 'old' });
    const retryKey = workflowInvocationKey({ runId: 'run-retry', blockId: 'a', scope: [], attempt: 1 });
    await store.ensureIntent({ key: retryKey, recordId: 'attempt-1', runId: 'run-retry', blockId: 'a',
      memberOrdinal: '0', path: { blockId: 'a', scope: [] }, attempt: 1, acceptedAtMs: 2_000, lifecycle: 'running',
      execution: { kind: 'session', sessionId: 'session-1', localInputId: 'retry-input' } });
    const executeStep = vi.fn(async ({ invocation }: { invocation: WorkflowProgressEnvelopeV1 }) => {
      expect(invocation.attempt).toBe('1');
      expect(invocation.logicalInvocationRecordId).toBe('attempt-1');
      return { kind: 'completed' as const, result: 'retried' };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });
    await expect(coordinator.run({ runId: 'run-retry', definition: definition([step('a')]), inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(store.read(firstKey)?.lifecycle).toBe('failed');
    expect(store.read(retryKey)?.result).toBe('retried');
  });

  it('does not replay a definitively failed invocation until an explicit retry row exists', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const key = workflowInvocationKey({ runId: 'run-failed', blockId: 'a', scope: [], attempt: 0 });
    await store.ensureIntent({
      key,
      recordId: 'failed-attempt',
      runId: 'run-failed',
      blockId: 'a',
      path: { blockId: 'a', scope: [] },
      attempt: 0,
      acceptedAtMs: 1_000,
      lifecycle: 'failed',
      reason: 'provider_failed',
      execution: { kind: 'session', sessionId: 'session-1', localInputId: 'failed-input' },
    });
    const executeStep = vi.fn();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace });

    await expect(coordinator.run({ runId: 'run-failed', definition: definition([step('a')]), inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'interrupted', reason: 'provider_failed' });
    expect(executeStep).not.toHaveBeenCalled();
  });

  it('fails closed when the Session result violates the authored result contract', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async () => ({
        kind: 'completed', result: 'maybe',
        usage: { inputTokens: 13, outputTokens: 2, costUsd: 0.03 },
      }),
    });
    const decisionStep = { ...step('gate'), result: { kind: 'decision' as const, decisions: ['continue', 'stop'] } };
    await expect(coordinator.run({ runId: 'run-5', definition: definition([decisionStep]), inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'interrupted', reason: 'invalid_result_contract' });
    expect(store.read(workflowInvocationKey({
      runId: 'run-5', blockId: 'gate', scope: [], attempt: 0,
    }))).toMatchObject({
      lifecycle: 'failed',
      usage: { inputTokens: 13, outputTokens: 2, costUsd: 0.03 },
    });
  });

  it('decodes one exact JSON value and validates the authored schema', async () => {
    const workflow = definition([{
      ...step('structured'),
      result: {
        kind: 'json' as const,
        schema: {
          type: 'object' as const,
          properties: { answer: { type: 'number' as const } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    }]);
    const valid = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async () => ({ kind: 'completed', result: '{"answer":42}' }),
    });
    await expect(valid.run({ runId: 'run-json-valid', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });

    const invalid = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async () => ({ kind: 'completed', result: '{"answer":"no"}' }),
    });
    await expect(invalid.run({ runId: 'run-json-invalid', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toEqual({ state: 'interrupted', reason: 'invalid_result_contract' });
  });

  it('accepts a detached Execution Run typed JSON result without decoding it as Session text', async () => {
    const downstreamInputs: unknown[] = [];
    const workflow = definition([
      {
        ...step('structured'),
        result: {
          kind: 'json' as const,
          schema: {
            type: 'object' as const,
            properties: { answer: { type: 'number' as const } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      },
      {
        ...step('consumer'),
        input: [{
          kind: 'result' as const,
          producer: { blockId: 'structured', scope: { kind: 'current' as const } },
          path: ['answer'],
        }],
      },
    ]);
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async ({ step: current, input }) => {
        if (current.id === 'structured') {
          return { kind: 'completed', result: { answer: 42 }, resultEncoding: 'typed' };
        }
        downstreamInputs.push(input.values);
        return { kind: 'completed', result: 'done' };
      },
    });

    await expect(coordinator.run({ runId: 'run-json-typed', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(downstreamInputs).toEqual([[42]]);
  });

  it('runs evaluator loops against the exact current body result and stops without another iteration', async () => {
    const calls: string[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: createInMemoryWorkflowCoordinatorStore(),
      resolveWorkspace,
      executeStep: async ({ step: current, input, iteration }) => {
        calls.push(`${current.id}:${iteration?.index}`);
        if (current.id === 'body') return { kind: 'completed', result: `body-${iteration?.index}` };
        expect(input.values).toEqual(iteration?.index === 0
          ? [`body-${iteration.index}`]
          : [`body-${iteration?.index}`, { kind: 'evaluation_history', evaluations: ['continue'] }]);
        return {
          kind: 'completed',
          result: JSON.stringify(iteration?.index === 1 ? 'stop' : 'continue'),
        };
      },
    });
    const workflow = definition([{
      kind: 'loop',
      id: 'evaluate-loop',
      body: [step('body')],
      repetition: {
        kind: 'evaluate',
        maxIterations: 4,
        history: 'latest',
        evaluator: {
          ...step('evaluator'),
          input: [{ kind: 'result', producer: { blockId: 'body', scope: { kind: 'current' } }, path: [] }],
          result: { kind: 'decision', decisions: ['continue', 'stop'] },
        },
      },
    }]);

    await expect(coordinator.run({ runId: 'run-evaluator', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(calls).toEqual(['body:0', 'evaluator:0', 'body:1', 'evaluator:1']);
  });

  it('binds a result-backed loop source to the exact producer invocation row', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const workflow = definition([
      {
        ...step('count-source'),
        result: { kind: 'json', schema: { type: 'number' } },
      },
      {
        kind: 'loop',
        id: 'counted',
        repetition: {
          kind: 'count',
          count: {
            kind: 'result',
            producer: { blockId: 'count-source', scope: { kind: 'current' } },
            path: [],
          },
        },
        body: [freshStep('work')],
      },
    ]);
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ step: current }) => current.id === 'count-source'
        ? { kind: 'completed', result: '2' }
        : { kind: 'completed', result: 'done' },
    });

    await expect(coordinator.run({ runId: 'run-loop-source', definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });

    const sourceRecord = [...store.records.values()].find((record) => record.blockId === 'count-source');
    const loopRecord = [...store.records.values()].find((record) => record.blockId === 'counted' && record.path.scope.length === 0);
    expect(sourceRecord).toBeDefined();
    expect(loopRecord?.container).toEqual({
      kind: 'loop',
      mode: 'count',
      source: { kind: 'result', recordId: sourceRecord!.recordId, path: [] },
      count: '2',
      nextMemberIndex: '2',
      nextBodyBlockOrdinal: '0',
    });
  });

  it('resumes a loop at its durable frontier and binds a nested source to the previous iteration row', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const runId = 'run-loop-frontier';
    const workflow = definition([{
      kind: 'loop',
      id: 'outer',
      repetition: { kind: 'count', count: { kind: 'literal', value: 3 } },
      body: [
        {
          ...step('work'),
          result: { kind: 'json', schema: { type: 'number' } },
        },
        {
          kind: 'loop',
          id: 'inner',
          onlyWhen: {
            kind: 'compare',
            operator: 'gte',
            left: { kind: 'iteration', field: 'index' },
            right: { kind: 'literal', value: 2 },
          },
          repetition: {
            kind: 'count',
            count: {
              kind: 'result',
              producer: {
                blockId: 'work',
                scope: { kind: 'previous_iteration', loopBlockId: 'outer' },
              },
              path: [],
            },
          },
          body: [freshStep('inner-work')],
        },
      ],
    }]);
    const outerKey = workflowInvocationKey({ runId, blockId: 'outer', scope: [], attempt: 0 });
    await store.ensureIntent({
      key: outerKey,
      recordId: 'outer-record',
      runId,
      blockId: 'outer',
      memberOrdinal: '0',
      path: { blockId: 'outer', scope: [] },
      attempt: 0,
      acceptedAtMs: 1,
      lifecycle: 'running',
      container: {
        kind: 'loop',
        mode: 'count',
        source: { kind: 'definition', reference: { kind: 'literal', value: 3 } },
        count: '3',
        nextMemberIndex: '2',
        nextBodyBlockOrdinal: '0',
      },
    });
    for (const index of [0, 1]) {
      const previousScope = [{ kind: 'iteration' as const, blockId: 'outer', index }];
      const iterationFrameKey = workflowInvocationKey({ runId, blockId: 'outer', scope: previousScope, attempt: 0 });
      await store.ensureIntent({
        key: iterationFrameKey,
        recordId: `iteration-frame-${index}`,
        runId,
        blockId: 'outer',
        parentKey: outerKey,
        memberOrdinal: String(index),
        path: { blockId: 'outer', scope: previousScope },
        attempt: 0,
        acceptedAtMs: 1,
        lifecycle: 'completed',
        frame: { ownerBlockId: 'outer', source: { kind: 'iteration', index: String(index) } },
        container: { kind: 'body', nextBlockOrdinal: '2' },
        containerResult: { kind: 'container', containerRecordId: `iteration-frame-${index}` },
      });
      const previousWorkKey = workflowInvocationKey({ runId, blockId: 'work', scope: previousScope, attempt: 0 });
      await store.ensureIntent({
        key: previousWorkKey,
        recordId: index === 1 ? 'previous-work-record' : `work-record-${index}`,
        runId,
        blockId: 'work',
        parentKey: iterationFrameKey,
        memberOrdinal: '0',
        path: { blockId: 'work', scope: previousScope },
        attempt: 0,
        acceptedAtMs: 1,
        lifecycle: 'completed',
        result: 1,
      });
      const previousInnerKey = workflowInvocationKey({ runId, blockId: 'inner', scope: previousScope, attempt: 0 });
      await store.ensureIntent({
        key: previousInnerKey,
        recordId: `previous-inner-record-${index}`,
        runId,
        blockId: 'inner',
        parentKey: iterationFrameKey,
        memberOrdinal: '1',
        path: { blockId: 'inner', scope: previousScope },
        attempt: 0,
        acceptedAtMs: 1,
        lifecycle: 'skipped',
        reason: 'condition_false',
      });
    }
    const readIterationIndexes: number[] = [];
    const durableStore = {
      ...store,
      readCurrent: async (params: Parameters<NonNullable<typeof store.readCurrent>>[0]) => {
        const iteration = params.scope.find((part) => part.kind === 'iteration' && part.blockId === 'outer');
        if (iteration?.kind === 'iteration') readIterationIndexes.push(iteration.index);
        return await store.readCurrent!(params);
      },
    };
    const calls: string[] = [];
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store: durableStore,
      resolveWorkspace,
      executeStep: async ({ step: current, iteration }) => {
        calls.push(`${current.id}:${iteration?.index}`);
        return current.id === 'work'
          ? { kind: 'completed', result: '1' }
          : { kind: 'completed', result: 'done' };
      },
    });

    await expect(coordinator.run({ runId, definition: workflow, inputs: {}, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });

    // The resumed outer body stays on iteration 2, while the nested loop owns
    // its own innermost iteration context starting at 0.
    expect(calls).toEqual(['work:2', 'inner-work:0']);
    expect(readIterationIndexes).toEqual(expect.arrayContaining([0, 1, 2]));
    const currentInner = [...store.records.values()].find((record) =>
      record.blockId === 'inner'
      && record.path.scope.some((part) => part.kind === 'iteration' && part.blockId === 'outer' && part.index === 2));
    expect(currentInner?.container).toMatchObject({
      kind: 'loop',
      mode: 'count',
      source: { kind: 'result', recordId: 'previous-work-record', path: [] },
      count: '1',
    });
    expect(store.read(outerKey)?.container).toMatchObject({
      kind: 'loop',
      nextMemberIndex: '3',
      nextBodyBlockOrdinal: '0',
    });
  });

  it('persists the selected conditional branch and scalar body frontier across restart', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const workflow = definition([{
      kind: 'if',
      id: 'choice',
      when: { kind: 'compare', operator: 'eq', left: { kind: 'input', name: 'chooseThen' }, right: { kind: 'literal', value: true } },
      then: [step('then-a'), step('then-b')],
      otherwise: [step('otherwise-a')],
    }]);
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ step: current }) => {
        if (current.id === 'then-a') {
          markFirstStarted();
          await new Promise<void>((release) => { releaseFirst = release; });
        }
        return { kind: 'completed' as const, result: current.id };
      },
    });
    const firstRun = coordinator.run({
      runId: 'run-if-restart', definition: workflow, inputs: { chooseThen: true }, executionTarget, authorization,
    });
    await firstStarted;
    const container = [...store.records.values()].find((record) => record.blockId === 'choice');
    expect(container?.container).toEqual({ kind: 'if', selected: 'then', nextBlockOrdinal: '0' });
    releaseFirst();
    await firstRun;
    await vi.waitFor(() => expect(container && store.read(container.key)?.container)
      .toEqual({ kind: 'if', selected: 'then', nextBlockOrdinal: '2' }));

    const restartedCalls: string[] = [];
    const restarted = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true,
      store,
      resolveWorkspace,
      executeStep: async ({ step: current }) => {
        restartedCalls.push(current.id);
        return { kind: 'completed', result: current.id };
      },
    });
    await expect(restarted.run({ runId: 'run-if-restart', definition: workflow, inputs: { chooseThen: false }, executionTarget, authorization }))
      .resolves.toMatchObject({ state: 'succeeded' });
    expect(restartedCalls).toEqual([]);
    expect([...store.records.values()].some((record) => record.blockId === 'otherwise-a')).toBe(false);
  });

  it('resolves and persists workspace before either leaf executor can dispatch', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const executeStep: WorkflowStepExecutor = vi.fn(async ({ workspace: resolved }) => {
      expect(resolved).toEqual(workspace);
      return { kind: 'completed' as const, result: 'done' };
    });
    const resolveBeforeDispatch: WorkflowWorkspaceResolver = vi.fn(async ({ invocation }) => {
      expect(store.read(invocation.key)?.lifecycle).toBe('admitting');
      await store.commitFact({ key: invocation.key, lifecycle: 'admitting', workspace: { descriptor: workspace } });
      return { ok: true as const, workspace };
    });
    const coordinator = createWorkflowCoordinator({
      isAcceptedAuthorizationCurrent: async () => true, store, executeStep, resolveWorkspace: resolveBeforeDispatch });
    await coordinator.run({ runId: 'run-workspace', definition: definition([step('a')]), inputs: {}, executionTarget, authorization });
    expect(resolveBeforeDispatch).toHaveBeenCalledOnce();
    expect(executeStep).toHaveBeenCalledOnce();
  });

  it.each(['session', 'attached_run', 'detached_run'] as const)(
    'preflights a retained %s conversation before workspace effects and reuses the prepared selection',
    async (targetKind) => {
      const retained = { machineId: 'machine-1', directory: '/retained', checkoutRootPath: '/retained' } as const;
      const prepared = { targetKind, identity: 'retained-1' } as const;
      const prepareStep = vi.fn(async () => ({ conversationWorkspace: retained, preparedStep: prepared }));
      const inspectCommittedRevision = vi.fn(async () => 'a'.repeat(40));
      const realizeWorktree = vi.fn(async () => workspace);
      const mismatchedWorkspace: WorkflowWorkspaceResolver = vi.fn(async ({ conversationWorkspace }) => {
        expect(conversationWorkspace).toEqual(retained);
        return { ok: false as const, code: 'conversation_workspace_mismatch' as const };
      });
      const executeStep = vi.fn();
      const mismatched = createWorkflowCoordinator({
        store: createInMemoryWorkflowCoordinatorStore(),
        prepareStep,
        resolveWorkspace: mismatchedWorkspace,
        isAcceptedAuthorizationCurrent: async () => true,
        executeStep,
      });

      await expect(mismatched.run({
        runId: `run-retained-mismatch-${targetKind}`,
        definition: definition([step('work')]),
        inputs: {}, executionTarget: { kind: targetKind }, authorization,
      })).resolves.toEqual({ state: 'interrupted', reason: 'conversation_workspace_mismatch' });
      expect(prepareStep).toHaveBeenCalledOnce();
      expect(inspectCommittedRevision).not.toHaveBeenCalled();
      expect(realizeWorktree).not.toHaveBeenCalled();
      expect(executeStep).not.toHaveBeenCalled();

      const compatiblePrepare = vi.fn(async () => ({ conversationWorkspace: workspace, preparedStep: prepared }));
      const compatibleExecute: WorkflowStepExecutor = vi.fn(async ({ preparedStep }) => {
        expect(preparedStep).toBe(prepared);
        return { kind: 'completed' as const, result: 'done' };
      });
      const compatible = createWorkflowCoordinator({
        store: createInMemoryWorkflowCoordinatorStore(),
        prepareStep: compatiblePrepare,
        resolveWorkspace: async ({ conversationWorkspace }) => {
          expect(conversationWorkspace).toEqual(workspace);
          return { ok: true as const, workspace };
        },
        isAcceptedAuthorizationCurrent: async () => true,
        executeStep: compatibleExecute,
      });
      await expect(compatible.run({
        runId: `run-retained-compatible-${targetKind}`,
        definition: definition([step('work')]),
        inputs: {}, executionTarget: { kind: targetKind }, authorization,
      })).resolves.toEqual({ state: 'succeeded' });
      expect(compatiblePrepare).toHaveBeenCalledOnce();
      expect(compatibleExecute).toHaveBeenCalledOnce();
    },
  );

  it('revalidates accepted authorization before a new effect but not while observing an admitted effect', async () => {
    const newEffectStore = createInMemoryWorkflowCoordinatorStore();
    const newEffectEvents: string[] = [];
    const isAcceptedAuthorizationCurrent = vi.fn(async () => {
      newEffectEvents.push('authorization');
      return false;
    });
    const executeNewEffect = vi.fn(async () => {
      newEffectEvents.push('execute');
      return { kind: 'completed' as const, result: 'done' };
    });
    const coordinator = createWorkflowCoordinator({
      store: newEffectStore,
      prepareStep: async () => {
        newEffectEvents.push('conversation-preflight');
        return {};
      },
      resolveWorkspace: async () => {
        newEffectEvents.push('workspace');
        return { ok: true as const, workspace };
      },
      isAcceptedAuthorizationCurrent,
      executeStep: executeNewEffect,
    });

    await expect(coordinator.run({
      runId: 'run-authorization-currentness',
      definition: definition([step('a')]),
      inputs: {},
      executionTarget,
      authorization,
    })).resolves.toEqual({ state: 'interrupted', reason: 'workflow_authorization_not_current' });
    expect(newEffectEvents).toEqual(['authorization']);
    expect(executeNewEffect).not.toHaveBeenCalled();
    expect([...newEffectStore.records.values()][0]).toMatchObject({
      lifecycle: 'needs_attention',
      reason: 'workflow_authorization_not_current',
    });

    const observingStore = createInMemoryWorkflowCoordinatorStore();
    const key = workflowInvocationKey({
      runId: 'run-authorization-observe', blockId: 'a', scope: [], attempt: 0,
    });
    await observingStore.ensureIntent({
      key,
      recordId: 'record-a',
      runId: 'run-authorization-observe',
      blockId: 'a',
      memberOrdinal: '0',
      path: { blockId: 'a', scope: [] },
      attempt: 0,
      acceptedAtMs: 1,
      lifecycle: 'running',
      execution: { kind: 'session', sessionId: 'session-a', localInputId: 'input-a' },
    });
    const observeCurrentness = vi.fn(async () => false);
    const observeExecution = vi.fn(async () => ({ kind: 'completed' as const, result: 'observed' }));
    const observingCoordinator = createWorkflowCoordinator({
      store: observingStore,
      resolveWorkspace,
      isAcceptedAuthorizationCurrent: observeCurrentness,
      executeStep: observeExecution,
    });

    await expect(observingCoordinator.run({
      runId: 'run-authorization-observe',
      definition: definition([step('a')]),
      inputs: {},
      executionTarget,
      authorization,
    })).resolves.toEqual({ state: 'succeeded' });
    expect(observeCurrentness).not.toHaveBeenCalled();
    expect(observeExecution).toHaveBeenCalledOnce();
  });

  it.each([
    ['revoked', false, { state: 'interrupted', reason: 'workflow_authorization_not_current' }, ['a']],
    ['current', true, { state: 'succeeded' }, ['a', 'b']],
  ] as const)('rechecks a mediated source between effects when it remains %s', async (
    _label,
    sourceRemainsCurrent,
    expected,
    expectedEffects,
  ) => {
    let sourceCurrent = true;
    const effects: string[] = [];
    const store = createInMemoryWorkflowCoordinatorStore();
    const coordinator = createWorkflowCoordinator({
      store,
      resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => sourceCurrent,
      executeStep: async ({ step: current }) => {
        effects.push(current.id);
        if (current.id === 'a') sourceCurrent = sourceRemainsCurrent;
        return { kind: 'completed' as const, result: `${current.id}-done` };
      },
    });

    await expect(coordinator.run({
      runId: `run-mediated-${_label}`,
      definition: definition([step('a'), step('b')]),
      inputs: {},
      executionTarget,
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
    })).resolves.toEqual(expected);
    expect(effects).toEqual(expectedEffects);
  });

  it('closes a new leaf admission when pause wins after currentness validation', async () => {
    const baseStore = createInMemoryWorkflowCoordinatorStore();
    let control: 'running' | 'pause_requested' = 'running';
    const executeStep = vi.fn(async () => ({ kind: 'completed' as const, result: 'unexpected' }));
    const coordinator = createWorkflowCoordinator({
      store: { ...baseStore, readControl: async () => control },
      resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => {
        control = 'pause_requested';
        return true;
      },
      executeStep,
    });

    await expect(coordinator.run({
      runId: 'run-pause-after-currentness',
      definition: definition([step('a')]),
      inputs: {}, executionTarget, authorization,
    })).resolves.toEqual({ state: 'paused' });
    expect(executeStep).not.toHaveBeenCalled();
  });

  it('reconciles an admission CAS loss only through the canonical control owner', async () => {
    const baseStore = createInMemoryWorkflowCoordinatorStore();
    const executeStep = vi.fn();
    const coordinator = createWorkflowCoordinator({
      store: {
        ...baseStore,
        ensureIntent: async () => { throw new Error('parent_revision_conflict'); },
        readControl: async () => 'cancel_requested',
      },
      resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => true,
      executeStep,
    });

    await expect(coordinator.run({
      runId: 'run-admission-cas-cancel', definition: definition([step('a')]),
      inputs: {}, executionTarget, authorization,
    })).resolves.toEqual({ state: 'cancelled' });
    expect(executeStep).not.toHaveBeenCalled();
  });

  it('fails closed with the stable interruption when authorization currentness is unavailable', async () => {
    const store = createInMemoryWorkflowCoordinatorStore();
    const executeStep = vi.fn(async () => ({ kind: 'completed' as const, result: 'unexpected' }));
    const coordinator = createWorkflowCoordinator({
      store,
      resolveWorkspace,
      isAcceptedAuthorizationCurrent: async () => { throw new Error('owner_unavailable'); },
      executeStep,
    });

    await expect(coordinator.run({
      runId: 'run-authorization-unavailable',
      definition: definition([step('a')]),
      inputs: {},
      executionTarget,
      authorization,
    })).resolves.toEqual({ state: 'interrupted', reason: 'workflow_authorization_not_current' });
    expect(executeStep).not.toHaveBeenCalled();
    expect([...store.records.values()][0]).toMatchObject({
      lifecycle: 'needs_attention',
      reason: 'workflow_authorization_not_current',
    });
  });
});
