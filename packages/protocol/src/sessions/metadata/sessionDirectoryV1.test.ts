import { describe, expect, it } from 'vitest';
import { readSessionDirectoryKind } from '@happier-dev/protocol/sessions/metadata/directory';

describe('session directory classification', () => {
  it('classifies only a strict managed marker and keeps predecessor metadata path based', () => {
    const read = readSessionDirectoryKind;
    expect(read({ path: '/Users/alice/project', machineId: 'machine-1' })).toBe('path');
    expect(read({ path: '/private/allocation', sessionDirectoryV1: { v: 1, kind: 'managed' } })).toBe('managed');
    for (const marker of [null, { v: 2, kind: 'managed' }, { v: 1, kind: 'managed', path: '/fake' }, { v: 1, kind: 'path' }]) {
      expect(read({ sessionDirectoryV1: marker })).toBe('path');
    }
    expect(read(null)).toBe('path');
  });
});
