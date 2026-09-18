import { describe, expect, it } from 'vitest';

import {
  readOpenCodeProviderSessionIdFromMetadata,
  writeOpenCodeProviderSessionIdMetadata,
} from './session.js';

describe('OpenCode provider session metadata', () => {
  // OpenCode minted these ids and Happier hands them back to OpenCode, so
  // surrounding whitespace is part of the identity on both the read and the
  // write side; presence is the only judgement. See
  // `src/protocol/opaqueIdentifier.ts`.
  it('reads legacy provider session metadata without renormalizing its bytes', () => {
    expect(readOpenCodeProviderSessionIdFromMetadata({
      opencodeSessionId: '  oc-session  ',
    })).toBe('  oc-session  ');
  });

  it('reads no identity from an all-whitespace provider session id', () => {
    expect(readOpenCodeProviderSessionIdFromMetadata({
      opencodeSessionId: '   ',
    })).toBeNull();
  });

  it('writes provider session metadata through the canonical helper', () => {
    expect(writeOpenCodeProviderSessionIdMetadata(' oc-session ')).toEqual({
      opencodeSessionId: ' oc-session ',
    });
    expect(writeOpenCodeProviderSessionIdMetadata('   ')).toEqual({});
  });
});
