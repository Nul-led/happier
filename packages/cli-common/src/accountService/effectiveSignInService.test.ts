import { describe, expect, it } from 'vitest';

import { resolveEffectiveSignInService } from './index.js';

const target = { kind: 'https_url', url: 'https://home.example.test' } as const;

describe('resolveEffectiveSignInService', () => {
  it('uses only the targeted Home policy and fails closed when absent or disabled', () => {
    expect(resolveEffectiveSignInService({
      targetContext: { kind: 'home', target },
      deviceSelection: { endpoint: 'https://saved.example.test' },
      builtInNoTargetDefault: { endpoint: 'https://api.happier.dev' },
    })).toEqual({ kind: 'not_offered' });
    expect(resolveEffectiveSignInService({
      targetContext: { kind: 'home', target, policy: { v: 1, mode: 'disabled' } },
    })).toEqual({ kind: 'not_offered' });
  });

  it('retains the exact target for self and the identity pin for external', () => {
    expect(resolveEffectiveSignInService({
      targetContext: { kind: 'home', target, policy: { v: 1, mode: 'self' } },
    })).toEqual({ kind: 'self', target });
    expect(resolveEffectiveSignInService({
      targetContext: {
        kind: 'home',
        target,
        policy: {
          v: 1,
          mode: 'external',
          endpoint: 'https://accounts.example.test',
          expectedServerIdentityId: 'srv_accounts',
        },
      },
    })).toEqual({
      kind: 'external',
      endpoint: 'https://accounts.example.test',
      expectedServerIdentityId: 'srv_accounts',
    });
  });

  it('uses device selection before the built-in default only without a Home target', () => {
    expect(resolveEffectiveSignInService({
      targetContext: { kind: 'none' },
      deviceSelection: { endpoint: 'https://saved.example.test', expectedServerIdentityId: 'srv_saved' },
      builtInNoTargetDefault: { endpoint: 'https://api.happier.dev' },
    })).toEqual({
      kind: 'no_target_default',
      endpoint: 'https://saved.example.test',
      expectedServerIdentityId: 'srv_saved',
    });
  });
});
