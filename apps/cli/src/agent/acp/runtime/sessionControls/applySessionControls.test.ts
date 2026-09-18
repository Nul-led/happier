import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyAcpRuntimeSessionModel } from './applySessionControls';

describe('applyAcpRuntimeSessionModel', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.HAPPIER_ACP_SESSION_CONTROL_TIMEOUT_MS;
  });

  it('does not issue a config fallback while a slow provider model request is still pending', async () => {
    vi.useFakeTimers();
    process.env.HAPPIER_ACP_SESSION_CONTROL_TIMEOUT_MS = '1';
    let resolveModel!: () => void;
    let settled = false;
    const setSessionConfigOption = vi.fn(async () => undefined);
    const pending = applyAcpRuntimeSessionModel({
      provider: 'codex',
      getSessionId: () => 'session-1',
      ensureBackend: async () => ({
        setSessionConfigOption,
        setSessionModel: async () => await new Promise<void>((resolve) => {
          resolveModel = resolve;
        }),
      }),
    }, 'model-b').then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(false);
    expect(setSessionConfigOption).not.toHaveBeenCalled();

    resolveModel();
    await pending;
  });
});
