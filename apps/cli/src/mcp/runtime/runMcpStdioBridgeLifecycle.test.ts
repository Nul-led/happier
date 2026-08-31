import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { runMcpStdioBridgeLifecycle } from './runMcpStdioBridgeLifecycle';

function asEventSource(emitter: EventEmitter) {
  return {
    once: (event: string, listener: () => void) => emitter.once(event, listener),
    off: (event: string, listener: () => void) => emitter.off(event, listener),
  };
}

describe('runMcpStdioBridgeLifecycle', () => {
  it('owns shutdown and closes both bridge resources once when stdin ends', async () => {
    const stdinEmitter = new EventEmitter();
    const signalEmitter = new EventEmitter();
    const transport: { onclose?: () => void } = {};
    const upstream: { onclose?: () => void } = {};
    const closeServer = vi.fn(async () => undefined);
    const closeUpstream = vi.fn(async () => undefined);

    const lifecycle = runMcpStdioBridgeLifecycle({
      stdin: { ...asEventSource(stdinEmitter), readableEnded: false, destroyed: false },
      signals: asEventSource(signalEmitter),
      start: async () => ({ transport, upstream }),
      closeServer,
      closeUpstream,
    });
    await Promise.resolve();
    stdinEmitter.emit('end');
    transport.onclose?.();

    await expect(lifecycle).resolves.toBeNull();
    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(closeUpstream).toHaveBeenCalledTimes(1);
  });
});
