import { describe, expect, it } from 'vitest';

import { buildOpenCodeThinkingModelOptionsFromVariants } from './thinking.js';

describe('buildOpenCodeThinkingModelOptionsFromVariants', () => {
  it('builds a sorted reasoning-effort option from OpenCode variants', () => {
    expect(buildOpenCodeThinkingModelOptionsFromVariants({
      high: { reasoningEffort: 'high' },
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      ignored: {},
    }, 'high')).toEqual([{
      id: 'reasoning_effort',
      name: 'Thinking',
      type: 'select',
      currentValue: 'high',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
      ],
    }]);
  });

  it('uses thinking blocks as reasoning-capable variants', () => {
    expect(buildOpenCodeThinkingModelOptionsFromVariants({
      max: { thinking: { enabled: true } },
    }, null)).toEqual([{
      id: 'reasoning_effort',
      name: 'Thinking',
      type: 'select',
      currentValue: 'max',
      options: [{ value: 'max', name: 'Max' }],
    }]);
  });

  it('uses released V2 variant arrays as reasoning-effort options', () => {
    expect(buildOpenCodeThinkingModelOptionsFromVariants([
      { id: 'high' },
      { id: 'low' },
      { id: 'high' },
    ], null)).toEqual([{
      id: 'reasoning_effort',
      name: 'Thinking',
      type: 'select',
      currentValue: 'high',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
      ],
    }]);
  });
});
