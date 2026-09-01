import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeaturesResponseSchema } from '@happier-dev/protocol';

import type { CliServerFeaturesSnapshot } from './serverFeaturesClient';
import {
  createServerFeaturesSnapshotStore,
  createServerUrlServerFeaturesSnapshotStore,
} from './serverFeaturesSnapshotStore';

function ready(features: Record<string, unknown>): Extract<CliServerFeaturesSnapshot, { status: 'ready' }> {
  return { status: 'ready', features: FeaturesResponseSchema.parse({ features }) };
}

const READY_ENABLED = ready({ localServices: { enabled: true } });
const READY_DISABLED = ready({ localServices: { enabled: false } });

describe('createServerFeaturesSnapshotStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined before the first refresh (cold daemon)', () => {
    const store = createServerFeaturesSnapshotStore({
      fetchSnapshot: async () => READY_ENABLED,
    });
    expect(store.getSnapshot()).toBeUndefined();
  });

  it('caches the ready snapshot after refresh and exposes it synchronously', async () => {
    const onReady = vi.fn(async () => undefined);
    const store = createServerFeaturesSnapshotStore({
      fetchSnapshot: async () => READY_ENABLED,
      onReady,
    });
    await store.refresh();
    expect(store.getSnapshot()).toEqual(READY_ENABLED);
    expect(onReady).toHaveBeenCalledWith(READY_ENABLED.features);
  });

  it('reflects a server-disabled ready snapshot (fail-closed source of truth)', async () => {
    const store = createServerFeaturesSnapshotStore({
      fetchSnapshot: async () => READY_DISABLED,
    });
    await store.refresh();
    expect(store.getSnapshot()).toEqual(READY_DISABLED);
  });

  it('retains the last-known-good ready snapshot across a transient error', async () => {
    const fetchSnapshot = vi
      .fn<() => Promise<CliServerFeaturesSnapshot>>()
      .mockResolvedValueOnce(READY_ENABLED)
      .mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    const store = createServerFeaturesSnapshotStore({ fetchSnapshot });

    await store.refresh();
    await store.refresh();

    // The transient error must NOT flip the cached enabled snapshot to a server-error state.
    expect(store.getSnapshot()).toEqual(READY_ENABLED);
  });

  it('records the first result on a cold cache even when it is an error', async () => {
    const store = createServerFeaturesSnapshotStore({
      fetchSnapshot: async () => ({ status: 'error', reason: 'network' }),
    });
    await store.refresh();
    expect(store.getSnapshot()).toEqual({ status: 'error', reason: 'network' });
  });

  it('shares a single in-flight fetch across concurrent refreshes', async () => {
    const fetchSnapshot = vi.fn(async () => READY_ENABLED);
    const store = createServerFeaturesSnapshotStore({ fetchSnapshot });

    await Promise.all([store.refresh(), store.refresh(), store.refresh()]);

    expect(fetchSnapshot).toHaveBeenCalledOnce();
  });

  it('reports fetch failures through onError without throwing', async () => {
    const onError = vi.fn();
    const store = createServerFeaturesSnapshotStore({
      fetchSnapshot: async () => {
        throw new Error('boom');
      },
      onError,
    });

    await expect(store.refresh()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toBeUndefined();
  });

  it('resolves the current runtime destination again after a Home tunnel replacement', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ features: {}, capabilities: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    let runtimeOrigin = 'http://127.0.0.1:41001';
    const store = createServerUrlServerFeaturesSnapshotStore({
      serverUrl: () => runtimeOrigin,
    });

    await store.refresh();
    runtimeOrigin = 'http://127.0.0.1:41002';
    await store.refresh();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:41001/v1/features',
      'http://127.0.0.1:41002/v1/features',
    ]);
  });
});
