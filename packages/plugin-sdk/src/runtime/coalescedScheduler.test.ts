import { describe, expect, it, vi } from 'vitest';

import { createCoalescedScheduler } from './coalescedScheduler.js';

describe('createCoalescedScheduler', () => {
  it('coalesces a synchronous trigger from the active drain without starting a competing drain', async () => {
    let drains = 0;
    let release!: () => void;
    const gate = { promise: new Promise<void>((resolve) => { release = resolve; }), resolve: () => release() };
    const scheduler = createCoalescedScheduler({
      drain: async () => {
        drains += 1;
        if (drains === 1) {
          scheduler.trigger();
          await gate.promise;
        }
      },
    });
    const flush = scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const drainsBeforeRelease = drains;
    gate.resolve();
    await flush;
    expect(drainsBeforeRelease).toBe(1);
    expect(drains).toBe(2);
  });

  it('rejects a flush barrier when its drain fails and remains usable for a later flush', async () => {
    const failure = new Error('metadata write failed');
    const errors: unknown[] = [];
    let available = false;
    const scheduler = createCoalescedScheduler({
      drain: async () => { if (!available) throw failure; },
      onError: (error) => { errors.push(error); },
    });
    await expect(scheduler.flush()).rejects.toBe(failure);
    expect(errors).toEqual([failure]);
    available = true;
    await expect(scheduler.flush()).resolves.toBeUndefined();
  });


    it('coalesces triggers that arrive while a drain is active into one follow-up drain', async () => {
        let releaseFirstDrain!: () => void;
        const firstDrain = new Promise<void>((resolve) => {
            releaseFirstDrain = resolve;
        });
        const drain = vi.fn(async () => {
            if (drain.mock.calls.length === 1) {
                await firstDrain;
            }
        });

        const scheduler = createCoalescedScheduler({ drain });
        scheduler.trigger();
        scheduler.trigger();
        scheduler.trigger();
        expect(drain).toHaveBeenCalledTimes(1);

        releaseFirstDrain();
        await vi.waitFor(() => {
            expect(drain).toHaveBeenCalledTimes(2);
        });

        scheduler.dispose();
    });

    it('does not start new drains after disposal', async () => {
        const drain = vi.fn(async () => {});
        const scheduler = createCoalescedScheduler({ drain });

        scheduler.dispose();
        scheduler.trigger();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(drain).not.toHaveBeenCalled();
    });

    it('flush waits for the active drain and one queued follow-up to finish', async () => {
        let releaseFirstDrain!: () => void;
        const firstDrain = new Promise<void>((resolve) => {
            releaseFirstDrain = resolve;
        });
        const drain = vi.fn(async () => {
            if (drain.mock.calls.length === 1) await firstDrain;
        });
        const scheduler = createCoalescedScheduler({ drain });

        scheduler.trigger();
        let flushed = false;
        const flushPromise = scheduler.flush().then(() => {
            flushed = true;
        });
        await Promise.resolve();
        expect(flushed).toBe(false);

        releaseFirstDrain();
        await flushPromise;

        expect(drain).toHaveBeenCalledTimes(2);
        expect(flushed).toBe(true);
        scheduler.dispose();
    });
});
