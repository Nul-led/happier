import { describe, expect, it } from 'vitest';

import { ExecutionRunLifecycleV1Schema } from './executionRunLifecycleV1.js';

describe('ExecutionRunLifecycleV1Schema', () => {
  it.each(['current', 'recovering', 'recoverable', 'recoverable_with_input', 'unavailable'] as const)(
    'accepts the canonical %s lifecycle state',
    (state) => {
      expect(ExecutionRunLifecycleV1Schema.parse({ v: 1, state })).toEqual({ v: 1, state });
    },
  );

  it('rejects unknown fields and unversioned lifecycle guesses', () => {
    expect(ExecutionRunLifecycleV1Schema.safeParse({ state: 'recoverable' }).success).toBe(false);
    expect(ExecutionRunLifecycleV1Schema.safeParse({ v: 1, state: 'recoverable', inferred: true }).success).toBe(false);
  });
});
