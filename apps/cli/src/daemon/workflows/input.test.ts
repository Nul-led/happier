import { describe, expect, it, vi } from 'vitest';
import { AutomationRunCauseSchema, deriveAutomationOccurrenceKeyV1 } from '@happier-dev/protocol';

import {
  bindAutomationWorkflowInputs,
  resolveAutomationWorkflowOccurrenceSeed,
  evaluateWorkflowCondition,
  materializeWorkflowStepInput,
  resolveWorkflowValueReference,
  WorkflowInputResolutionError,
  type WorkflowJsonValue,
  type WorkflowValueResolutionRuntime,
} from './input';

const runtime: WorkflowValueResolutionRuntime = {
  inputs: { topic: 'typed value' },
  item: { value: { path: 'a.ts' }, index: 0, position: 1, count: 2 },
  iteration: { index: 1, position: 2, count: 3, stopReason: null },
  resolveResult: vi.fn(async (producer) => {
    if (producer.blockId !== 'analyze') throw new WorkflowInputResolutionError('missing_reference');
    return { verdict: { passed: false }, text: 'analysis' };
  }),
  resolveWorkspace: vi.fn(async (producer) => {
    if (producer.blockId !== 'analyze') throw new WorkflowInputResolutionError('missing_reference');
    return { directory: '/worktrees/analyze/packages/app', checkoutRootPath: '/worktrees/analyze' };
  }),
};

