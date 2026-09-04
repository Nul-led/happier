import { describe, expect, it, vi } from 'vitest';

import type { FeaturesResponse, HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

import {
  DirectHomeQrCompletionError,
  admitDirectHomeQrV2,
  startDirectHomeQrLifecycle,
  type DirectHomeQrLifecycleAdapters,
  type DirectHomeQrPairingStatus,
} from './directHomeQrLifecycle.js';

const NOW = 1_900_000_000_000;
const DESCRIPTOR: HomeConnectionDescriptorV1 = {
  v: 1,
  homeServerIdentityId: 'srv_home',
  canonicalServerUrl: 'https://home.example',
  revision: 1,
  endpoints: [{ kind: 'https', url: 'https://home.example' }],
};

function features(boundQrV2: unknown): FeaturesResponse {
  return {
    features: {
      auth: {
        pairing: {
          boundQrV2: { enabled: boundQrV2 },
        },
      },
    },
  } as FeaturesResponse;
}

function requested(overrides: Partial<Extract<DirectHomeQrPairingStatus, { state: 'requested' }>> = {}) {
  return {
    state: 'requested' as const,
    pairId: 'pair-1',
    expiresAt: new Date(NOW + 60_000).toISOString(),
    requestedPublicKey: 'requester-key',
    requestedDeviceLabel: 'Phone',
    bindingProof: 'binding-proof',
    homeServerIdentityId: DESCRIPTOR.homeServerIdentityId,
    ...overrides,
  };
}

function harness(input: Readonly<{
  status?: readonly DirectHomeQrPairingStatus[];
  qrAvailable?: boolean;
  nowValues?: readonly number[];
  poll?: DirectHomeQrLifecycleAdapters['poll'];
  consume?: DirectHomeQrLifecycleAdapters['consume'];
  complete?: DirectHomeQrLifecycleAdapters['complete'];
}> = {}) {
  const statuses = [...(input.status ?? [requested()])];
  const nowValues = [...(input.nowValues ?? [NOW, NOW, NOW])];
  const start = vi.fn(async () => ({ ok: true as const, pairId: 'pair-1', expiresAt: new Date(NOW + 60_000).toISOString() }));
  const poll = vi.fn(input.poll ?? (async () => ({ ok: true as const, status: statuses.shift() ?? requested() })));
  const consume = vi.fn(input.consume ?? (async () => ({ ok: true as const })));
  const complete = vi.fn(input.complete ?? (async () => 'completed' as const));
  const close = vi.fn(async () => undefined);
  const sleep = vi.fn(async () => undefined);
  const adapters: DirectHomeQrLifecycleAdapters = {
    randomBytes: () => new Uint8Array(32).fill(7),
    now: () => nowValues.shift() ?? NOW,
    start,
    poll,
    consume,
    complete,
    buildRenderableInvite: (invite) => input.qrAvailable === false
      ? { ok: false, link: 'happier:///pair?v=2&payload=opaque', reason: 'qr_unavailable' }
      : { ok: true, link: 'happier:///pair?v=2&payload=opaque', invite },
    sleep,
    close,
  };
  return { adapters, start, poll, consume, complete, close, sleep };
}

describe('direct Home QR lifecycle', () => {
  it.each([
    ['missing', features(undefined)],
    ['malformed', features('yes')],
    ['disabled preview', features(false)],
  ])('refuses %s bound-qr-v2 admission before QR mutation', async (_label, payload) => {
    const h = harness();

    expect(admitDirectHomeQrV2(payload)).toEqual({ kind: 'update_required' });
    const result = await startDirectHomeQrLifecycle({
      features: payload,
      descriptor: DESCRIPTOR,
      adapters: h.adapters,
    });

    expect(result).toEqual({ kind: 'update_required' });
    expect(h.start).not.toHaveBeenCalled();
    expect(h.poll).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.consume).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it('runs the bound forward V2 lifecycle to completion and releases the target', async () => {
    const h = harness();
    const result = await startDirectHomeQrLifecycle({ features: features(true), descriptor: DESCRIPTOR, adapters: h.adapters });

    expect(result.kind).toBe('started');
    if (result.kind !== 'started') throw new Error('expected started lifecycle');
    expect(result.invite).toMatchObject({ v: 2, intent: 'home_device', direction: 'trusted_home_displays' });
    expect(result.qrAvailable).toBe(true);
    await expect(result.completion).resolves.toEqual({ kind: 'completed', requestedDeviceLabel: 'Phone' });
    expect(h.start).toHaveBeenCalledWith(expect.objectContaining({ direction: 'trusted_home_displays' }));
    expect(h.complete).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ direction: 'trusted_home_displays' }),
    }));
    expect(h.close).toHaveBeenCalledOnce();
  });

  it('keeps an oversize valid invite live as an exact copied-link presentation', async () => {
    const h = harness({ qrAvailable: false });
    const result = await startDirectHomeQrLifecycle({ features: features(true), descriptor: DESCRIPTOR, adapters: h.adapters });

    expect(result.kind).toBe('started');
    if (result.kind !== 'started') throw new Error('expected started lifecycle');
    expect(result).toMatchObject({ qrAvailable: false, link: 'happier:///pair?v=2&payload=opaque' });
    await expect(result.completion).resolves.toMatchObject({ kind: 'completed' });
  });

  it('cancels the exact live session without completing credentials', async () => {
    let pollStarted!: () => void;
    const startedPolling = new Promise<void>((resolve) => { pollStarted = resolve; });
    const h = harness({
      status: [{ state: 'pending', pairId: 'pair-1', expiresAt: new Date(NOW + 60_000).toISOString() }],
      nowValues: [NOW, NOW, NOW, NOW + 59_999],
      poll: async ({ signal }) => {
        pollStarted();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
        });
        throw new Error('unreachable');
      },
      consume: async ({ signal, timeoutMs }) => {
        expect(timeoutMs).toBe(1);
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), { once: true });
        });
        throw new Error('unreachable');
      },
    });
    const result = await startDirectHomeQrLifecycle({ features: features(true), descriptor: DESCRIPTOR, adapters: h.adapters });
    if (result.kind !== 'started') throw new Error('expected started lifecycle');

    await startedPolling;
    await result.cancel();
    await expect(result.completion).resolves.toEqual({ kind: 'cancelled' });
    expect(h.consume).toHaveBeenCalledWith(expect.objectContaining({ pairId: 'pair-1', intent: 'cancel' }));
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it('bounds each poll by the owner-derived expiry deadline', async () => {
    const h = harness({
      nowValues: [NOW, NOW, NOW, NOW + 60_000],
      poll: async ({ timeoutMs }) => {
        expect(timeoutMs).toBe(60_000);
        return { ok: false, reason: 'transient', status: 408 };
      },
    });
    const result = await startDirectHomeQrLifecycle({ features: features(true), descriptor: DESCRIPTOR, adapters: h.adapters });
    if (result.kind !== 'started') throw new Error('expected started lifecycle');

    await expect(result.completion).resolves.toEqual({ kind: 'expired' });
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('expires at the bounded invite deadline without completing credentials', async () => {
    const h = harness({
      status: [{ state: 'pending', pairId: 'pair-1', expiresAt: new Date(NOW + 60_000).toISOString() }],
      nowValues: [NOW, NOW, NOW, NOW + 60_000],
    });
    const result = await startDirectHomeQrLifecycle({ features: features(true), descriptor: DESCRIPTOR, adapters: h.adapters });
    if (result.kind !== 'started') throw new Error('expected started lifecycle');

    await expect(result.completion).resolves.toEqual({ kind: 'expired' });
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it('rejects an invalid bound request and never enters terminal-pairing semantics', async () => {
    const h = harness({ complete: async () => { throw new DirectHomeQrCompletionError('invalid'); } });
    const result = await startDirectHomeQrLifecycle({ features: features(true), descriptor: DESCRIPTOR, adapters: h.adapters });
    if (result.kind !== 'started') throw new Error('expected started lifecycle');

    await expect(result.completion).resolves.toEqual({ kind: 'invalid_request' });
    expect(h.consume).toHaveBeenCalledWith(expect.objectContaining({ pairId: 'pair-1', intent: 'reject' }));
    expect(h.start).not.toHaveBeenCalledWith(expect.objectContaining({ direction: 'requester_displays' }));
  });
});
