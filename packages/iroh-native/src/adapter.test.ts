import { describe, expect, it, vi } from 'vitest';

import { createIrohNativeAdapter, createOptionalIrohNativeAdapter } from './adapter';
import { IrohError } from './errors';

// The Expo native module lookup is a genuine system boundary (native module
// availability); the adapter mapping logic under test below stays real.
const optionalNativeModule = vi.hoisted(() => ({
  getAvailability: vi.fn(() => ({ available: true })),
  createEndpoint: vi.fn(),
  ensureHomeTunnel: vi.fn(),
  releaseHomeTunnel: vi.fn(),
  shutdownEndpoint: vi.fn(),
  getTunnelStatus: vi.fn(),
}));

vi.mock('./HappierIrohNative', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./HappierIrohNative')>();
  return { ...actual, getOptionalHappierIrohNativeModule: () => optionalNativeModule };
});

const LEASE_BASE = {
  leaseId: 'l1',
  homeServerIdentityId: 'srv_home_a',
  homeEndpointId: 'endpoint-a',
  runtimeOrigin: 'http://127.0.0.1:1234',
  carrier: 'iroh' as const,
  observedPath: 'direct' as const,
  startedAtMs: 1,
};

function nativeHarness(overrides: Partial<Parameters<typeof createIrohNativeAdapter>[0]> = {}) {
  return {
    ensureHomeTunnel: vi.fn(async () => ({ ...LEASE_BASE })),
    releaseHomeTunnel: vi.fn(async () => undefined),
    getTunnelStatus: vi.fn(async () => ({
      active: true,
      connectionActive: true,
      observedPath: 'direct' as const,
    })),
    ...overrides,
  };
}

