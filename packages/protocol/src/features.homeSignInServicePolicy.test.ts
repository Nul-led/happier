import { describe, expect, it } from 'vitest';

import { FeaturesResponseSchema } from './features.js';

describe('Home sign-in service feature payload', () => {
  it.each([
    { v: 1, mode: 'disabled' },
    { v: 1, mode: 'self' },
    {
      v: 1,
      mode: 'external',
      endpoint: 'https://accounts.example.test',
      expectedServerIdentityId: 'srv_accounts',
    },
  ] as const)('accepts the strict policy variant %#', (signInService) => {
    const parsed = FeaturesResponseSchema.parse({
      features: {},
      capabilities: {},
      signInService,
      accountServicePresentation: { v: 1, displayName: ' Acme ' },
    });

    expect(parsed.signInService).toEqual(signInService);
    expect(parsed.accountServicePresentation).toEqual({ v: 1, displayName: 'Acme' });
  });

  it('drops only malformed optional authority siblings', () => {
    const parsed = FeaturesResponseSchema.parse({
      features: {},
      capabilities: {},
      signInService: { v: 1, mode: 'self', endpoint: 'https://attacker.example.test' },
      accountServicePresentation: { v: 1, displayName: 'bad\nname' },
    });

    expect(parsed.signInService).toBeUndefined();
    expect(parsed.accountServicePresentation).toBeUndefined();
    expect(parsed.features.auth.login.keyChallenge.enabled).toBe(true);
  });

  it('rejects unsafe external endpoints inside the isolated sibling', () => {
    const parsed = FeaturesResponseSchema.parse({
      features: {},
      capabilities: {},
      signInService: {
        v: 1,
        mode: 'external',
        endpoint: 'https://user:secret@accounts.example.test/path?query=1',
      },
    });

    expect(parsed.signInService).toBeUndefined();
  });
});
