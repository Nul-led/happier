import { describe, expect, it } from 'vitest';

import { createSessionFollowSourceMaterialResolver } from './sessionFollowSourceMaterialResolver';

describe('createSessionFollowSourceMaterialResolver', () => {
  it('supports late source keys and same-process reconnect without retaining revoked material', () => {
    const material = createSessionFollowSourceMaterialResolver();
    const signal = new AbortController().signal;

    expect(material.resolveForHydration({ sourceSessionId: 'late-source', signal })).toEqual({ mode: 'unavailable' });

    const original = new Uint8Array(32).fill(7);
    expect(material.installPreparedDataKey({ sourceSessionId: 'late-source', dataKey: original })).toBe('installed');
    original.fill(99);
    expect(material.resolveForHydration({ sourceSessionId: 'late-source', signal })).toEqual({
      mode: 'e2ee',
      dataKey: new Uint8Array(32).fill(7),
    });

    expect(material.installPreparedDataKey({
      sourceSessionId: 'late-source',
      dataKey: new Uint8Array(32).fill(8),
    })).toBe('installed');
    expect(material.resolveForHydration({ sourceSessionId: 'late-source', signal })).toEqual({
      mode: 'e2ee',
      dataKey: new Uint8Array(32).fill(8),
    });

    material.removeSource('late-source');
    expect(material.resolveForHydration({ sourceSessionId: 'late-source', signal })).toEqual({ mode: 'unavailable' });
  });

  it('clears every installed source on terminal cleanup', () => {
    const material = createSessionFollowSourceMaterialResolver();
    material.installPreparedDataKey({ sourceSessionId: 'source-a', dataKey: new Uint8Array(32).fill(1) });
    material.installPreparedDataKey({ sourceSessionId: 'source-b', dataKey: new Uint8Array(32).fill(2) });

    material.dispose();

    const signal = new AbortController().signal;
    expect(material.resolveForHydration({ sourceSessionId: 'source-a', signal })).toEqual({ mode: 'unavailable' });
    expect(material.resolveForHydration({ sourceSessionId: 'source-b', signal })).toEqual({ mode: 'unavailable' });
  });

  it('drops keys for sources omitted by the current authorized edge projection', () => {
    const material = createSessionFollowSourceMaterialResolver();
    material.installPreparedDataKey({ sourceSessionId: 'current', dataKey: new Uint8Array(32).fill(1) });
    material.installPreparedDataKey({ sourceSessionId: 'revoked', dataKey: new Uint8Array(32).fill(2) });

    material.retainSources(['current']);

    const signal = new AbortController().signal;
    expect(material.resolveForHydration({ sourceSessionId: 'current', signal })).toMatchObject({ mode: 'e2ee' });
    expect(material.resolveForHydration({ sourceSessionId: 'revoked', signal })).toEqual({ mode: 'unavailable' });
  });

  it('rejects malformed key material', () => {
    const material = createSessionFollowSourceMaterialResolver();
    expect(() => material.installPreparedDataKey({
      sourceSessionId: 'source-a',
      dataKey: new Uint8Array(31),
    })).toThrow('session_follow_source_data_key_invalid');
  });

  it('zeroes copies returned for hydration without deleting retained reconnect material', () => {
    const material = createSessionFollowSourceMaterialResolver();
    material.installPreparedDataKey({ sourceSessionId: 'source-a', dataKey: new Uint8Array(32).fill(7) });
    const resolved = material.resolveForHydration({
      sourceSessionId: 'source-a',
      signal: new AbortController().signal,
    });
    expect(resolved.mode).toBe('e2ee');
    if (resolved.mode !== 'e2ee') throw new Error('expected prepared material');

    resolved.dataKey.fill(0);

    expect(material.resolveForHydration({
      sourceSessionId: 'source-a',
      signal: new AbortController().signal,
    })).toEqual({ mode: 'e2ee', dataKey: new Uint8Array(32).fill(7) });
  });
});
