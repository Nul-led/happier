import { describe, expect, it } from 'vitest';

import {
  WorkflowActionFailureV1Schema,
  areWorkflowRetainedRuntimeSelectionsEqualV1,
  projectWorkflowRetainedRuntimeSelectionV1,
  projectWorkflowBigIntV1,
  WorkflowFinalResultV1Schema,
  WorkflowInvocationLifecycleV1Schema,
  WorkflowControlV1Schema,
  WorkflowProgressEnvelopeV1Schema,
  WorkflowRecoveryChoiceV1Schema,
  WorkflowResultRefV1Schema,
  WorkflowRunInvocationIndexV1Schema,
  WorkflowRunOriginV1Schema,
  WorkflowRunSummaryV1Schema,
  WorkflowStepObservationV1Schema,
} from './workflowProgressV1.js';

describe('workflow progress v1', () => {
  it('represents exact recorded-workspace restoration as an explicit recovery choice', () => {
    expect(WorkflowRecoveryChoiceV1Schema.parse({
      kind: 'restore_workspace', invocation: { recordId: 'inv-1' },
      conversation: 'fresh_agent', input: { kind: 'original' },
    })).toEqual({
      kind: 'restore_workspace', invocation: { recordId: 'inv-1' },
      conversation: 'fresh_agent', input: { kind: 'original' },
    });
    expect(WorkflowRecoveryChoiceV1Schema.safeParse({
      kind: 'restore_workspace', invocation: { recordId: 'inv-1' },
      conversation: 'fresh_agent', input: { kind: 'original' }, targetPath: '/different',
    }).success).toBe(false);
  });
  it('projects database BigInts as canonical nonnegative decimal strings', () => {
    const base = {
      id: 'inv-1', runId: 'run-1', sequence: '0', parentRecordId: null,
      memberOrdinal: '12', attempt: '2', lifecycle: 'running',
      createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    };
    expect(WorkflowRunInvocationIndexV1Schema.safeParse(base).success).toBe(true);
    for (const invalid of ['01', '-1', '1.0', 1]) {
      expect(WorkflowRunInvocationIndexV1Schema.safeParse({ ...base, sequence: invalid }).success).toBe(false);
    }
    expect(projectWorkflowBigIntV1(0n)).toBe('0');
    expect(projectWorkflowBigIntV1(12345678901234567890n)).toBe('12345678901234567890');
    expect(BigInt(projectWorkflowBigIntV1(42n))).toBe(42n);
    expect(() => projectWorkflowBigIntV1(-1n)).toThrow(TypeError);
  });

  it('keeps lifecycle in the public index and out of the sealed progress payload', () => {
    expect(WorkflowInvocationLifecycleV1Schema.options).toHaveLength(13);
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'a', scope: [] },
      blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
      lifecycle: 'running',
    }).success).toBe(false);
  });

  it('records only the private proven-stopped marker for uncertain prior effects', () => {
    const base = {
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'a', scope: [] },
      blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
    } as const;
    expect(WorkflowProgressEnvelopeV1Schema.parse({
      ...base,
      uncertainPriorEffects: { activity: 'stopped' },
    }).uncertainPriorEffects).toEqual({ activity: 'stopped' });
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      uncertainPriorEffects: { activity: 'possibly_active' },
    }).success).toBe(false);
  });

  it('keeps the derived control projection closed to FLOW failure reasons', () => {
    expect(WorkflowControlV1Schema.parse({
      kind: 'interrupted',
      reason: 'invocation_failed',
    })).toEqual({ kind: 'interrupted', reason: 'invocation_failed' });
    expect(WorkflowControlV1Schema.safeParse({
      kind: 'interrupted',
      reason: 'generic_failure',
    }).success).toBe(false);
    expect(WorkflowControlV1Schema.safeParse({
      kind: 'terminal',
      outcome: 'failed',
    }).success).toBe(false);
  });

  it('reserves the private root path for the structural root frame', () => {
    const base = {
      kind: 'happier.workflow-progress.v1',
      attempt: '0',
      logicalInvocationRecordId: 'inv-root',
    } as const;
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      invocationPath: { blockId: '$root', scope: [] },
      blockKind: 'root',
    }).success).toBe(true);
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      invocationPath: { blockId: 'authored-step', scope: [] },
      blockKind: 'root',
    }).success).toBe(false);
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      invocationPath: { blockId: '$root', scope: [] },
      blockKind: 'step',
    }).success).toBe(false);
  });

  it('keeps provider resume identity private to detached execution correspondence', () => {
    const base = {
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'a', scope: [] },
      blockKind: 'step', attempt: '0', logicalInvocationRecordId: 'inv-1',
    } as const;
    expect(WorkflowProgressEnvelopeV1Schema.parse({
      ...base,
      execution: { kind: 'session', sessionId: 'session-1', localInputId: 'input-1' },
    }).execution).toEqual({ kind: 'session', sessionId: 'session-1', localInputId: 'input-1' });
    expect(WorkflowProgressEnvelopeV1Schema.parse({
      ...base,
      execution: {
        kind: 'detached_run',
        runId: 'run-1',
        localInputId: 'input-1',
        turnId: 'turn-1',
        runtimeSelection: {},
        providerResumeIdentity: {
          kind: 'provider_session.v1',
          backendTarget: {
            kind: 'backend',
            backendId: 'claude',
            sourceKind: 'built_in',
          },
          providerSessionId: 'provider-session-1',
        },
      },
    }).execution).toEqual({
      kind: 'detached_run',
      runId: 'run-1',
      localInputId: 'input-1',
      turnId: 'turn-1',
      runtimeSelection: {},
      providerResumeIdentity: {
        kind: 'provider_session.v1',
        backendTarget: {
          kind: 'backend',
          backendId: 'claude',
          sourceKind: 'built_in',
        },
        providerSessionId: 'provider-session-1',
      },
    });
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      execution: {
        kind: 'session',
        sessionId: 'session-1',
        localInputId: 'input-1',
        providerResumeIdentity: {
          kind: 'provider_session.v1',
          backendTarget: {
            kind: 'backend',
            backendId: 'claude',
            sourceKind: 'built_in',
          },
          providerSessionId: 'provider-session-1',
        },
      },
    }).success).toBe(false);
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      execution: { kind: 'detached_run', runId: 'run-1', localInputId: 'input-1', providerSessionId: 'secret' },
    }).success).toBe(false);
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      execution: { kind: 'detached_run', runId: 'run-1', localInputId: 'input-1' },
    }).success).toBe(false);
  });

  it('persists only the canonical safe runtime selection needed to reuse a detached conversation', () => {
    const runtimeSelection = projectWorkflowRetainedRuntimeSelectionV1({
      agentTarget: {
        kind: 'agent',
        identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
      },
      modelSelection: {
        v: 1,
        ref: {
          agentTargetKey: 'agent:happier.agent.claude/claude',
          providerConnectionId: 'provider-1',
          modelId: 'claude-opus',
        },
        updatedAt: 41,
      },
      profileId: 'reviewer',
      permissionMode: 'safe-yolo',
      sessionConfigOptionOverrides: {
        v: 1,
        updatedAt: 43,
        overrides: { reasoning: { value: 'high', updatedAt: 42 } },
      },
      mcpSelection: {
        v: 1,
        managedServersEnabled: false,
        forceIncludeServerIds: ['review'],
        forceExcludeServerIds: [],
      },
      connectedServices: {
        v: 1,
        bindingsByServiceId: {
          'happier.test.connected/service': { source: 'native' },
        },
      },
      conversation: { kind: 'shared_run' },
      workspace: { kind: 'reuse_original' },
    });

    expect(runtimeSelection).toEqual({
      agentTarget: {
        kind: 'agent',
        identity: { pluginId: 'happier.agent.claude', localId: 'claude' },
      },
      modelSelection: {
        v: 1,
        ref: {
          agentTargetKey: 'agent:happier.agent.claude/claude',
          providerConnectionId: 'provider-1',
          modelId: 'claude-opus',
        },
        updatedAt: 41,
      },
      profileId: 'reviewer',
      permissionMode: 'safe-yolo',
      sessionConfigOptionOverrides: {
        v: 1,
        updatedAt: 43,
        overrides: { reasoning: { value: 'high', updatedAt: 42 } },
      },
      mcpSelection: {
        v: 1,
        managedServersEnabled: false,
        forceIncludeServerIds: ['review'],
        forceExcludeServerIds: [],
      },
      connectedServices: {
        v: 2,
        bindingsByServiceId: {
          'happier.test.connected/service': { source: 'native' },
        },
      },
    });

    const progress = WorkflowProgressEnvelopeV1Schema.parse({
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'a', scope: [] },
      blockKind: 'step',
      attempt: '0',
      logicalInvocationRecordId: 'inv-1',
      execution: {
        kind: 'detached_run',
        runId: 'run-1',
        localInputId: 'input-1',
        runtimeSelection,
      },
    });
    expect(progress.execution).toMatchObject({ runtimeSelection });
  });

  it('compares retained runtime selections canonically and fails closed for missing or invalid witnesses', () => {
    const selected = projectWorkflowRetainedRuntimeSelectionV1({
      permissionMode: 'safe-yolo',
      profileId: 'reviewer',
      connectedServices: {
        v: 1,
        bindingsByServiceId: {
          'happier.test.connected/service': { source: 'native' },
        },
      },
    });
    const reordered = {
      connectedServices: {
        bindingsByServiceId: {
          'happier.test.connected/service': { source: 'native' },
        },
        v: 1,
      },
      profileId: 'reviewer',
      permissionMode: 'safe-yolo',
    };

    expect(areWorkflowRetainedRuntimeSelectionsEqualV1(selected, reordered)).toBe(true);
    expect(areWorkflowRetainedRuntimeSelectionsEqualV1(undefined, selected)).toBe(false);
    expect(areWorkflowRetainedRuntimeSelectionsEqualV1(selected, {
      ...reordered,
      permissionMode: 'read-only',
    })).toBe(false);
    expect(areWorkflowRetainedRuntimeSelectionsEqualV1(selected, {
      ...reordered,
      environmentVariables: { TOKEN: 'secret' },
    })).toBe(false);
    expect(areWorkflowRetainedRuntimeSelectionsEqualV1(selected, {
      ...reordered,
      profileId: undefined,
    })).toBe(false);
  });

  it('keeps container recovery state scalar and row-local', () => {
    const parsed = WorkflowProgressEnvelopeV1Schema.parse({
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'inspect', scope: [{ kind: 'iteration', blockId: 'files', index: 3 }] },
      frame: { ownerBlockId: 'files', source: { kind: 'item', index: '3' } },
      blockKind: 'loop', attempt: '0', logicalInvocationRecordId: 'inv-loop',
      container: {
        kind: 'loop', mode: 'items',
        source: { kind: 'result', recordId: 'inv-source', path: ['files'] },
        itemCount: '500', nextMemberIndex: '4', nextBodyBlockOrdinal: '1',
        closing: { code: 'fail_stop', causeInvocationRecordId: 'inv-failed' },
      },
      containerResult: { kind: 'container', containerRecordId: 'inv-loop' },
    });
    expect(parsed.container).toMatchObject({ kind: 'loop', nextMemberIndex: '4' });
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...parsed,
      container: { ...parsed.container, members: ['inv-1', 'inv-2'] },
    }).success).toBe(false);
  });

  it('persists an explicit retry conversation and original or replacement input', () => {
    const base = {
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'repair', scope: [] },
      blockKind: 'step', attempt: '1', logicalInvocationRecordId: 'inv-original',
      previousAttemptRecordId: 'inv-previous',
    } as const;
    expect(WorkflowProgressEnvelopeV1Schema.parse({
      ...base,
      recovery: { conversation: 'same_conversation', input: { kind: 'original' } },
    }).recovery).toEqual({ conversation: 'same_conversation', input: { kind: 'original' } });
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      recovery: { conversation: 'fresh_agent', input: { kind: 'replacement', value: { document: { text: 'retry', references: [], attachments: [] }, input: [] } }, providerHandle: 'private' },
    }).success).toBe(false);
  });

  it('keeps direct and Automation origins closed and distinct', () => {
    expect(WorkflowRunOriginV1Schema.parse({ kind: 'direct' })).toEqual({ kind: 'direct' });
    expect(WorkflowRunOriginV1Schema.safeParse({ kind: 'automation', automationId: 'a', extra: true }).success).toBe(false);
  });

  it('projects direct result delivery separately from terminal Run lifecycle', () => {
    const summary = WorkflowRunSummaryV1Schema.parse({
      id: 'run-1',
      origin: { kind: 'direct', originSessionId: 'session-1' },
      state: 'succeeded',
      revision: 3,
      machineId: 'machine-1',
      workflowCustodyState: 'settled',
      workflowResultDeliveryState: { kind: 'unavailable' },
      availability: {
        pause: false, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, restoreWorkspace: false, cancel: false,
        inspectExecution: true, disabledReasons: [],
      },
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:01:00.000Z',
    });
    expect(summary).toMatchObject({
      state: 'succeeded',
      workflowResultDeliveryState: { kind: 'unavailable' },
    });
    expect(WorkflowRunSummaryV1Schema.safeParse({
      ...summary,
      workflowResultDeliveryState: 'unavailable',
    }).success).toBe(false);
    expect(WorkflowRunSummaryV1Schema.safeParse({
      ...summary,
      availability: {
        pause: false, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, cancel: false,
        inspectExecution: true, disabledReasons: [],
      },
    }).success).toBe(false);
    expect(WorkflowRunSummaryV1Schema.safeParse({
      ...summary,
      availability: {
        pause: false, resumeBoundary: false, recoverSameConversation: false,
        recoverFreshAgent: false, retry: false, restoreWorkspace: false,
        cancel: false, inspectExecution: true,
      },
    }).success).toBe(false);
    expect(WorkflowRunSummaryV1Schema.parse({
      ...summary,
      workflowResultDeliveryState: {
        kind: 'unavailable',
        reason: 'workflow_outcome_unresolved',
      },
    }).workflowResultDeliveryState).toEqual({
      kind: 'unavailable',
      reason: 'workflow_outcome_unresolved',
    });
    expect(WorkflowRunSummaryV1Schema.safeParse({
      ...summary,
      workflowResultDeliveryState: { kind: 'unavailable', reason: 'invented_reason' },
    }).success).toBe(false);
  });

  it('requires the exact Run handle on the self-dependency failure and forbids details elsewhere', () => {
    expect(WorkflowActionFailureV1Schema.safeParse({
      ok: false,
      errorCode: 'workflow_wait_self_dependency',
      error: 'The calling Session is an execution target',
      details: { runId: 'run-1' },
    }).success).toBe(true);

    // Without the Run id a blocked agent has no stable handle to release its
    // turn and rejoin, so a conforming failure must not validate.
    expect(WorkflowActionFailureV1Schema.safeParse({
      ok: false,
      errorCode: 'workflow_wait_self_dependency',
      error: 'The calling Session is an execution target',
    }).success).toBe(false);

    for (const errorCode of ['run_not_found', 'currentness_conflict', 'ineligible_state']) {
      expect(WorkflowActionFailureV1Schema.safeParse({
        ok: false, errorCode, error: 'failed', details: { runId: 'run-1' },
      }).success, errorCode).toBe(false);
      expect(WorkflowActionFailureV1Schema.safeParse({
        ok: false, errorCode, error: 'failed',
      }).success, errorCode).toBe(true);
    }
  });

  it('couples the Workflow result value type to its kind', () => {
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'text', value: 'done' }).success).toBe(true);
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'decision', value: 'continue' }).success).toBe(true);
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'json', value: null }).success).toBe(true);
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'json', value: { ok: true } }).success).toBe(true);
    // A text result carries prose, never a bare number; a decision result
    // carries one authored decision string, never a structured object. The
    // authored result contract still owns which decision strings are allowed.
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'text', value: 42 }).success).toBe(false);
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'decision', value: { choice: 'continue' } }).success).toBe(false);
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'text', value: 'done', extra: true }).success).toBe(false);
    expect(WorkflowResultRefV1Schema.safeParse({ kind: 'unknown', value: 'done' }).success).toBe(false);
  });

  it('validates step observations and final results against the coupled result contract', () => {
    const input = {
      conversation: { kind: 'session', machineId: 'machine-1', sessionId: 'session-1' },
      localId: 'local-1',
    } as const;
    expect(WorkflowStepObservationV1Schema.safeParse({
      kind: 'completed', input, result: { kind: 'text', value: 'done' },
    }).success).toBe(true);
    expect(WorkflowStepObservationV1Schema.safeParse({
      kind: 'completed', input, result: { kind: 'json', value: null },
    }).success).toBe(true);
    expect(WorkflowStepObservationV1Schema.safeParse({
      kind: 'completed', input, result: { kind: 'text', value: 42 },
    }).success).toBe(false);
    expect(WorkflowStepObservationV1Schema.safeParse({
      kind: 'completed', input, result: { kind: 'decision', value: { choice: 'continue' } },
    }).success).toBe(false);
    expect(WorkflowFinalResultV1Schema.safeParse({
      kind: 'happier.workflow-final-result.v1',
      result: { kind: 'json', value: { ok: true } },
      producerInvocation: { recordId: 'inv-final' },
    }).success).toBe(true);
    expect(WorkflowFinalResultV1Schema.safeParse({
      kind: 'happier.workflow-final-result.v1',
      result: { kind: 'text', value: 'legacy result' },
    }).success).toBe(false);
    expect(WorkflowFinalResultV1Schema.safeParse({
      kind: 'happier.workflow-final-result.v1', result: { kind: 'decision', value: { choice: 'stop' } },
    }).success).toBe(false);
  });

  it('keeps workflow interaction state distinct from the selected step result', () => {
    const parsed = WorkflowProgressEnvelopeV1Schema.parse({
      kind: 'happier.workflow-progress.v1',
      invocationPath: { blockId: 'work', scope: [] },
      blockKind: 'step',
      attempt: '0',
      logicalInvocationRecordId: 'invocation-1',
      result: { changed: true },
      usage: { inputTokens: 120, outputTokens: 30, costUsd: 0.04 },
      interaction: {
        requests: {
          permission_1: {
            tool: 'Write',
            arguments: { path: '/repo/file.txt' },
            createdAt: 1,
            turnId: 'turn-1',
          },
        },
      },
    });

    expect(parsed.interaction).toEqual(expect.objectContaining({
      requests: expect.objectContaining({ permission_1: expect.objectContaining({ tool: 'Write' }) }),
    }));
    expect(parsed.result).toEqual({ changed: true });
    expect(parsed.usage).toEqual({ inputTokens: 120, outputTokens: 30, costUsd: 0.04 });
  });

  it('rejects usage values that the canonical runtime usage owner cannot represent', () => {
    const base = {
      kind: 'happier.workflow-progress.v1' as const,
      invocationPath: { blockId: 'work', scope: [] },
      blockKind: 'step' as const,
      attempt: '0',
      logicalInvocationRecordId: 'invocation-1',
    };

    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      usage: { inputTokens: 1.5 },
    }).success).toBe(false);
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      usage: { outputTokens: Number.MAX_SAFE_INTEGER + 1 },
    }).success).toBe(false);
    expect(WorkflowProgressEnvelopeV1Schema.safeParse({
      ...base,
      usage: { costUsd: Number.POSITIVE_INFINITY },
    }).success).toBe(false);
  });
});
