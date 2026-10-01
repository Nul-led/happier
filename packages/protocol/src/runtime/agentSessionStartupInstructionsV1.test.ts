import { describe, expect, it } from 'vitest';

import {
  AgentSessionStartupInstructionsMarkerV1Schema,
  AgentSessionStartupInstructionsV1Schema,
} from './agentSessionStartupInstructionsV1.js';

describe('AgentSessionStartupInstructionsV1Schema', () => {
  const canonical = {
    v: 1 as const,
    id: 'happier.global_voice_agent',
    revision: 1,
  };

  it('accepts the full session plan beyond the former Voice sample allowance', () => {
    // Native channels admit against their own context boundary; file transport
    // removes Windows argv as a prompt-text boundary (U0b).
    const instructions = '雪'.repeat(20_000);

    const parsed = AgentSessionStartupInstructionsV1Schema.parse({
      ...canonical,
      instructions,
    });

    expect(parsed).toEqual({
      ...canonical,
      instructions,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('accepts only the strict secret-free applied marker shape', () => {
    const parsed = AgentSessionStartupInstructionsMarkerV1Schema.parse(canonical);

    expect(parsed).toEqual(canonical);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(
      AgentSessionStartupInstructionsMarkerV1Schema.safeParse({
        ...canonical,
        instructions: 'must not be persisted',
      }).success,
    ).toBe(false);
  });

  it.each([
    ['empty instructions', { ...canonical, instructions: '' }],
    ['blank instructions', { ...canonical, instructions: '   ' }],
    ['invalid Unicode', { ...canonical, instructions: '\uD800' }],
    ['non-normalized Unicode', { ...canonical, instructions: 'e\u0301' }],
    ['malformed id', { ...canonical, id: 'Happier Voice', instructions: 'ok' }],
    ['zero revision', { ...canonical, revision: 0, instructions: 'ok' }],
    ['negative revision', { ...canonical, revision: -1, instructions: 'ok' }],
    ['out-of-range revision', {
      ...canonical,
      revision: 2_147_483_648,
      instructions: 'ok',
    }],
    ['unknown field', { ...canonical, instructions: 'ok', rawPromptHash: 'no' }],
  ])('rejects %s', (_label, input) => {
    expect(AgentSessionStartupInstructionsV1Schema.safeParse(input).success)
      .toBe(false);
  });
});
