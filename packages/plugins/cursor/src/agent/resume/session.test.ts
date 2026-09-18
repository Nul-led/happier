import { describe, expect, it } from 'vitest';

import { classifyCursorSessionLoadError, resolveCursorResumeAction } from './session.js';

describe('cursor resume', () => {
  it('surfaces session/load not-found as a recoverable error', () => {
    expect(classifyCursorSessionLoadError(new Error('Session "abc" not found'))).toEqual({
      kind: 'recoverable',
      code: 'CURSOR_SESSION_NOT_FOUND',
    });
  });

  it('does not fall back to creating a new session when resume id is present', () => {
    expect(resolveCursorResumeAction({ cursorSessionId: 'session-1' })).toEqual({
      action: 'load',
      cursorSessionId: 'session-1',
    });
  });

  it('loads with the exact bytes Cursor minted', () => {
    // Cursor issued this id and `session/load` is handed it verbatim. Trimming
    // would ask Cursor for a session it never created.
    const opaqueCursorSessionId = '  provider\nses/AB+cd==  ';
    expect(resolveCursorResumeAction({ cursorSessionId: opaqueCursorSessionId })).toEqual({
      action: 'load',
      cursorSessionId: opaqueCursorSessionId,
    });
  });

  it('creates a new session for a whitespace-only resume id', () => {
    expect(resolveCursorResumeAction({ cursorSessionId: '   \n  ' })).toEqual({ action: 'new' });
  });
});
