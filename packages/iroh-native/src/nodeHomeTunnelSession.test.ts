import { describe, expect, it, vi } from 'vitest';

import type { NodeIrohNativeModule } from './nodeNative.types';
import { createNodeIrohHomeTunnelSession } from './nodeHomeTunnelSession';

const endpointId = 'a'.repeat(64);
const descriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_a',
  canonicalServerUrl: 'http://localhost:3010',
  revision: 7,
  endpoints: [{ kind: 'iroh' as const, endpointId, relayUrls: ['https://relay.example.test/'] }],
};

function nativeHarness(overrides: Partial<NodeIrohNativeModule> = {}): NodeIrohNativeModule {
  return {
    getAvailability: () => ({ available: true, os: 'linux', arch: 'x64', engine: 'test', surface: [] }),
    createEndpoint: vi.fn(async () => ({
      endpointHandle: 'endpoint-handle', endpointId: 'local-endpoint', relayPolicy: 'automatic',
      relayMode: 'custom', capProfile: 'homeInteractive', relayUrls: ['https://relay.example.test/'],
    })),
    ensureHomeTunnel: vi.fn(async () => ({
      tunnelId: 'tunnel-1', endpointHandle: 'endpoint-handle',
      homeServerIdentityId: descriptor.homeServerIdentityId, homeEndpointId: endpointId,
      runtimeOrigin: 'http://127.0.0.1:43123', carrier: 'iroh', observedPath: 'relay', startedAtMs: 1,
    })),
    releaseHomeTunnel: vi.fn(async () => undefined),
    shutdownEndpoint: vi.fn(async () => undefined),
    getEndpointStatus: vi.fn(async () => null),
    getTunnelStatus: vi.fn(async () => null),
    startHomeAcceptor: vi.fn(), stopHomeAcceptor: vi.fn(), startMachineAcceptor: vi.fn(),
    stopMachineAcceptor: vi.fn(), getMachineAcceptorStatus: vi.fn(async () => null),
    startMachineTunnel: vi.fn(), startMachineHttpTunnel: vi.fn(), stopMachineTunnel: vi.fn(),
    getMachineTunnelStatus: vi.fn(async () => null),
    ...overrides,
  } as NodeIrohNativeModule;
}

