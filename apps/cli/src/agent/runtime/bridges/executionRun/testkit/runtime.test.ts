import { describe, expect, it, vi } from 'vitest';

import { createTestExecutionRunHostRuntime } from './runtime';

describe('createTestExecutionRunHostRuntime', () => {
  it('creates a runtime-native harness with message delivery and override hooks', async () => {
    const sendPrompt = vi.fn((_runtimeId: string, prompt: string, actions) => {
      actions.emit({ type: 'model-output', fullText: prompt.toUpperCase() });
    });
    const harness = createTestExecutionRunHostRuntime({
      runtimeId: 'runtime_1',
      sendPrompt,
    });
    const messages: unknown[] = [];

    const unsubscribe = harness.runtime.subscribeMessages((message) => {
      messages.push(message);
    });

    const provisioned = await harness.runtime.provisionRuntime();
    await harness.runtime.deliverInput('runtime_1', { text: 'ok' });
    unsubscribe();
    harness.emit({ type: 'model-output', fullText: 'ignored' });

    expect(provisioned).toEqual({ runtimeId: 'runtime_1' });
    expect(sendPrompt).toHaveBeenCalledWith('runtime_1', 'ok', { emit: harness.emit }, undefined);
    expect(messages).toEqual([{ type: 'model-output', fullText: 'OK' }]);
  });
});
