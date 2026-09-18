import { describe, expect, it, vi } from 'vitest';

import { createWorkflowRecoveryTriggers } from './recoveryTriggers';

describe('workflow recovery lifecycle triggers', () => {
  it('distinguishes startup, reconnect, and daemon resume without installing a timer', async () => {
    const recover = vi.fn(async () => {});
    const triggers = createWorkflowRecoveryTriggers(recover);

    await triggers.onConnected();
    await triggers.onConnected();
    await triggers.onResumed();

    expect(recover.mock.calls).toEqual([['startup'], ['reconnect'], ['resume']]);
    expect(triggers).toEqual({ onConnected: expect.any(Function), onResumed: expect.any(Function) });
  });
});
