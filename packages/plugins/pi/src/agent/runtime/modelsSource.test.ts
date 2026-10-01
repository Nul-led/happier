import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPiSessionModelsSource } from './modelsSource.js';

describe('createPiSessionModelsSource', () => {
  afterEach(() => vi.restoreAllMocks());
  it('does not publish a startup snapshot as a discovered catalog while refreshing current state', async () => {
    const source = createPiSessionModelsSource({
      readState: async () => ({ model: { provider: 'openai', id: 'current' }, thinkingLevel: 'high' }),
      onError: () => undefined,
    });
    await source.refresh();
    expect(source.read()).toEqual({ models: null, currentModelId: 'openai/current' });
    source.dispose();
  });

  it('replaces a successful catalog with empty membership but retains it on malformed observation', async () => {
    const errors: unknown[] = [];
    const source = createPiSessionModelsSource({
      readState: async () => ({ model: { provider: 'example', id: 'current' } }),
      onError: (error) => { errors.push(error); },
    });
    expect(source.read().models).toBeNull();
    await source.refresh();
    source.observeCatalog({ models: [{ provider: 'example', id: 'old' }] });
    const previous = source.read();
    source.observeCatalog({ models: [{}] });
    expect(source.read()).toEqual(previous);
    expect.soft(errors).toHaveLength(1);
    source.observeCatalog({ models: [] });
    expect(source.read()).toMatchObject({ models: [], currentModelId: 'example/current', observedAt: expect.any(Number) });
    source.dispose();
  });

  it('publishes refreshed runtime model state and retains the last good snapshot on failure', async () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const readState = vi.fn(async () => ({
      model: { provider: 'openai', id: 'gpt-4o-mini' },
      thinkingLevel: 'high',
    }));
    const onError = vi.fn();
    const source = createPiSessionModelsSource({ readState, onError });
    const observed: unknown[] = [];
    source.subscribe((snapshot) => observed.push(snapshot));

    source.observeCatalog({ models: [{ provider: 'openai', id: 'gpt-4o-mini', reasoning: true }] });
    const observedAt = source.read().observedAt;
    now = 200;
    await source.refresh();
    expect(source.read().observedAt).toBe(100);
    expect(source.read()).toMatchObject({
      currentModelId: 'openai/gpt-4o-mini',
      models: [{ id: 'openai/gpt-4o-mini' }],
    });
    expect(observed).toHaveLength(3);

    source.observeCatalog({ error: 'refresh-failed' });
    expect(source.read().observedAt).toBe(observedAt);
    readState.mockRejectedValueOnce(new Error('Pi unavailable'));
    await expect(source.refresh()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Pi unavailable' }));
    expect(source.read()).toMatchObject({ currentModelId: 'openai/gpt-4o-mini' });
    expect(observed).toHaveLength(3);
  });
});