describe('Iroh native lifecycle adapter', () => {
  it('carries policy and descriptor fields verbatim through the injected native lifecycle seam', async () => {
    const native = nativeHarness();
    const adapter = createIrohNativeAdapter(native);
    await adapter.ensureHomeTunnel({
      homeServerIdentityId: 'srv_home_a',
      endpointId: 'endpoint-a',
      policy: 'automatic',
      relayUrls: ['https://relay.example.test'],
      descriptorRevision: 7,
      endpointKeyPath: '/data/runtime/iroh/endpoint.key',
    });
    expect(native.ensureHomeTunnel).toHaveBeenCalledWith(expect.objectContaining({
      homeServerIdentityId: 'srv_home_a',
      endpointId: 'endpoint-a',
      // The injected lifecycle seam takes the adapter request verbatim; the
      // policy → relayPolicy rename belongs to the native module boundary.
      policy: 'automatic',
      relayUrls: ['https://relay.example.test'],
      descriptorRevision: 7,
      endpointKeyPath: '/data/runtime/iroh/endpoint.key',
    }));
  });

  it('creates one persistent application endpoint and ensures every Home by exact handle', async () => {
    optionalNativeModule.createEndpoint.mockResolvedValue({
      endpointHandle: 'application-endpoint', endpointId: 'client-endpoint',
      relayPolicy: 'disabled', relayMode: 'disabled', capProfile: 'homeInteractive', relayUrls: [],
    });
    optionalNativeModule.ensureHomeTunnel
      .mockResolvedValueOnce({ ...LEASE_BASE, tunnelId: 'l1' })
      .mockResolvedValueOnce({ ...LEASE_BASE, leaseId: 'l2', tunnelId: 'l2', homeServerIdentityId: 'srv_home_b' });
    const adapter = createOptionalIrohNativeAdapter();
    await adapter.ensureHomeTunnel({
      homeServerIdentityId: 'srv_home_a',
      endpointId: 'endpoint-a',
      policy: 'disabled',
      directAddresses: ['127.0.0.1:4242'],
      relayUrls: ['https://relay.example.test'],
      descriptorRevision: 7,
      endpointKeyPath: '/data/runtime/iroh/endpoint.key',
    });
    await adapter.ensureHomeTunnel({
      homeServerIdentityId: 'srv_home_b', endpointId: 'endpoint-a', policy: 'disabled',
    });
    expect(optionalNativeModule.createEndpoint).toHaveBeenCalledTimes(2);
    expect(optionalNativeModule.createEndpoint).toHaveBeenNthCalledWith(1, {
      keyPath: '/data/runtime/iroh/endpoint.key',
      relayPolicy: 'disabled',
      relayUrls: ['https://relay.example.test'],
    });
    expect(optionalNativeModule.createEndpoint).toHaveBeenNthCalledWith(2, {
      relayPolicy: 'disabled',
    });
    expect(optionalNativeModule.ensureHomeTunnel).toHaveBeenNthCalledWith(1, {
      endpointHandle: 'application-endpoint',
      homeServerIdentityId: 'srv_home_a',
      endpointId: 'endpoint-a',
      directAddresses: ['127.0.0.1:4242'],
      relayUrls: ['https://relay.example.test'],
      descriptorRevision: 7,
    });
  });

  it('normalizes Expo coded native failures into the canonical Iroh error', async () => {
    optionalNativeModule.createEndpoint.mockRejectedValueOnce(
      Object.assign(new Error('Iroh endpoint identity is unavailable.'), {
        code: 'endpoint_key_unavailable',
      }),
    );
    const adapter = createOptionalIrohNativeAdapter();

    await expect(adapter.ensureHomeTunnel({
      homeServerIdentityId: 'srv_home_a',
      endpointId: 'endpoint-a',
      policy: 'automatic',
    })).rejects.toMatchObject({
      name: 'IrohError',
      code: 'endpoint_key_unavailable',
    });
  });

  it('canonicalizes IrohError subclasses before they reach shared classifiers', async () => {
    const operationError = new IrohError('transport_closed', 'peer disconnected');
    operationError.name = 'IrohNativeOperationError';
    const native = nativeHarness({
      ensureHomeTunnel: vi.fn(async () => { throw operationError; }),
    });
    const adapter = createIrohNativeAdapter(native);

    await expect(adapter.ensureHomeTunnel({
      homeServerIdentityId: 'srv_home_a',
      endpointId: 'endpoint-a',
      policy: 'automatic',
    })).rejects.toMatchObject({ name: 'IrohError', code: 'transport_closed' });
  });

  it('fails closed when native returns a lease for a different Home identity', async () => {
    const native = nativeHarness({
      ensureHomeTunnel: vi.fn(async () => ({ ...LEASE_BASE, homeServerIdentityId: 'srv_home_b' })),
    });
    const adapter = createIrohNativeAdapter(native);
    await expect(adapter.ensureHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: 'endpoint-a', policy: 'automatic' }))
      .rejects.toMatchObject({ code: 'identity_mismatch' });
    // The misrouted lease must be released, never adopted for the wrong Home.
    expect(native.releaseHomeTunnel).toHaveBeenCalledWith('l1');
  });

  it('fails closed when native returns a lease bound to a different endpoint identity', async () => {
    const native = nativeHarness({
      ensureHomeTunnel: vi.fn(async () => ({ ...LEASE_BASE, homeEndpointId: 'endpoint-stale' })),
    });
    const adapter = createIrohNativeAdapter(native);
    await expect(adapter.ensureHomeTunnel({ homeServerIdentityId: 'srv_home_a', endpointId: 'endpoint-a', policy: 'automatic' }))
      .rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(native.releaseHomeTunnel).toHaveBeenCalledWith('l1');
  });

  it('exposes the typed identity-mismatch failure code', () => {
    expect(new IrohError('identity_mismatch', 'test').code).toBe('identity_mismatch');
  });

  it('normalizes polled native transport facts into coalesced lifecycle events without Home identity data', async () => {
    vi.useFakeTimers();
    try {
      const getTunnelStatus = vi.fn()
        .mockResolvedValueOnce({ active: true, connectionActive: true, observedPath: 'direct' })
        .mockResolvedValueOnce({ active: true, connectionActive: true, observedPath: 'relay' })
        .mockResolvedValueOnce({ active: false, connectionActive: false, observedPath: 'relay' })
        .mockResolvedValueOnce(null);
      const adapter = createIrohNativeAdapter(nativeHarness({ getTunnelStatus }), { statusPollIntervalMs: 100 });
      const lease = await adapter.ensureHomeTunnel({
        homeServerIdentityId: 'srv_home_a',
        endpointId: 'endpoint-a',
        policy: 'automatic',
      });
      const events: unknown[] = [];
      const unsubscribe = adapter.subscribeEvents(lease.leaseId, (event) => events.push(event));

      await vi.advanceTimersByTimeAsync(400);

      expect(events).toEqual([
        expect.objectContaining({ type: 'ready', tunnelHandle: 'l1', status: 'ready', observedPath: 'direct' }),
        expect.objectContaining({ type: 'path_changed', tunnelHandle: 'l1', status: 'ready', observedPath: 'relay' }),
        expect.objectContaining({ type: 'degraded', tunnelHandle: 'l1', status: 'degraded', observedPath: 'relay' }),
        expect.objectContaining({ type: 'closed', tunnelHandle: 'l1', status: 'closed' }),
      ]);
      for (const event of events) {
        expect(event).not.toHaveProperty('homeServerIdentityId');
        expect(event).not.toHaveProperty('runtimeOrigin');
        expect(event).not.toHaveProperty('descriptorRevision');
      }
      unsubscribe();
      await vi.advanceTimersByTimeAsync(200);
      expect(getTunnelStatus).toHaveBeenCalledTimes(4);
      expect(getTunnelStatus).toHaveBeenCalledWith('l1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling before native release and reports status failures as typed transport facts', async () => {
    vi.useFakeTimers();
    try {
      const getTunnelStatus = vi.fn(async () => {
        throw Object.assign(new Error('peer disconnected'), { code: 'transport_closed' });
      });
      const native = nativeHarness({ getTunnelStatus });
      const adapter = createIrohNativeAdapter(native, { statusPollIntervalMs: 100 });
      const lease = await adapter.ensureHomeTunnel({
        homeServerIdentityId: 'srv_home_a',
        endpointId: 'endpoint-a',
        policy: 'automatic',
      });
      const events: unknown[] = [];
      adapter.subscribeEvents(lease.leaseId, (event) => events.push(event));

      await vi.advanceTimersByTimeAsync(100);
      expect(events).toEqual([
        expect.objectContaining({ type: 'error', tunnelHandle: 'l1', status: 'error', errorCode: 'transport_closed' }),
      ]);

      await adapter.releaseHomeTunnel(lease.leaseId);
      await vi.advanceTimersByTimeAsync(300);
      expect(getTunnelStatus).toHaveBeenCalledTimes(1);
      expect(native.releaseHomeTunnel).toHaveBeenCalledWith('l1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls exact tunnel handles when two leases belong to the same Home', async () => {
    vi.useFakeTimers();
    try {
      const getTunnelStatus = vi.fn(async (tunnelId: string) => ({
        active: true,
        connectionActive: true,
        observedPath: tunnelId === 'l1' ? 'direct' : 'relay',
      }));
      const native = nativeHarness({
        ensureHomeTunnel: vi.fn()
          .mockResolvedValueOnce({ ...LEASE_BASE, leaseId: 'l1' })
          .mockResolvedValueOnce({ ...LEASE_BASE, leaseId: 'l2' }),
        getTunnelStatus,
      });
      const adapter = createIrohNativeAdapter(native, { statusPollIntervalMs: 100 });
      const request = { homeServerIdentityId: 'srv_home_a', endpointId: 'endpoint-a', policy: 'automatic' as const };
      const first = await adapter.ensureHomeTunnel(request);
      const second = await adapter.ensureHomeTunnel(request);
      const events: unknown[] = [];
      adapter.subscribeEvents(first.leaseId, (event) => events.push(event));
      adapter.subscribeEvents(second.leaseId, (event) => events.push(event));

      await vi.advanceTimersByTimeAsync(100);

      expect(getTunnelStatus.mock.calls.map(([tunnelId]) => tunnelId).sort()).toEqual(['l1', 'l2']);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ tunnelHandle: 'l1', observedPath: 'direct' }),
        expect.objectContaining({ tunnelHandle: 'l2', observedPath: 'relay' }),
      ]));
      await adapter.releaseHomeTunnel(first.leaseId);
      await adapter.releaseHomeTunnel(second.leaseId);
    } finally {
      vi.useRealTimers();
    }
  });
});
