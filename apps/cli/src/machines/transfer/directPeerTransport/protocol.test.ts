import { describe, expect, it } from 'vitest';

import { readDirectPeerAuthorizationToken } from './protocol';

describe('readDirectPeerAuthorizationToken', () => {
  it('accepts exactly one canonical Bearer token and rejects trailing fields', () => {
    expect(readDirectPeerAuthorizationToken('Bearer valid')).toBe('valid');
    expect(readDirectPeerAuthorizationToken('Bearer valid trailing')).toBeNull();
    expect(readDirectPeerAuthorizationToken('Bearer\tvalid')).toBeNull();
    expect(readDirectPeerAuthorizationToken('bearer valid')).toBeNull();
  });
});
