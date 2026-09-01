import { describe, expect, it, vi } from 'vitest';

import {
  WorkspaceSyncSidecarLifecycle,
  type SpawnWorkspaceSyncSidecar,
  type WorkspaceSyncSidecarLifecycleDependencies,
  type WorkspaceSyncSidecarProcess,
} from './workspaceSyncSidecarLifecycle';

describe('WorkspaceSyncSidecarLifecycle', () => {
  it('starts one verified sidecar and delivers the complete broker bootstrap only on descriptor 3', async () => {
    let terminate!: () => void;
    const waitForTermination = new Promise<void>((resolve) => { terminate = resolve; });
    const command = vi.fn(async (input: { t: string }) => {
      if (input.t === 'shutdown') terminate();
      return [];
    });
    const closeBroker = vi.fn(async () => undefined);
    const stop = vi.fn(async () => { terminate(); });
    const spawn = vi.fn<SpawnWorkspaceSyncSidecar>(async () => ({ pid: 42, waitForTermination: async () => { await waitForTermination; return { type: 'exited' as const, code: 0 }; }, stop }));
    const openExternalStream = vi.fn();
    const brokerBootstrapDescriptor = new TextEncoder().encode('{"protocol":1,"secret":"descriptor-only"}');
    const setExpectedSidecarPid = vi.fn();
    const createBroker = vi.fn<WorkspaceSyncSidecarLifecycleDependencies['createBroker']>(async () => ({ bootstrapDescriptor: brokerBootstrapDescriptor, setExpectedSidecarPid, waitForReady: vi.fn(async () => undefined), command, close: closeBroker }));
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => ({
        managerPath: '/verified/bin/happier-mutagen',
        agentPath: '/verified/bin/happier-mutagen-agent',
        dataDir: '/daemon/workspace-sync/mutagen/data',
        brokerDir: '/daemon/workspace-sync/mutagen/broker',
        manifest: { engineVersion: '0.18.1', protocolEpoch: 'external-stream-v1' },
      })),
      createBroker,
      openExternalStream,
      spawn: async (input) => {
        input.onSpawned?.(42);
        return await spawn(input);
      },
      ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32).fill(7),
      randomId: () => 'opaque-id',
      onRestartReady: async () => undefined,
      shutdownGraceMs: 1_000,
    });

    await lifecycle.start();
    await lifecycle.start();
    expect(spawn).toHaveBeenCalledTimes(1);
    const launch = spawn.mock.calls[0]?.[0];
    expect(launch?.args).toEqual([
      '--daemon', '--data-directory', '/daemon/workspace-sync/mutagen/data',
      '--broker-descriptor', '3',
    ]);
    expect(JSON.stringify(launch?.args)).not.toContain('070707');
    expect(launch?.environment).toBeUndefined();
    expect(launch?.inheritedBrokerDescriptor).toEqual(brokerBootstrapDescriptor);
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ t: 'list' }));
    expect(createBroker).toHaveBeenCalledWith(expect.objectContaining({ openExternalStream }));
    expect(setExpectedSidecarPid).toHaveBeenCalledWith(42);

    await lifecycle.stop();
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ t: 'shutdown' }));
    expect(closeBroker).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('returns a typed engine_unavailable error when artifact resolution fails', async () => {
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => { throw new Error('missing artifact'); }),
      createBroker: vi.fn(), spawn: vi.fn(), ensurePrivateDirectory: vi.fn(),
      openExternalStream: vi.fn(),
      randomBytes: () => new Uint8Array(32), randomId: () => 'opaque-id',
      onRestartReady: async () => undefined,
      shutdownGraceMs: 0,
    });
    await expect(lifecycle.start()).rejects.toMatchObject({ code: 'engine_unavailable' });
  });

  it('fails startup when the spawned sidecar exits before authenticating', async () => {
    const stop = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => ({
        managerPath: '/verified/manager', agentPath: '/verified/agent',
        dataDir: '/private/data', brokerDir: '/private/broker',
        manifest: { engineVersion: '1', protocolEpoch: 'external-stream-v1' },
      })),
      createBroker: vi.fn(async () => ({
        bootstrapDescriptor: new Uint8Array([1]),
        waitForReady: async () => await new Promise<void>(() => {}),
        command: async () => [],
        close,
      })),
      openExternalStream: vi.fn(),
      spawn: vi.fn(async () => ({
        pid: 42,
        waitForTermination: async () => ({ type: 'exited' as const, code: 23 }),
        stop,
      })),
      ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32), randomId: () => 'opaque-id',
      onRestartReady: async () => undefined,
      shutdownGraceMs: 0,
    });

    const outcome = await Promise.race([
      lifecycle.start().then(() => 'ready', (error: unknown) => error),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 100)),
    ]);
    expect(outcome).toMatchObject({ code: 'engine_unavailable' });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });

  it('fails and retires a sidecar that stalls before authenticated readiness', async () => {
    let terminate!: (event: { type: 'exited'; code: number }) => void;
    const termination = new Promise<{ type: 'exited'; code: number }>((resolve) => { terminate = resolve; });
    const stop = vi.fn(async () => terminate({ type: 'exited', code: 0 }));
    const close = vi.fn(async () => undefined);
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => ({
        managerPath: '/verified/manager', agentPath: '/verified/agent',
        dataDir: '/private/data', brokerDir: '/private/broker',
        manifest: { engineVersion: '1', protocolEpoch: 'external-stream-v1' },
      })),
      createBroker: vi.fn(async () => ({
        bootstrapDescriptor: new Uint8Array([1]),
        waitForReady: async () => await new Promise<void>(() => {}),
        command: async () => [],
        close,
      })),
      openExternalStream: vi.fn(),
      spawn: vi.fn(async () => ({
        pid: 42,
        waitForTermination: async () => await termination,
        stop,
      })),
      ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32), randomId: () => 'opaque-id',
      onRestartReady: async () => undefined,
      startupDeadlineMs: 25,
      shutdownGraceMs: 0,
    });

    await expect(lifecycle.start()).rejects.toMatchObject({ code: 'engine_unavailable' });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });

  it('bounds a sidecar launcher that never resolves with the same startup deadline', async () => {
    const close = vi.fn(async () => undefined);
    const spawn = vi.fn<SpawnWorkspaceSyncSidecar>(async () => await new Promise<WorkspaceSyncSidecarProcess>(() => {}));
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => ({
        managerPath: '/verified/manager', agentPath: '/verified/agent',
        dataDir: '/private/data', brokerDir: '/private/broker',
        manifest: { engineVersion: '1', protocolEpoch: 'external-stream-v1' },
      })),
      createBroker: vi.fn(async () => ({
        bootstrapDescriptor: new Uint8Array([1]),
        waitForReady: async () => undefined,
        command: async () => [],
        close,
      })),
      openExternalStream: vi.fn(),
      spawn,
      ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32), randomId: () => 'opaque-id',
      onRestartReady: async () => undefined,
      startupDeadlineMs: 25,
      shutdownGraceMs: 0,
    });

    const outcome = await Promise.race([
      lifecycle.start().then(() => 'ready', (error: unknown) => error),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 100)),
    ]);
    expect(outcome).toMatchObject({ code: 'engine_unavailable' });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });

  it('stops a sidecar process that arrives after its startup deadline', async () => {
    let resolveSpawn!: (process: WorkspaceSyncSidecarProcess) => void;
    const deferredSpawn = new Promise<WorkspaceSyncSidecarProcess>((resolve) => { resolveSpawn = resolve; });
    const stop = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => ({
        managerPath: '/verified/manager', agentPath: '/verified/agent',
        dataDir: '/private/data', brokerDir: '/private/broker',
        manifest: { engineVersion: '1', protocolEpoch: 'external-stream-v1' },
      })),
      createBroker: vi.fn(async () => ({
        bootstrapDescriptor: new Uint8Array([1]),
        waitForReady: async () => undefined,
        command: async () => [],
        close,
      })),
      openExternalStream: vi.fn(),
      spawn: vi.fn(async () => await deferredSpawn),
      ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32), randomId: () => 'opaque-id',
      onRestartReady: async () => undefined,
      startupDeadlineMs: 25,
      shutdownGraceMs: 0,
    });

    await expect(lifecycle.start()).rejects.toMatchObject({ code: 'engine_unavailable' });
    resolveSpawn({
      pid: 42,
      waitForTermination: async () => await new Promise<never>(() => {}),
      stop,
    });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(close).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });

  it('supervises a crash restart without ever spawning a concurrent second sidecar', async () => {
    vi.useFakeTimers();
    const onRestartReady = vi.fn(async () => undefined);
    const exits: Array<(event: { type: 'exited'; code: number }) => void> = [];
    let active = 0;
    let maximumActive = 0;
    const spawn = vi.fn<SpawnWorkspaceSyncSidecar>(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const waitForTermination = new Promise<{ type: 'exited'; code: number }>((resolve) => exits.push(resolve));
      return {
        pid: 40 + exits.length,
        waitForTermination: async () => { const event = await waitForTermination; active -= 1; return event; },
        stop: async () => { active = Math.max(0, active - 1); },
      };
    });
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => ({ managerPath: '/verified/manager', agentPath: '/verified/agent', dataDir: '/private/data', brokerDir: '/private/broker', manifest: { engineVersion: '1', protocolEpoch: 'external-stream-v1' } })),
      createBroker: vi.fn(async () => ({ bootstrapDescriptor: new Uint8Array([1]), waitForReady: async () => undefined, command: async () => [], close: async () => undefined })),
      openExternalStream: vi.fn(), spawn, ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32), randomId: () => 'opaque-id',
      onRestartReady,
      shutdownGraceMs: 0,
    });
    await lifecycle.start();
    expect(onRestartReady).not.toHaveBeenCalled();
    exits[0]?.({ type: 'exited', code: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
    expect(onRestartReady).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
    vi.useRealTimers();
  });

  it('stops and closes a replacement sidecar when restart reconciliation fails', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const exits: Array<(event: { type: 'exited'; code: number }) => void> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const brokerCloses: Array<ReturnType<typeof vi.fn>> = [];
    let rejectRestartReconciliation!: (error: Error) => void;
    const restartReconciliation = new Promise<void>((_resolve, reject) => {
      rejectRestartReconciliation = reject;
    });
    const spawn = vi.fn<SpawnWorkspaceSyncSidecar>(async () => {
      let terminate!: (event: { type: 'exited'; code: number }) => void;
      const termination = new Promise<{ type: 'exited'; code: number }>((resolve) => { terminate = resolve; });
      exits.push(terminate);
      const stop = vi.fn(async () => terminate({ type: 'exited', code: 0 }));
      stops.push(stop);
      return { pid: 40 + exits.length, waitForTermination: async () => await termination, stop };
    });
    const lifecycle = new WorkspaceSyncSidecarLifecycle({
      resolveRuntime: vi.fn(async () => ({ managerPath: '/verified/manager', agentPath: '/verified/agent', dataDir: '/private/data', brokerDir: '/private/broker', manifest: { engineVersion: '1', protocolEpoch: 'external-stream-v1' } })),
      createBroker: vi.fn(async () => {
        const close = vi.fn(async () => undefined);
        brokerCloses.push(close);
        return { bootstrapDescriptor: new Uint8Array([1]), waitForReady: async () => undefined, command: async () => [], close };
      }),
      openExternalStream: vi.fn(), spawn, ensurePrivateDirectory: vi.fn(async () => undefined),
      randomBytes: () => new Uint8Array(32), randomId: () => 'opaque-id',
      onRestartReady: async () => await restartReconciliation,
      shutdownGraceMs: 0,
    });

    try {
      await lifecycle.start();
      exits[0]?.({ type: 'exited', code: 1 });
      await vi.advanceTimersByTimeAsync(250);

      expect(spawn).toHaveBeenCalledTimes(2);
      let waitingStartSettled = false;
      const waitingStart = lifecycle.start();
      void waitingStart.then(
        () => { waitingStartSettled = true; },
        () => { waitingStartSettled = true; },
      );
      await Promise.resolve();
      expect(waitingStartSettled).toBe(false);

      rejectRestartReconciliation(new Error('settings reconciliation failed'));
      await expect(waitingStart).rejects.toMatchObject({ code: 'engine_unavailable' });
      expect(stops[1]).toHaveBeenCalledTimes(1);
      expect(brokerCloses[1]).toHaveBeenCalledTimes(1);
    } finally {
      await lifecycle.stop();
      random.mockRestore();
      vi.useRealTimers();
    }
  });
});
