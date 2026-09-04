import { describe, expect, it } from 'vitest';

import { isSessionBoundMemoryTarget } from './sessionBoundMemoryTarget';

describe('isSessionBoundMemoryTarget', () => {
  it('admits only the exact Session bound to the credentialless MCP server', () => {
    expect(isSessionBoundMemoryTarget({
      boundSessionId: 'bound-session',
      requestedSessionId: 'bound-session',
    })).toBe(true);
    expect(isSessionBoundMemoryTarget({
      boundSessionId: 'bound-session',
      requestedSessionId: 'other-session',
    })).toBe(false);
    expect(isSessionBoundMemoryTarget({
      boundSessionId: 'bound-session',
      requestedSessionId: '',
    })).toBe(false);
  });
});
