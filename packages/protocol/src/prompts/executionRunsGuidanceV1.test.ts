import { describe, expect, it } from 'vitest';

import {
  buildExecutionRunsGuidanceBlockV1,
  EXECUTION_RUNS_GUIDANCE_INTENTS_V1,
  isExecutionRunsGuidanceIntentV1,
} from './executionRunsGuidanceV1.js';

describe('executionRunsGuidanceV1', () => {
  it('always emits fixed native-first guidance without custom rules', () => {
    const result = buildExecutionRunsGuidanceBlockV1({ entries: [], maxChars: 0 });

    expect(result.text).toContain("current backend's native subagent facility by default");
    expect(result.text).toContain('Happier subagent');
    expect(result.text).toContain('Happier delegation run');
    expect(result.text).toContain('Happier execution run');
    expect(result.text).toContain('omit `sessionId`');
    expect(result.text).toContain('intentional explicit cross-session target');
    expect(result.text).toContain('Do not poll `execution.run.get` or `execution.run.list`');
    expect(result.text).toContain('one event-driven observation');
    expect(result.text.toLowerCase()).not.toContain('custom rule');
  });

  it('keeps fixed guidance ahead of custom rules and outside their budget', () => {
    const entry = { id: '1', description: 'Use a Happier review run' };
    const full = buildExecutionRunsGuidanceBlockV1({ entries: [entry], maxChars: 10_000 });
    const capped = buildExecutionRunsGuidanceBlockV1({ entries: [entry], maxChars: 1 });

    expect(full.text.indexOf('Happier-Managed Runs')).toBeLessThan(full.text.indexOf('Custom Execution-Run Rules'));
    expect(capped.text).toContain("current backend's native subagent facility by default");
    expect(capped.text).not.toContain('Use a Happier review run');
    expect(capped.includedCount).toBe(0);
    expect(capped.remainingCount).toBe(1);
  });

  it('keeps guidance intents limited to review, plan, and delegate', () => {
    expect(EXECUTION_RUNS_GUIDANCE_INTENTS_V1).toEqual(['review', 'plan', 'delegate']);
    expect(isExecutionRunsGuidanceIntentV1('review')).toBe(true);
    expect(isExecutionRunsGuidanceIntentV1('voice_agent')).toBe(false);
    expect(isExecutionRunsGuidanceIntentV1('memory_hints')).toBe(false);
  });

  it('adds an overflow note only when rules exceed the max char budget and the note fits', () => {
    const entry1 = { id: '1', description: 'Rule one' };
    const entry2 = { id: '2', description: 'Rule two is intentionally longer than the overflow note' };

    const full = buildExecutionRunsGuidanceBlockV1({ entries: [entry1, entry2], maxChars: 10_000 });
    const customBlock = full.text.slice(full.text.indexOf('# Custom Execution-Run Rules'));
    const ruleTwoStart = customBlock.indexOf('\n- Rule two');
    expect(ruleTwoStart).toBeGreaterThan(0);

    const overflowNote = '- (+1 more rules in settings)';
    const capped = buildExecutionRunsGuidanceBlockV1({
      entries: [entry1, entry2],
      maxChars: ruleTwoStart + 1 + overflowNote.length,
    });

    expect(capped.includedCount).toBe(1);
    expect(capped.remainingCount).toBe(1);
    expect(capped.text).toContain(overflowNote);
    const cappedCustomBlock = capped.text.slice(capped.text.indexOf('# Custom Execution-Run Rules'));
    expect(cappedCustomBlock.length).toBeLessThanOrEqual(ruleTwoStart + 1 + overflowNote.length);
  });

  it('omits the rules overflow note when it would exceed the max char budget', () => {
    const entry1 = { id: '1', description: 'Rule one' };
    const entry2 = { id: '2', description: 'Rule two' };

    const full = buildExecutionRunsGuidanceBlockV1({ entries: [entry1, entry2], maxChars: 10_000 });
    const customBlock = full.text.slice(full.text.indexOf('# Custom Execution-Run Rules'));
    const ruleTwoStart = customBlock.indexOf('\n- Rule two');
    expect(ruleTwoStart).toBeGreaterThan(0);

    const capped = buildExecutionRunsGuidanceBlockV1({
      entries: [entry1, entry2],
      maxChars: ruleTwoStart,
    });

    expect(capped.includedCount).toBe(1);
    expect(capped.remainingCount).toBe(1);
    expect(capped.text).not.toContain('more rules in settings');
    const cappedCustomBlock = capped.text.slice(capped.text.indexOf('# Custom Execution-Run Rules'));
    expect(cappedCustomBlock.length).toBeLessThanOrEqual(ruleTwoStart);
  });

  it('uses discovery-first Happier-managed run guidance when rules are present', () => {
    const result = buildExecutionRunsGuidanceBlockV1({
      entries: [
        {
          id: '1',
          description: 'Delegate reviews to a review run',
          suggestedIntent: 'review',
        },
      ],
      maxChars: 10_000,
    });

    expect(result.text).toContain('Happier-Managed Runs');
    expect(result.text).toContain('Custom Execution-Run Rules');
    expect(result.text).toContain('action_spec_search');
    expect(result.text).toContain('action_spec_get');
    expect(result.text).toContain('action_options_resolve');
    expect(result.text).toContain('action_execute');
    expect(result.text).toContain('provider/backend');
    expect(result.text).toContain('not parallelism slots');
    expect(result.text).not.toContain('execution_run_start');
    expect(result.text).not.toContain('## Delegating via MCP');
  });
});
