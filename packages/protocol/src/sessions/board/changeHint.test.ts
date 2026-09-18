import { describe, expect, it } from 'vitest';
import { SessionSurfacesChangeHintV1Schema } from './changeHint.js';

describe('Session surface change hint', () => {
  it('admits only the versioned content-free invalidation signal', () => {
    expect(SessionSurfacesChangeHintV1Schema.parse({ v: 1, sessionSurfaces: true }))
      .toEqual({ v: 1, sessionSurfaces: true });
    for (const hint of [
      { v: 1, sessionSurfaces: false },
      { v: 2, sessionSurfaces: true },
      { v: 1, sessionSurfaces: true, content: 'private content' },
    ]) expect(SessionSurfacesChangeHintV1Schema.safeParse(hint).success).toBe(false);
  });
});
