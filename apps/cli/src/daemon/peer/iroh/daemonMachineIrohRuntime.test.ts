import { describe, expect, it, vi } from 'vitest';

import { createDaemonMachineIrohRuntime } from './daemonMachineIrohRuntime';

const HOME_DESCRIPTOR = {
  v: 1,
  homeServerIdentityId: 'srv_home_iroh',
  canonicalServerUrl: 'https://home.example',
  revision: 7,
  endpoints: [{ kind: 'iroh', endpointId: 'c'.repeat(64), relayUrls: ['https://relay.test/'] }],
} as never;

const WORKSPACE_SYNC_HANDSHAKE = { v: 1, flow: 'workspace_sync', operationId: 'operation-1', exact: 'verified' };

function nativeHarness(overrides: Record<string, unknown> = {}) {
  return {
    createEndpoint: vi.fn(async () => ({ endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64) })),
    getEndpointStatus: vi.fn(async () => ({
      endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64), relayMode: 'custom', relayUrls: ['https://relay.test/'],
      capProfile: 'machineBulk', directAddresses: ['127.0.0.1:7777'], active: true,
    })),
    startMachineAcceptor: vi.fn(async () => ({})),
    stopMachineAcceptor: vi.fn(async () => undefined),
    startMachineTunnel: vi.fn(async () => ({
      machineTunnelId: 'tunnel-1', endpointHandle: 'endpoint-1', localPort: 48123,
      localCapability: 'c'.repeat(64),
      connectionActive: true, remoteEndpointId: 'b'.repeat(64), observedPath: 'relay',
      startedAtMs: 1, lastErrorCode: null,
    })),
    stopMachineTunnel: vi.fn(async () => undefined),
    ensureHomeTunnel: vi.fn(async () => ({
      tunnelId: 'home-tunnel-1', endpointHandle: 'endpoint-1',
      homeServerIdentityId: 'srv_home_iroh', homeEndpointId: 'c'.repeat(64),
      runtimeOrigin: 'http://127.0.0.1:49123', carrier: 'iroh', observedPath: 'direct',
      startedAtMs: 1, descriptorRevision: 7,
    })),
    releaseHomeTunnel: vi.fn(async () => undefined),
    shutdownEndpoint: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function createHarness(nativeOverrides: Record<string, unknown> = {}, connectTcp?: unknown) {
  const native = nativeHarness(nativeOverrides);
  const runtime = await createDaemonMachineIrohRuntime({
    happyHomeDir: '/daemon-home',
    relayConfig: { relayPolicy: 'automatic', relayUrls: ['https://relay.test/'] },
    native: native as never,
    ...(connectTcp ? { connectTcp: connectTcp as never } : {}),
  });
  return { native, runtime };
}

