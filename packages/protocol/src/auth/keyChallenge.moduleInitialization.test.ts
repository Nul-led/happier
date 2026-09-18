import { describe, expect, it } from 'vitest';

describe('auth/keyChallenge module initialization', () => {
  it('initializes the Team invitation admission schema from the direct auth entry point', async () => {
    const { KeyChallengeAuthRequestSchema } = await import('./keyChallenge.js');
    const request = {
      challengeId: 'challenge-123',
      publicKey: 'signing-public-key',
      signature: 'signature',
      admission: {
        kind: 'team_invitation',
        token: 'A'.repeat(43),
      },
    } as const;

    expect(KeyChallengeAuthRequestSchema.parse(request)).toEqual(request);
  });
});