describe('workflow input materialization', () => {
  it('projects the immutable schedule occurrence into the named workflow input seed', () => {
    expect(resolveAutomationWorkflowOccurrenceSeed({
      cause: AutomationRunCauseSchema.parse({
        kind: 'trigger',
        triggerId: 'trigger-1',
        triggerKind: 'schedule',
        triggerRevision: 4,
        occurrenceKey: deriveAutomationOccurrenceKeyV1({
          triggerId: 'trigger-1',
          evidence: { v: 1, kind: 'schedule', scheduledFor: 1_714_000_000_000 },
        }),
        occurredAt: 1_714_000_000_000,
        evidence: { scheduledFor: 1_714_000_000_000 },
      }),
      openedEvidence: null,
    })).toEqual({ scheduledFor: 1_714_000_000_000 });
  });

  it('keeps plugin and conversation occurrence evidence opaque and exact', () => {
    const evidence = { event: { id: 'evt-1' }, request: 'ship it' } as const;
    expect(resolveAutomationWorkflowOccurrenceSeed({
      cause: AutomationRunCauseSchema.parse({
        kind: 'trigger',
        triggerId: 'trigger-1',
        triggerKind: 'pluginEvent',
        triggerRevision: 2,
        occurrenceKey: deriveAutomationOccurrenceKeyV1({
          triggerId: 'trigger-1',
          evidence: {
            v: 1, kind: 'pluginEvent',
            eventRef: { pluginId: 'happier.test.plugin', localId: 'created' },
            sourceSelectorId: '9d5af559-2c82-4c22-b6a0-ecabce38a631', occurrenceId: 'occurrence-1', occurredAt: 1_714_000_000_000,
            payload: evidence,
          },
        }),
        occurredAt: 1_714_000_000_000,
        evidence: {
          eventRef: { pluginId: 'happier.test.plugin', localId: 'created' },
          sourceSelectorId: '9d5af559-2c82-4c22-b6a0-ecabce38a631',
        },
      }),
      openedEvidence: evidence,
    })).toBe(evidence);
  });

  it('binds Automation evidence by declared name, applies defaults, and rejects gaps', () => {
    const definition = {
      version: 1 as const,
      inputs: [
        { name: 'event', valueType: 'json' as const, required: true },
        { name: 'attempt', valueType: 'number' as const, required: false, default: 1 },
      ],
      defaults: {}, blocks: [],
    };
    expect(bindAutomationWorkflowInputs({ definition, evidence: { event: { id: 'evt-1' } } }))
      .toEqual({ event: { id: 'evt-1' }, attempt: 1 });
    expect(() => bindAutomationWorkflowInputs({ definition, evidence: {} })).toThrowError('missing_required_input');
  });

  it('ignores undeclared schedule evidence for a zero-input workflow', () => {
    const scheduledFor = 1_714_000_000_000;
    const seed = resolveAutomationWorkflowOccurrenceSeed({
      cause: AutomationRunCauseSchema.parse({
        kind: 'trigger',
        triggerId: 'trigger-1',
        triggerKind: 'schedule',
        triggerRevision: 4,
        occurrenceKey: deriveAutomationOccurrenceKeyV1({
          triggerId: 'trigger-1',
          evidence: { v: 1, kind: 'schedule', scheduledFor },
        }),
        occurredAt: scheduledFor,
        evidence: { scheduledFor },
      }),
      openedEvidence: null,
    });
    expect(seed).toEqual({ scheduledFor });
    const definition = { version: 1 as const, inputs: [], defaults: {}, blocks: [] };
    expect(bindAutomationWorkflowInputs({ definition, evidence: seed })).toEqual({});
  });

  it('binds only the declared subset from richer schedule evidence by exact name', () => {
    const definition = {
      version: 1 as const,
      inputs: [{ name: 'topic', valueType: 'string' as const, required: true }],
      defaults: {}, blocks: [],
    };
    expect(bindAutomationWorkflowInputs({
      definition,
      evidence: { scheduledFor: 1_714_000_000_000, topic: 'nightly check', extra: 'drop me' },
    })).toEqual({ topic: 'nightly check' });
  });

  it('preserves an explicitly supplied JSON null and uses defaults only for absence', () => {
    const definition = {
      version: 1 as const,
      inputs: [
        { name: 'requiredValue', valueType: 'json' as const, required: true, default: { fallback: true } },
        { name: 'defaultedValue', valueType: 'json' as const, required: false, default: null },
      ],
      defaults: {}, blocks: [],
    };

    expect(bindAutomationWorkflowInputs({ definition, evidence: { requiredValue: null } }))
      .toEqual({ requiredValue: null, defaultedValue: null });
  });
  it('keeps document text literal and appends declared structured values in authored order', async () => {
    const result = await materializeWorkflowStepInput({
      document: { text: 'Use {{topic}} and ${topic} literally.', references: [], attachments: [] },
      references: [
        { kind: 'input', name: 'topic' },
        { kind: 'result', producer: { blockId: 'analyze', scope: { kind: 'current' } }, path: ['verdict', 'passed'] },
        { kind: 'workspace', producer: { blockId: 'analyze', scope: { kind: 'current' } }, field: 'directory' },
        { kind: 'item', field: 'value' },
      ],
      runtime,
    });

    expect(result.text).toContain('Use {{topic}} and ${topic} literally.');
    expect(result.text).toContain('**Workflow inputs**');
    expect(result.text.indexOf('typed value')).toBeLessThan(result.text.indexOf('false'));
    const encodedInputs = JSON.parse(result.text.split('**Workflow inputs**\n\n')[1]!);
    expect(encodedInputs).toEqual([
      { reference: { kind: 'input', name: 'topic' }, value: 'typed value' },
      {
        reference: { kind: 'result', producer: { blockId: 'analyze', scope: { kind: 'current' } }, path: ['verdict', 'passed'] },
        value: false,
      },
      {
        reference: { kind: 'workspace', producer: { blockId: 'analyze', scope: { kind: 'current' } }, field: 'directory' },
        value: '/worktrees/analyze/packages/app',
      },
      { reference: { kind: 'item', field: 'value' }, value: { path: 'a.ts' } },
    ]);
    expect(result.values).toEqual(['typed value', false, '/worktrees/analyze/packages/app', { path: 'a.ts' }]);
    expect(result.references).toEqual([]);
    expect(result.attachments).toEqual([]);
  });

  it('resolves typed item, iteration, input, literal and exact result references', async () => {
    await expect(resolveWorkflowValueReference({ kind: 'input', name: 'topic' }, runtime)).resolves.toBe('typed value');
    await expect(resolveWorkflowValueReference({ kind: 'item', field: 'position' }, runtime)).resolves.toBe(1);
    await expect(resolveWorkflowValueReference({ kind: 'iteration', field: 'index' }, runtime)).resolves.toBe(1);
    await expect(resolveWorkflowValueReference({ kind: 'literal', value: ['x'] }, runtime)).resolves.toEqual(['x']);
    await expect(resolveWorkflowValueReference({
      kind: 'result', producer: { blockId: 'analyze', scope: { kind: 'current' } }, path: ['text'],
    }, runtime)).resolves.toBe('analysis');
    await expect(resolveWorkflowValueReference({
      kind: 'workspace', producer: { blockId: 'analyze', scope: { kind: 'current' } }, field: 'checkoutRootPath',
    }, runtime)).resolves.toBe('/worktrees/analyze');
  });

  it('uses strict condition semantics without JavaScript coercion', async () => {
    await expect(evaluateWorkflowCondition({
      kind: 'all',
      conditions: [
        { kind: 'exists', value: { kind: 'input', name: 'topic' } },
        {
          kind: 'compare', operator: 'eq',
          left: { kind: 'result', producer: { blockId: 'analyze', scope: { kind: 'current' } }, path: ['verdict', 'passed'] },
          right: { kind: 'literal', value: false },
        },
      ],
    }, runtime)).resolves.toBe(true);

    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'eq',
      left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: '1' },
    }, runtime)).resolves.toBe(false);

    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'eq',
      left: { kind: 'result', producer: { blockId: 'analyze', scope: { kind: 'current' } }, path: ['missing'] },
      right: { kind: 'literal', value: false },
    }, runtime)).rejects.toMatchObject({ code: 'invalid_condition' });
  });

  it('orders two strings with deterministic lexical comparison across lt/lte/gt/gte', async () => {
    // Literal strings compare by ordinary JavaScript UTF-16 code-unit order.
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'lt',
      left: { kind: 'literal', value: 'apple' }, right: { kind: 'literal', value: 'banana' },
    }, runtime)).resolves.toBe(true);
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'gt',
      left: { kind: 'literal', value: 'banana' }, right: { kind: 'literal', value: 'apple' },
    }, runtime)).resolves.toBe(true);
    // Code-unit order, not locale collation ('B' is U+0042, 'a' is U+0061).
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'lt',
      left: { kind: 'literal', value: 'B' }, right: { kind: 'literal', value: 'a' },
    }, runtime)).resolves.toBe(true);
    // Resolved string operands behave identically to literals.
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'lte',
      left: { kind: 'input', name: 'topic' }, right: { kind: 'literal', value: 'typed values' },
    }, runtime)).resolves.toBe(true);
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'gte',
      left: { kind: 'input', name: 'topic' }, right: { kind: 'literal', value: 'analysis' },
    }, runtime)).resolves.toBe(true);
  });

  it('treats equal operands as true only at the lte/gte boundary and keeps numeric ordering intact', async () => {
    for (const [operator, expected] of [
      ['lt', false], ['lte', true], ['gt', false], ['gte', true],
    ] as const) {
      await expect(evaluateWorkflowCondition({
        kind: 'compare', operator,
        left: { kind: 'literal', value: 'same' }, right: { kind: 'literal', value: 'same' },
      }, runtime)).resolves.toBe(expected);
    }
    for (const [operator, expected] of [
      ['lt', false], ['lte', true], ['gt', false], ['gte', true],
    ] as const) {
      await expect(evaluateWorkflowCondition({
        kind: 'compare', operator,
        left: { kind: 'literal', value: 2 }, right: { kind: 'literal', value: 2 },
      }, runtime)).resolves.toBe(expected);
    }
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'lt',
      left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 2 },
    }, runtime)).resolves.toBe(true);
  });

  it('keeps mixed string/number ordering operands a typed invalid_condition', async () => {
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'lt',
      left: { kind: 'input', name: 'topic' }, right: { kind: 'literal', value: 3 },
    }, runtime)).rejects.toMatchObject({ code: 'invalid_condition' });
    await expect(evaluateWorkflowCondition({
      kind: 'compare', operator: 'gte',
      left: { kind: 'literal', value: '9' }, right: { kind: 'literal', value: 10 },
    }, runtime)).rejects.toMatchObject({ code: 'invalid_condition' });
  });

  it('treats only an absent reference as false for exists and keeps invalid paths typed', async () => {
    await expect(evaluateWorkflowCondition({
      kind: 'exists', value: { kind: 'input', name: 'absent' },
    }, runtime)).resolves.toBe(false);
    await expect(evaluateWorkflowCondition({
      kind: 'exists',
      value: { kind: 'result', producer: { blockId: 'analyze', scope: { kind: 'current' } }, path: ['missing'] },
    }, runtime)).rejects.toMatchObject({ code: 'invalid_condition' });
  });

  it('resolves structured inputs in authored order and stops at the first typed failure', async () => {
    const events: string[] = [];
    const orderedRuntime: WorkflowValueResolutionRuntime = {
      inputs: {},
      resolveResult: async (producer) => {
        events.push(producer.blockId);
        if (producer.blockId === 'bad') throw new WorkflowInputResolutionError('missing_reference');
        return producer.blockId;
      },
      resolveWorkspace: async () => {
        throw new WorkflowInputResolutionError('missing_reference');
      },
    };
    await expect(materializeWorkflowStepInput({
      document: { text: 'Literal', references: [], attachments: [] },
      references: [
        { kind: 'result', producer: { blockId: 'first', scope: { kind: 'current' } }, path: [] },
        { kind: 'result', producer: { blockId: 'bad', scope: { kind: 'current' } }, path: [] },
        { kind: 'result', producer: { blockId: 'never', scope: { kind: 'current' } }, path: [] },
      ],
      runtime: orderedRuntime,
    })).rejects.toMatchObject({ code: 'missing_reference' });
    expect(events).toEqual(['first', 'bad']);
  });

  it('rejects a materialized prompt above the canonical UTF-8 byte boundary without truncation', async () => {
    await expect(materializeWorkflowStepInput({
      document: { text: 'é'.repeat(131_073), references: [], attachments: [] },
      references: [],
      runtime,
    })).rejects.toMatchObject({ code: 'workflow_input_too_large' });
  });
});
