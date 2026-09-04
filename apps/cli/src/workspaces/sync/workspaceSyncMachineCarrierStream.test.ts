import { describe, expect, it, vi } from 'vitest';

import { connectWorkspaceSyncMachineTunnel } from './workspaceSyncMachineCarrierStream';

describe('connectWorkspaceSyncMachineTunnel', () => {
  it('releases a lifecycle-owned tunnel when cancellation precedes the loopback connection', async () => {
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('cancelled before connect'), { code: 'cancelled' }));
    const close = vi.fn(async () => undefined);

    await expect(connectWorkspaceSyncMachineTunnel({
      localPort: 47_321,
      localCapability: 'a'.repeat(64),
      observedPath: 'direct',
      close,
    }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });

    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves both cancellation and tunnel cleanup failure', async () => {
    const controller = new AbortController();
    const cancellation = Object.assign(new Error('cancelled before connect'), { code: 'cancelled' });
    const cleanupFailure = new Error('native tunnel close failed');
    controller.abort(cancellation);

    await expect(connectWorkspaceSyncMachineTunnel({
      localPort: 47_321,
      localCapability: 'a'.repeat(64),
      observedPath: 'direct',
      close: async () => { throw cleanupFailure; },
    }, controller.signal)).rejects.toMatchObject({ errors: [cancellation, cleanupFailure] });
  });
});
