import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { bindEphemeralRunnerShutdown, type EphemeralRunnerShutdownSignal } from './shutdown';

class SignalSource extends EventEmitter {
  override on(signal: EphemeralRunnerShutdownSignal, listener: () => void): this {
    return super.on(signal, listener);
  }

  override off(signal: EphemeralRunnerShutdownSignal, listener: () => void): this {
    return super.off(signal, listener);
  }
}

describe('ephemeral Runner process close binding', () => {
  it('routes every signal family through one close decision and removes all listeners', async () => {
    const source = new SignalSource();
    const requestClose = vi.fn(async () => 'stopped' as const);
    const unbind = bindEphemeralRunnerShutdown({ requestClose, source });

    source.emit('SIGINT');
    source.emit('SIGTERM');
    source.emit('SIGHUP');
    source.emit('SIGBREAK');
    await vi.waitFor(() => expect(requestClose).toHaveBeenCalledOnce());

    unbind();
    expect(source.listenerCount('SIGINT')).toBe(0);
    expect(source.listenerCount('SIGTERM')).toBe(0);
    expect(source.listenerCount('SIGHUP')).toBe(0);
    expect(source.listenerCount('SIGBREAK')).toBe(0);
  });

  it('allows a later signal after the user keeps the active Runner open', async () => {
    const source = new SignalSource();
    const requestClose = vi
      .fn<() => Promise<'kept_open' | 'stopped'>>()
      .mockResolvedValueOnce('kept_open')
      .mockResolvedValueOnce('stopped');
    const unbind = bindEphemeralRunnerShutdown({ requestClose, source });

    source.emit('SIGINT');
    await vi.waitFor(() => expect(requestClose).toHaveBeenCalledTimes(1));
    await requestClose.mock.results[0]!.value;
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    source.emit('SIGTERM');
    await vi.waitFor(() => expect(requestClose).toHaveBeenCalledTimes(2));

    unbind();
  });
});