describe('createDaemonMachineIrohRuntime', () => {
  it('owns one daemon-lifetime endpoint, attempt acceptors, and exact verified tunnel handshakes', async () => {
    const order: string[] = [];
    let failNextAcceptorStop = false;
    const native = {
      createEndpoint: vi.fn(async () => ({ endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64) })),
      getEndpointStatus: vi.fn(async () => ({
        endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64), relayMode: 'custom', relayUrls: ['https://relay.test/'],
        capProfile: 'machineBulk', directAddresses: ['127.0.0.1:7777'], active: true,
      })),
      startMachineAcceptor: vi.fn(async () => { order.push('acceptor:start'); return {}; }),
      stopMachineAcceptor: vi.fn(async () => {
        if (failNextAcceptorStop) {
          failNextAcceptorStop = false;
          throw new Error('native acceptor stop failed');
        }
        order.push('acceptor:stop');
      }),
      startMachineTunnel: vi.fn(async () => ({
        machineTunnelId: 'tunnel-1', endpointHandle: 'endpoint-1', localPort: 48123,
        localCapability: 'c'.repeat(64),
        connectionActive: true, remoteEndpointId: 'b'.repeat(64), observedPath: 'relay',
        startedAtMs: 1, lastErrorCode: null,
      })),
      stopMachineTunnel: vi.fn(async () => { order.push('tunnel:stop'); }),
      ensureHomeTunnel: vi.fn(async () => ({
        tunnelId: 'home-tunnel-1', endpointHandle: 'endpoint-1',
        homeServerIdentityId: 'srv_home_iroh', homeEndpointId: 'c'.repeat(64),
        runtimeOrigin: 'http://127.0.0.1:49123', carrier: 'iroh', observedPath: 'direct',
        startedAtMs: 1, descriptorRevision: 7,
      })),
      releaseHomeTunnel: vi.fn()
        .mockRejectedValueOnce(new Error('native Home release failed'))
        .mockImplementation(async () => { order.push('home-tunnel:stop'); }),
      shutdownEndpoint: vi.fn()
        .mockRejectedValueOnce(new Error('native endpoint shutdown failed'))
        .mockImplementation(async () => { order.push('endpoint:stop'); }),
    };
    const write = vi.fn(async () => undefined);
    const connectTcp = vi.fn(async () => ({
      write, endWrite: async () => undefined,
      onData: () => () => undefined, close: async () => { order.push('tcp:stop'); },
    }));
    const runtime = await createDaemonMachineIrohRuntime({
      happyHomeDir: '/daemon-home',
      relayConfig: { relayPolicy: 'automatic', relayUrls: ['https://relay.test/'] },
      native: native as never,
      connectTcp: connectTcp as never,
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    expect(native.createEndpoint).toHaveBeenCalledTimes(1);
    expect(native.createEndpoint).toHaveBeenCalledWith(expect.objectContaining({
      keyPath: expect.stringMatching(/runtime[\\/]iroh[\\/]endpoint\.key$/), capProfile: 'machineBulk',
    }));
    expect(runtime.endpoint).toEqual({
      endpointId: 'a'.repeat(64), relayUrls: ['https://relay.test/'], directAddresses: ['127.0.0.1:7777'],
    });

    const homeLease = await runtime.ensureHomeTunnel!({
      descriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_iroh',
        canonicalServerUrl: 'https://home.example',
        revision: 7,
        endpoints: [{ kind: 'iroh', endpointId: 'c'.repeat(64), relayUrls: ['https://relay.test/'] }],
      } as never,
    });
    expect(native.ensureHomeTunnel).toHaveBeenCalledWith({
      endpointHandle: 'endpoint-1', homeServerIdentityId: 'srv_home_iroh',
      endpointId: 'c'.repeat(64), relayUrls: ['https://relay.test/'], descriptorRevision: 7,
    });
    expect(homeLease.runtimeOrigin).toBe('http://127.0.0.1:49123');
    await expect(homeLease.release()).rejects.toThrow('native Home release failed');
    await runtime.stopActiveTunnels();
    expect(native.releaseHomeTunnel).toHaveBeenCalledTimes(2);

    await runtime.startAttemptAcceptor({ admissionPort: 47001 });
    failNextAcceptorStop = true;
    await expect(runtime.stopAttemptAcceptor()).rejects.toThrow('native acceptor stop failed');
    await runtime.stopAttemptAcceptor();
    await runtime.startAttemptAcceptor({ admissionPort: 47002 });
    expect(native.createEndpoint).toHaveBeenCalledTimes(1);

    const handshake = { v: 1, flow: 'workspace_sync', operationId: 'operation-1', exact: 'verified' };
    const tunnel = await runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: handshake as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    expect(tunnel).toMatchObject({
      localPort: 48123,
      localCapability: 'c'.repeat(64),
      remoteEndpointId: 'b'.repeat(64),
      observedPath: 'relay',
    });
    expect(connectTcp).not.toHaveBeenCalled();
    await tunnel.close();

    const connection = await runtime.openTransport({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: handshake as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    expect(native.startMachineTunnel).toHaveBeenCalledWith(expect.objectContaining({
      endpointHandle: 'endpoint-1', endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'],
      handshakeJson: JSON.stringify(handshake), capProfile: 'machineBulk',
    }));
    expect(connectTcp).toHaveBeenCalledWith({ host: '127.0.0.1', port: 48123 });
    expect(write).toHaveBeenCalledWith(Buffer.from('c'.repeat(64), 'ascii'));
    expect(connection.remoteEndpointId).toBe('b'.repeat(64));

    await expect(runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'file_transfer',
      operationId: 'operation-1', handshake: handshake as never,
    }, { endpointId: 'b'.repeat(64) })).rejects.toThrow('does not match the verified handshake');

    await runtime.stopActiveTunnels();
    await expect(runtime.shutdown()).rejects.toThrow('native endpoint shutdown failed');
    await runtime.shutdown();
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['home-tunnel:stop', 'acceptor:start', 'acceptor:stop', 'acceptor:start', 'tunnel:stop', 'tcp:stop', 'tunnel:stop', 'acceptor:stop', 'endpoint:stop']);
  });

  it('coalesces concurrent Home lease release callers onto one native release', async () => {
    const { native, runtime } = await createHarness();
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    const lease = await runtime.ensureHomeTunnel!({ descriptor: HOME_DESCRIPTOR });
    const direct = lease.release();
    const throughOwner = runtime.stopActiveTunnels();
    await Promise.all([direct, throughOwner]);
    expect(native.releaseHomeTunnel).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent machine tunnel close callers onto one native stop', async () => {
    const { native, runtime } = await createHarness();
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    const tunnel = await runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    const direct = tunnel.close();
    const throughOwner = runtime.stopActiveTunnels();
    await Promise.all([direct, throughOwner]);
    expect(native.stopMachineTunnel).toHaveBeenCalledTimes(1);
  });

  it('releases the owned native tunnel even when the subsidiary local stream close fails', async () => {
    const { native, runtime } = await createHarness({}, async () => ({
      write: async () => undefined,
      endWrite: async () => undefined,
      onData: () => () => undefined,
      close: async () => { throw new Error('local stream close failed'); },
    }));
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    const connection = await runtime.openTransport({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    await expect(connection.close()).resolves.toBeUndefined();
    expect(native.stopMachineTunnel).toHaveBeenCalledWith('tunnel-1');
    await runtime.stopActiveTunnels();
    expect(native.stopMachineTunnel).toHaveBeenCalledTimes(1);
  });

  it('disposes the endpoint created before the status and descriptor projection when that projection fails', async () => {
    const native = nativeHarness({
      getEndpointStatus: vi.fn(async () => ({
        endpointHandle: 'endpoint-1', endpointId: 'a'.repeat(64), relayMode: 'custom', relayUrls: ['https://relay.test/'],
        capProfile: 'machineBulk', directAddresses: ['not-a-socket-address'], active: true,
      })),
    });

    await expect(createDaemonMachineIrohRuntime({
      happyHomeDir: '/daemon-home',
      relayConfig: { relayPolicy: 'automatic', relayUrls: ['https://relay.test/'] },
      native: native as never,
    })).rejects.toThrow();

    expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: 'endpoint-1' });
  });

  it('returns failed-but-cleanable custody when startup projection and its first endpoint shutdown both fail', async () => {
    const projectionFailure = new Error('endpoint status projection failed');
    const native = nativeHarness({
      getEndpointStatus: vi.fn(async () => { throw projectionFailure; }),
      shutdownEndpoint: vi.fn()
        .mockRejectedValueOnce(new Error('native endpoint shutdown failed'))
        .mockResolvedValueOnce(undefined),
    });

    const result = await createDaemonMachineIrohRuntime({
      happyHomeDir: '/daemon-home',
      relayConfig: { relayPolicy: 'automatic', relayUrls: ['https://relay.test/'] },
      native: native as never,
    });

    expect(result).toMatchObject({
      available: false,
      reason: 'startup_failed',
      error: projectionFailure,
    });
    await expect(result.shutdown()).resolves.toBeUndefined();
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(2);
  });

  it('owns an acceptor attempt before native response validation and retains failed cleanup for retry', async () => {
    let failStop = true;
    const { native, runtime } = await createHarness({
      startMachineAcceptor: vi.fn(async () => {
        throw new Error('malformed native acceptor response');
      }),
      stopMachineAcceptor: vi.fn(async () => {
        if (failStop) throw new Error('native acceptor stop failed');
      }),
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    await expect(runtime.startAttemptAcceptor({ admissionPort: 47001 }))
      .rejects.toThrow('malformed native acceptor response');
    expect(native.stopMachineAcceptor).toHaveBeenCalledTimes(1);

    failStop = false;
    await expect(runtime.stopAttemptAcceptor()).resolves.toBeUndefined();
    expect(native.stopMachineAcceptor).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent acceptor stop callers onto one retryable native stop', async () => {
    let releaseStop!: () => void;
    const stopReleased = new Promise<void>((resolve) => { releaseStop = resolve; });
    const { native, runtime } = await createHarness({
      stopMachineAcceptor: vi.fn(async () => await stopReleased),
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    await runtime.startAttemptAcceptor({ admissionPort: 47001 });

    const first = runtime.stopAttemptAcceptor();
    const second = runtime.stopAttemptAcceptor();
    await vi.waitFor(() => expect(native.stopMachineAcceptor).toHaveBeenCalledTimes(1));
    releaseStop();
    await Promise.all([first, second]);
    expect(native.stopMachineAcceptor).toHaveBeenCalledTimes(1);
  });

  it('owns the machine tunnel from native creation, so a failed local-hop cleanup stays retryable through the owner', async () => {
    let failTunnelStop = true;
    const { native, runtime } = await createHarness({
      stopMachineTunnel: vi.fn(async () => {
        if (failTunnelStop) {
          failTunnelStop = false;
          throw new Error('native tunnel stop failed');
        }
      }),
    }, async () => { throw new Error('local hop connect failed'); });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    await expect(runtime.openTransport({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] }))
      .rejects.toThrow('local hop connect failed');
    expect(native.stopMachineTunnel).toHaveBeenCalledTimes(1);

    // The rejected cleanup left the native tunnel owned by the same runtime.
    await runtime.stopActiveTunnels();
    expect(native.stopMachineTunnel).toHaveBeenCalledTimes(2);
    await runtime.stopActiveTunnels();
    expect(native.stopMachineTunnel).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent shutdown callers onto one cleanup sequence and refuses new work afterwards', async () => {
    const { native, runtime } = await createHarness();
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    await runtime.startAttemptAcceptor({ admissionPort: 47001 });
    await Promise.all([runtime.shutdown(), runtime.shutdown()]);
    expect(native.stopMachineAcceptor).toHaveBeenCalledTimes(1);
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
    await expect(runtime.ensureHomeTunnel!({ descriptor: HOME_DESCRIPTOR }))
      .rejects.toThrow('Iroh daemon runtime is shut down');
    await expect(runtime.startAttemptAcceptor({ admissionPort: 47002 }))
      .rejects.toThrow('Iroh machine runtime is shut down');
    await expect(runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    }, { endpointId: 'b'.repeat(64) })).rejects.toThrow('Iroh machine runtime is shut down');
  });

  it('holds shutdown until a machine tunnel creation racing it settles and the created tunnel is released, never publishing it', async () => {
    let resolveCreate!: (value: {
      machineTunnelId: string;
      endpointHandle: string;
      localPort: number;
      localCapability: string;
      connectionActive: boolean;
      remoteEndpointId: string;
      observedPath: 'direct' | 'relay' | 'unknown';
      startedAtMs: number;
      lastErrorCode: string | null;
    }) => void;
    const { native, runtime } = await createHarness({
      startMachineTunnel: vi.fn(async () => await new Promise((resolve) => { resolveCreate = resolve; })),
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    // Admit the creation first, wait for the native creator to be called, then
    // begin shutdown, so the race is real.
    const creation = runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    await vi.waitFor(() => expect(native.startMachineTunnel).toHaveBeenCalledTimes(1));
    let shutdownSettled = false;
    const shutdown = runtime.shutdown();
    shutdown.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });

    // Shutdown must stay pending while an admitted creation is still in flight.
    expect(shutdownSettled).toBe(false);

    let releaseRacingTunnel!: () => void;
    const racingTunnelReleased = new Promise<void>((resolve) => { releaseRacingTunnel = resolve; });
    native.stopMachineTunnel = vi.fn(async () => { await racingTunnelReleased; });
    resolveCreate({
      machineTunnelId: 'tunnel-race', endpointHandle: 'endpoint-1', localPort: 48123,
      localCapability: 'c'.repeat(64), connectionActive: true, remoteEndpointId: 'b'.repeat(64),
      observedPath: 'relay', startedAtMs: 1, lastErrorCode: null,
    });

    // The racing creation is never published to its caller...
    await expect(creation).rejects.toThrow('Iroh machine runtime is shut down');
    // ...and shutdown stays pending until the created tunnel's custody is released.
    expect(shutdownSettled).toBe(false);
    expect(native.stopMachineTunnel).toHaveBeenCalledWith('tunnel-race');
    releaseRacingTunnel();
    await shutdown;
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
  });

  it('holds shutdown until a Home tunnel creation racing it settles and the created lease is released, never publishing it', async () => {
    let resolveCreate!: (value: {
      tunnelId: string;
      endpointHandle: string;
      homeServerIdentityId: string;
      homeEndpointId: string;
      runtimeOrigin: string;
      carrier: 'iroh';
      observedPath: 'direct' | 'relay' | 'unknown';
      startedAtMs: number;
      descriptorRevision: number | null;
    }) => void;
    const { native, runtime } = await createHarness({
      ensureHomeTunnel: vi.fn(async () => await new Promise((resolve) => { resolveCreate = resolve; })),
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    // Admit the creation first, wait for the native creator to be called, then
    // begin shutdown, so the race is real.
    const creation = runtime.ensureHomeTunnel!({ descriptor: HOME_DESCRIPTOR });
    await vi.waitFor(() => expect(native.ensureHomeTunnel).toHaveBeenCalledTimes(1));
    let shutdownSettled = false;
    const shutdown = runtime.shutdown();
    shutdown.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });

    // Shutdown must stay pending while an admitted creation is still in flight.
    expect(shutdownSettled).toBe(false);

    let releaseRacingLease!: () => void;
    const racingLeaseReleased = new Promise<void>((resolve) => { releaseRacingLease = resolve; });
    native.releaseHomeTunnel = vi.fn(async () => { await racingLeaseReleased; });
    resolveCreate({
      tunnelId: 'home-tunnel-race', endpointHandle: 'endpoint-1', homeServerIdentityId: 'srv_home_iroh',
      homeEndpointId: 'c'.repeat(64), runtimeOrigin: 'http://127.0.0.1:49123', carrier: 'iroh',
      observedPath: 'direct', startedAtMs: 1, descriptorRevision: 7,
    });

    // The racing lease is never published to its caller...
    await expect(creation).rejects.toThrow('Iroh daemon runtime is shut down');
    // ...and shutdown stays pending until the created lease's custody is released.
    expect(shutdownSettled).toBe(false);
    expect(native.releaseHomeTunnel).toHaveBeenCalledWith('home-tunnel-race');
    releaseRacingLease();
    await shutdown;
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
  });

  it('holds shutdown through the subsidiary local-hop creation and never publishes the machine transport', async () => {
    let resolveConnect!: (value: {
      write: (data: Uint8Array) => Promise<void>;
      endWrite: () => Promise<void>;
      onData: (listener: (data: Uint8Array) => void) => () => void;
      close: () => Promise<void>;
    }) => void;
    const connectTcp = vi.fn(async () => await new Promise<{
      write: (data: Uint8Array) => Promise<void>;
      endWrite: () => Promise<void>;
      onData: (listener: (data: Uint8Array) => void) => () => void;
      close: () => Promise<void>;
    }>((resolve) => { resolveConnect = resolve; }));
    let releaseTunnel!: () => void;
    const tunnelReleased = new Promise<void>((resolve) => { releaseTunnel = resolve; });
    const { native, runtime } = await createHarness({
      stopMachineTunnel: vi.fn(async () => { await tunnelReleased; }),
    }, connectTcp);
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    const creation = runtime.openTransport({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    await vi.waitFor(() => expect(connectTcp).toHaveBeenCalledTimes(1));

    let shutdownSettled = false;
    const shutdown = runtime.shutdown();
    shutdown.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });
    expect(shutdownSettled).toBe(false);

    resolveConnect({
      write: async () => undefined,
      endWrite: async () => undefined,
      onData: () => () => undefined,
      close: async () => undefined,
    });
    await expect(creation).rejects.toThrow('Iroh machine runtime is shut down');
    await vi.waitFor(() => expect(native.stopMachineTunnel).toHaveBeenCalledWith('tunnel-1'));
    expect(shutdownSettled).toBe(false);

    releaseTunnel();
    await shutdown;
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
  });

  it('keeps shutdown pending through a rejected creation and settles truthfully without leaked custody', async () => {
    let rejectCreate!: (error: unknown) => void;
    const { native, runtime } = await createHarness({
      startMachineTunnel: vi.fn(async () => await new Promise((_, reject) => { rejectCreate = reject; })),
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;

    // Admit the creation first, wait for the native creator to be called, then
    // begin shutdown, so the race is real.
    const creation = runtime.openTunnel({
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    }, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    await vi.waitFor(() => expect(native.startMachineTunnel).toHaveBeenCalledTimes(1));
    let shutdownSettled = false;
    const shutdown = runtime.shutdown();
    shutdown.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });

    // Shutdown must stay pending while an admitted creation is still in flight.
    expect(shutdownSettled).toBe(false);

    rejectCreate(new Error('native tunnel creation failed'));
    await expect(creation).rejects.toThrow('native tunnel creation failed');
    // The failed creation produced no custody; shutdown still settles truthfully.
    await shutdown;
    expect(shutdownSettled).toBe(true);
    expect(native.stopMachineTunnel).not.toHaveBeenCalled();
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
  });

  it('refuses new tunnel creation after shutdown begins without calling the native creators', async () => {
    let releaseOwnedTunnel!: () => void;
    const ownedTunnelReleased = new Promise<void>((resolve) => { releaseOwnedTunnel = resolve; });
    const { native, runtime } = await createHarness({
      stopMachineTunnel: vi.fn(async () => { await ownedTunnelReleased; }),
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    const openInput = {
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    } as const;
    await runtime.openTunnel(openInput, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });

    // Shutdown is pending on the owned tunnel's blocked release while the
    // refused creations below are attempted.
    const shutdown = runtime.shutdown();
    await vi.waitFor(() => expect(native.stopMachineTunnel).toHaveBeenCalledTimes(1));

    await expect(runtime.ensureHomeTunnel!({ descriptor: HOME_DESCRIPTOR }))
      .rejects.toThrow('Iroh daemon runtime is shut down');
    await expect(runtime.openTunnel(openInput, { endpointId: 'b'.repeat(64) }))
      .rejects.toThrow('Iroh machine runtime is shut down');
    await expect(runtime.openTransport(openInput, { endpointId: 'b'.repeat(64) }))
      .rejects.toThrow('Iroh machine runtime is shut down');
    expect(native.ensureHomeTunnel).not.toHaveBeenCalled();
    expect(native.startMachineTunnel).toHaveBeenCalledTimes(1);

    releaseOwnedTunnel();
    await shutdown;
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
  });

  it('attempts and settles every owned tunnel cleanup before shutdown proceeds or fails, keeping failed custody retryable', async () => {
    const stopCalls: string[] = [];
    let failTunnelStop = true;
    let releaseBlockingStop!: () => void;
    const blockingStopReleased = new Promise<void>((resolve) => { releaseBlockingStop = resolve; });
    let tunnelSeq = 0;
    const { native, runtime } = await createHarness({
      startMachineTunnel: vi.fn(async () => {
        tunnelSeq += 1;
        return {
          machineTunnelId: `tunnel-${tunnelSeq}`, endpointHandle: 'endpoint-1', localPort: 48120 + tunnelSeq,
          localCapability: 'c'.repeat(64),
          connectionActive: true, remoteEndpointId: 'b'.repeat(64), observedPath: 'relay',
          startedAtMs: 1, lastErrorCode: null,
        };
      }),
      stopMachineTunnel: vi.fn(async (machineTunnelId: string) => {
        stopCalls.push(machineTunnelId);
        if (machineTunnelId === 'tunnel-1' && failTunnelStop) throw new Error('native tunnel stop failed');
        await blockingStopReleased;
      }),
    });
    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    const openInput = {
      alpn: 'happier/machine/1', remoteEndpointId: 'b'.repeat(64), flow: 'workspace_sync',
      operationId: 'operation-1', handshake: WORKSPACE_SYNC_HANDSHAKE as never,
    } as const;
    await runtime.openTunnel(openInput, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });
    await runtime.openTunnel(openInput, { endpointId: 'b'.repeat(64), directAddresses: ['10.0.0.2:7777'] });

    let shutdownSettled = false;
    const shutdownOutcome = runtime.shutdown();
    shutdownOutcome.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });

    // Every owned release was attempted, and shutdown neither settled nor shut
    // the endpoint down while the blocking release was still unresolved.
    await vi.waitFor(() => expect(stopCalls).toEqual(['tunnel-1', 'tunnel-2']));
    expect(shutdownSettled).toBe(false);
    expect(native.shutdownEndpoint).not.toHaveBeenCalled();

    releaseBlockingStop();
    await expect(shutdownOutcome).rejects.toThrow('native tunnel stop failed');
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);

    // Failed custody stays owned and retryable; the settled release is not repeated.
    failTunnelStop = false;
    stopCalls.length = 0;
    await runtime.shutdown();
    expect(stopCalls).toEqual(['tunnel-1']);
    expect(native.shutdownEndpoint).toHaveBeenCalledTimes(1);
  });
});
