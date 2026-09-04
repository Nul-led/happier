import { describe, expect, it, vi } from 'vitest';

import {
  acquireHomeCarrierByPolicy,
  drainRetainedHomeCarrierReleases,
} from './homeCarrierPolicy';
import { enrollmentPollingBackoffMs } from './index';

const endpointId = 'a'.repeat(64);
const descriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_a',
  canonicalServerUrl: 'http://localhost:3010',
  revision: 7,
  endpoints: [
    { kind: 'https' as const, url: 'https://ingress.example.test/path/?ignored=yes#fragment' },
    { kind: 'iroh' as const, endpointId, relayUrls: ['https://relay.example.test/'] },
  ],
};

describe('acquireHomeCarrierByPolicy', () => {
  it('selects Iroh first and accepts only the exact descriptor identity and EndpointId', async () => {
    const release = vi.fn(async () => undefined);
    const acquireIroh = vi.fn(async () => ({
      homeServerIdentityId: descriptor.homeServerIdentityId,
      endpointId,
      status: 'ready' as const,
      release,
      value: { runtimeOrigin: 'http://127.0.0.1:43123' },
    }));

    const result = await acquireHomeCarrierByPolicy({
      descriptor,
      preferredTransport: 'iroh',
      acquireIroh,
      classifyFailure: () => ({ fallbackAllowed: false }),
    });

    expect(acquireIroh).toHaveBeenCalledWith({ descriptor, endpoint: descriptor.endpoints[1] });
    expect(result).toMatchObject({
      kind: 'iroh',
      carrier: { homeServerIdentityId: 'srv_home_a', endpointId, status: 'ready' },
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('rejects a target preference that contradicts descriptor-owned Iroh-first policy', async () => {
    const acquireIroh = vi.fn();
    const result = await acquireHomeCarrierByPolicy({
      descriptor,
      preferredTransport: 'https',
      acquireIroh,
      classifyFailure: () => ({ fallbackAllowed: true }),
    });

    expect(result).toMatchObject({
      kind: 'fail_closed',
      error: { code: 'invalid_preference' },
      fallbackAllowed: false,
    });
    expect(acquireIroh).not.toHaveBeenCalled();
  });

  it.each([
    ['identity', { homeServerIdentityId: 'srv_home_b', endpointId, status: 'ready' as const }],
    ['endpoint', { homeServerIdentityId: 'srv_home_a', endpointId: 'b'.repeat(64), status: 'ready' as const }],
    ['readiness', { homeServerIdentityId: 'srv_home_a', endpointId, status: 'degraded' as const }],
  ])('fails closed and releases an acquired carrier with mismatched %s', async (_label, returned) => {
    const release = vi.fn(async () => undefined);
    const result = await acquireHomeCarrierByPolicy({
      descriptor,
      preferredTransport: 'iroh',
      acquireIroh: async () => ({ ...returned, release, value: null }),
      classifyFailure: () => ({ fallbackAllowed: true }),
    });

    expect(result).toMatchObject({ kind: 'fail_closed', fallbackAllowed: false });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('falls back only for classified availability and only to descriptor-declared HTTPS', async () => {
    const unavailable = new Error('Iroh unavailable');
    const result = await acquireHomeCarrierByPolicy({
      descriptor,
      preferredTransport: 'iroh',
      acquireIroh: async () => { throw unavailable; },
      classifyFailure: (error) => ({ fallbackAllowed: error === unavailable }),
    });

    expect(result).toEqual({ kind: 'https', runtimeOrigin: 'https://ingress.example.test/path' });
  });

  it.each(['identity', 'config', 'protocol'])('does not fall back for %s failures', async () => {
    const error = new Error('fail closed');
    await expect(acquireHomeCarrierByPolicy({
      descriptor,
      preferredTransport: 'iroh',
      acquireIroh: async () => { throw error; },
      classifyFailure: () => ({ fallbackAllowed: false }),
    })).resolves.toEqual({ kind: 'fail_closed', error, fallbackAllowed: false });
  });

  it('keeps failed release custody retryable at the explicit drain boundary', async () => {
    const release = vi.fn()
      .mockRejectedValueOnce(new Error('release failed'))
      .mockResolvedValueOnce(undefined);
    const result = await acquireHomeCarrierByPolicy({
      descriptor,
      preferredTransport: 'iroh',
      acquireIroh: async () => ({
        homeServerIdentityId: descriptor.homeServerIdentityId,
        endpointId,
        status: 'ready',
        release,
        value: null,
      }),
      classifyFailure: () => ({ fallbackAllowed: false }),
    });
    expect(result.kind).toBe('iroh');
    if (result.kind !== 'iroh') return;

    await expect(result.release()).rejects.toThrow('release failed');
    await drainRetainedHomeCarrierReleases();
    await expect(result.release()).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(2);
  });
});

describe('enrollmentPollingBackoffMs', () => {
  it('backs off bounded enrollment polling and retains bounded jitter', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect([1, 2, 3, 4, 5].map(enrollmentPollingBackoffMs)).toEqual([
        1_000,
        2_000,
        4_000,
        5_000,
        5_000,
      ]);
      random.mockReturnValue(0.999);
      expect(enrollmentPollingBackoffMs(4)).toBe(5_249);
    } finally {
      random.mockRestore();
    }
  });
});