describe('createNodeIrohHomeTunnelSession', () => {
  it('requires production callers to supply persistent identity and makes keyless use explicit', async () => {
    const native = nativeHarness();

    await expect(createNodeIrohHomeTunnelSession({ native }))
      .rejects.toMatchObject({ code: 'invalid_descriptor' });
    await expect(createNodeIrohHomeTunnelSession({
      native,
      endpointKeyPath: '/home/test/.happier/runtime/iroh/endpoint.key',
      keylessEndpoint: 'probe',
    })).rejects.toMatchObject({ code: 'invalid_descriptor' });
    expect(native.createEndpoint).not.toHaveBeenCalled();
  });

  it('passes the exact descriptor identity and EndpointId through one native endpoint session', async () => {
    const native = nativeHarness();
    const session = await createNodeIrohHomeTunnelSession({
      native,
      endpointKeyPath: '/home/test/.happier/runtime/iroh/enrollment.key',
      relayPolicy: 'automatic',
      relayUrls: ['https://relay.example.test/'],
    });
    const lease = await session.ensureHomeTunnel({ descriptor });

    expect(native.createEndpoint).toHaveBeenCalledWith({
      keyPath: '/home/test/.happier/runtime/iroh/enrollment.key', relayPolicy: 'automatic',
      relayUrls: ['https://relay.example.test/'], capProfile: 'homeInteractive',
    });
    expect(native.ensureHomeTunnel).toHaveBeenCalledWith({
      endpointHandle: 'endpoint-handle', homeServerIdentityId: 'srv_home_a', endpointId,
      relayUrls: ['https://relay.example.test/'],
    });
    expect(lease).toMatchObject({ homeServerIdentityId: 'srv_home_a', endpointId, status: 'ready' });
    await lease.release();
    await session.shutdown();
    expect(native.releaseHomeTunnel).toHaveBeenCalledWith('tunnel-1');
    expect(native.shutdownEndpoint).toHaveBeenCalledWith({ endpointHandle: 'endpoint-handle' });
  });

  it('releases a mismatched native result and keeps the endpoint session cleanable', async () => {
    const native = nativeHarness({
      ensureHomeTunnel: vi.fn(async () => ({
        tunnelId: 'wrong-tunnel', endpointHandle: 'endpoint-handle', homeServerIdentityId: 'srv_home_b',
        homeEndpointId: 'b'.repeat(64), runtimeOrigin: 'http://127.0.0.1:43123', carrier: 'iroh',
        observedPath: 'direct', startedAtMs: 1,
      })),
    });
    const session = await createNodeIrohHomeTunnelSession({ native, keylessEndpoint: 'fixture', relayPolicy: 'automatic' });

    await expect(session.ensureHomeTunnel({ descriptor })).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(native.releaseHomeTunnel).toHaveBeenCalledWith('wrong-tunnel');
    await session.shutdown();
    expect(native.shutdownEndpoint).toHaveBeenCalledOnce();
  });

  it('releases a tunnel created across cancellation and shuts down without publishing it', async () => {
    let finish!: (value: Awaited<ReturnType<NodeIrohNativeModule['ensureHomeTunnel']>>) => void;
    const native = nativeHarness({ ensureHomeTunnel: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    const session = await createNodeIrohHomeTunnelSession({ native, keylessEndpoint: 'fixture', relayPolicy: 'automatic' });
    const controller = new AbortController();
    const acquiring = session.ensureHomeTunnel({ descriptor, signal: controller.signal });
    controller.abort();
    finish({
      tunnelId: 'cancelled-tunnel', endpointHandle: 'endpoint-handle',
      homeServerIdentityId: descriptor.homeServerIdentityId, homeEndpointId: endpointId,
      runtimeOrigin: 'http://127.0.0.1:43123', carrier: 'iroh', observedPath: 'relay', startedAtMs: 1,
    });

    await expect(acquiring).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.releaseHomeTunnel).toHaveBeenCalledWith('cancelled-tunnel');
    await session.shutdown();
    expect(native.shutdownEndpoint).toHaveBeenCalledOnce();
  });

  it('retains release and endpoint custody after failure so shutdown can retry', async () => {
    const releaseHomeTunnel = vi.fn()
      .mockRejectedValueOnce(new Error('release failed'))
      .mockResolvedValueOnce(undefined);
    const native = nativeHarness({ releaseHomeTunnel });
    const session = await createNodeIrohHomeTunnelSession({ native, keylessEndpoint: 'fixture', relayPolicy: 'automatic' });
    const lease = await session.ensureHomeTunnel({ descriptor });

    await expect(lease.release()).rejects.toThrow('release failed');
    await expect(session.shutdown()).resolves.toBeUndefined();
    expect(releaseHomeTunnel).toHaveBeenCalledTimes(2);
    expect(native.shutdownEndpoint).toHaveBeenCalledOnce();
  });

  it('retains endpoint custody when native endpoint shutdown fails so shutdown can retry', async () => {
    const shutdownEndpoint = vi.fn()
      .mockRejectedValueOnce(new Error('endpoint close failed'))
      .mockResolvedValueOnce(undefined);
    const native = nativeHarness({ shutdownEndpoint });
    const session = await createNodeIrohHomeTunnelSession({ native, keylessEndpoint: 'fixture', relayPolicy: 'automatic' });

    await expect(session.shutdown()).rejects.toThrow('endpoint close failed');
    await expect(session.shutdown()).resolves.toBeUndefined();
    expect(shutdownEndpoint).toHaveBeenCalledTimes(2);
  });
});
