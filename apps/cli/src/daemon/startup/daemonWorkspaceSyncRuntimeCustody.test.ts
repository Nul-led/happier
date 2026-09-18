import { describe, expect, it, vi } from 'vitest';

import { createDaemonWorkspaceSyncRuntimeCustody } from './daemonWorkspaceSyncRuntimeCustody';

describe('createDaemonWorkspaceSyncRuntimeCustody', () => {
  it('retains custody after failed stop, prevents replacement, and permits a cleanup retry', async () => {
    let failStop = true;
    const first = { stop: vi.fn(async () => { if (failStop) throw new Error('stop failed'); }) };
    const second = { stop: vi.fn(async () => undefined) };
    const create = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const custody = createDaemonWorkspaceSyncRuntimeCustody<typeof first>();

    await expect(custody.acquire('machine-1', create)).resolves.toBe(first);
    await expect(custody.acquire('machine-2', create)).rejects.toThrow('stop failed');
    expect(create).toHaveBeenCalledOnce();
    expect(custody.get()).toBe(first);

    failStop = false;
    await expect(custody.acquire('machine-2', create)).resolves.toBe(second);
    expect(first.stop).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(custody.get()).toBe(second);
  });

  it('coalesces concurrent stop attempts and clears custody only after success', async () => {
    let finishStop!: () => void;
    const runtime = {
      stop: vi.fn(async () => await new Promise<void>((resolve) => { finishStop = resolve; })),
    };
    const custody = createDaemonWorkspaceSyncRuntimeCustody<typeof runtime>();
    await custody.acquire('machine-1', async () => runtime);

    const first = custody.stop();
    const second = custody.stop();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(custody.get()).toBe(runtime);
    finishStop();
    await Promise.all([first, second]);
    expect(custody.get()).toBeNull();
  });

  it('stops a replacement created while shutdown waits for the previous runtime to stop', async () => {
    let finishFirstStop!: () => void;
    const first = {
      stop: vi.fn(async () => await new Promise<void>((resolve) => { finishFirstStop = resolve; })),
    };
    const second = { stop: vi.fn(async () => undefined) };
    const custody = createDaemonWorkspaceSyncRuntimeCustody<typeof first | typeof second>();
    await custody.acquire('machine-1', async () => first);

    const replacement = custody.acquire('machine-2', async () => second);
    const shutdown = custody.stop();
    finishFirstStop();

    await expect(replacement).resolves.toBe(second);
    await expect(shutdown).resolves.toBeUndefined();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(custody.get()).toBeNull();
  });
});
