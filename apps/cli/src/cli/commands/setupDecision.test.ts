import { describe, expect, it } from 'vitest';

import { decideSetupReadiness } from './setupDecision';

describe('decideSetupReadiness', () => {
  it('keeps an unavailable configured Home instead of treating it as a sign-in or selection request', () => {
    expect(decideSetupReadiness({
      credentialState: 'unknown',
      machineRegistrationState: 'server-confirmed',
      hasExplicitTarget: false,
    })).toEqual({ kind: 'home-unavailable' });
  });

  it('retains a valid Home and repairs only missing machine registration', () => {
    expect(decideSetupReadiness({
      credentialState: 'valid',
      machineRegistrationState: 'local-only',
      hasExplicitTarget: false,
    })).toEqual({ kind: 'authenticate', reason: 'register-machine' });
    expect(decideSetupReadiness({
      credentialState: 'valid',
      machineRegistrationState: 'server-confirmed',
      hasExplicitTarget: false,
    })).toEqual({ kind: 'ready' });
  });

  it('asks for Home selection only when credentials are absent or rejected and no target was explicit', () => {
    expect(decideSetupReadiness({
      credentialState: 'missing',
      machineRegistrationState: 'no-local-id',
      hasExplicitTarget: false,
    })).toEqual({ kind: 'select-home' });
    expect(decideSetupReadiness({
      credentialState: 'invalid',
      machineRegistrationState: 'server-confirmed',
      hasExplicitTarget: true,
    })).toEqual({ kind: 'authenticate', reason: 'sign-in' });
  });
});
