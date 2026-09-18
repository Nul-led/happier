import { describe, expect, it } from 'vitest';

import { mergeAuthoredWithGeneratedAgentFacts } from './generatedFacts.js';

describe('mergeAuthoredWithGeneratedAgentFacts', () => {
  it('fails fast for a missing required generated fact', () => {
    expect(() => mergeAuthoredWithGeneratedAgentFacts({
      authored: {},
      label: 'required test fact',
      readGenerated: () => undefined,
    })).toThrow(/Missing required test fact for agent '.+'/);
  });

  it('uses an explicit missing-fact resolver without weakening required facts', () => {
    const facts = mergeAuthoredWithGeneratedAgentFacts<string, null>({
      authored: {},
      label: 'optional test fact',
      readGenerated: (_definition, agentId) => agentId === 'claude' ? 'declared' : undefined,
      resolveMissing: () => null,
    });

    expect(facts.antigravity).toBeNull();
    expect(facts.claude).toBe('declared');
  });
});
