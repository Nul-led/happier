import { afterEach, describe, expect, it, vi } from 'vitest';

import { startServerFeaturesSnapshotRefreshLoop } from './serverFeaturesSnapshotRefreshLoop';

describe('startServerFeaturesSnapshotRefreshLoop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the transition cadence only while Home indexing remains active', async () => {
    vi.useFakeTimers();
    let transitionActive = true;
    const refresh = vi.fn(async () => {
      if (refresh.mock.calls.length === 2) transitionActive = false;
    });
    const loop = startServerFeaturesSnapshotRefreshLoop({
      refresh,
      isTransitionActive: () => transitionActive,
      transitionIntervalMs: 30_000,
      stableIntervalMs: 120_000,
    });

    await vi.runAllTicks();
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it('cancels the pending one-shot refresh when stopped', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const loop = startServerFeaturesSnapshotRefreshLoop({
      refresh,
      isTransitionActive: () => true,
      transitionIntervalMs: 30_000,
      stableIntervalMs: 120_000,
    });

    await vi.runAllTicks();
    expect(refresh).toHaveBeenCalledOnce();
    loop.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
