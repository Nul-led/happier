import { describe, expect, it } from 'vitest';

import { projectOpenCodeTurnCancellationCause } from './openCodeRuntimeEvents.js';

describe('projectOpenCodeTurnCancellationCause', () => {
  it.each([
    ['host_shutdown', 'hostShutdown'],
    ['session_dispose', 'sessionDispose'],
    ['runtime_recovery', 'runtimeRecovery'],
    ['user', 'user'],
    ['cancelled', 'providerCancelled'],
    [undefined, 'providerCancelled'],
  ] as const)('maps %s to the canonical Agent cancellation cause', (reason, expected) => {
    expect(projectOpenCodeTurnCancellationCause(reason)).toBe(expected);
  });
});
