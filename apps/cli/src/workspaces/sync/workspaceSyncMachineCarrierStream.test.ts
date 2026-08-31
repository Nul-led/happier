import { describe, expect, it, vi } from 'vitest';

import { connectWorkspaceSyncMachineTunnel } from './workspaceSyncMachineCarrierStream';

describe('connectWorkspaceSyncMachineTunnel', () => {
  it('releases a lifecycle-owned tunnel when cancellation precedes the loopback connection', async () => {
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('cancelled before connect'), { code: 'cancelled' }));
    const close = vi.fn(async () => undefined);

    await expect(connectWorkspaceSyncMachineTunnel({
      localPort: 47_321,
      observedPath: 'direct',
      close,
    }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });

    expect(close).toHaveBeenCalledOnce();
  });
});
