import { describe, expect, it } from 'vitest';

import { SUPPORTED_SCHEMA_VERSION, type Settings } from '@/persistence';

import { resolveActiveServerAuthReadiness } from './resolveActiveServerAuthReadiness';

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    onboardingCompleted: false,
    ...overrides,
  };
}

describe('resolveActiveServerAuthReadiness', () => {
  it('does not report a locally allocated machine id as server-registered', async () => {
    const readiness = await resolveActiveServerAuthReadiness({
      readCredentialsFn: async () => ({
        token: 'valid-token',
        encryption: null,
        credentialProvenance: 'stored_session',
      }),
      readSettingsFn: async () => createSettings({
        machineId: 'machine-local-only',
        machineIdConfirmedByServer: false,
      }),
      validateTokenFn: async () => ({ state: 'valid', httpStatus: 200 }),
    });

    expect(readiness).toMatchObject({
      credentialState: 'valid',
      authenticated: true,
      machineId: 'machine-local-only',
      machineRegistrationState: 'local-only',
      machineRegistered: false,
    });
  });

  it('does not report stored credentials as authenticated when server validation is inconclusive', async () => {
    const readiness = await resolveActiveServerAuthReadiness({
      readCredentialsFn: async () => ({
        token: 'stored-token',
        encryption: null,
        credentialProvenance: 'stored_session',
      }),
      readSettingsFn: async () => createSettings({
        machineId: 'machine-confirmed',
        machineIdConfirmedByServer: true,
      }),
      validateTokenFn: async () => ({
        state: 'unknown',
        httpStatus: null,
        reasonCode: 'TimeoutError',
      }),
    });

    expect(readiness).toMatchObject({
      credentials: expect.objectContaining({ token: 'stored-token' }),
      credentialState: 'unknown',
      authenticated: false,
      unusableReason: null,
      machineId: 'machine-confirmed',
      machineRegistrationState: 'server-confirmed',
      machineRegistered: true,
    });
  });

  it('passes caller cancellation to the canonical stored-credential validator', async () => {
    const caller = new AbortController();
    const observed: AbortSignal[] = [];

    await resolveActiveServerAuthReadiness({
      readCredentialsFn: async () => ({
        token: 'stored-token',
        encryption: null,
        credentialProvenance: 'stored_session',
      }),
      readSettingsFn: async () => createSettings({ machineId: undefined }),
      signal: caller.signal,
      validateTokenFn: async (_token, signal) => {
        if (signal) observed.push(signal);
        return { state: 'unknown', httpStatus: null, reasonCode: 'fixture' };
      },
    });

    expect(observed).toEqual([caller.signal]);
  });

  it('distinguishes missing, rejected, and server-confirmed readiness facts', async () => {
    const missing = await resolveActiveServerAuthReadiness({
      readCredentialsFn: async () => null,
      readSettingsFn: async () => createSettings(),
    });
    expect(missing).toMatchObject({
      credentialState: 'missing',
      machineRegistrationState: 'no-local-id',
      authenticated: false,
      machineRegistered: false,
    });

    const rejected = await resolveActiveServerAuthReadiness({
      readCredentialsFn: async () => ({
        token: 'rejected-token',
        encryption: null,
        credentialProvenance: 'stored_session',
      }),
      readSettingsFn: async () => createSettings({
        machineId: 'machine-confirmed',
        machineIdConfirmedByServer: true,
      }),
      validateTokenFn: async () => ({
        state: 'invalid',
        httpStatus: 401,
        reasonCode: 'not_authenticated',
      }),
    });
    expect(rejected).toMatchObject({
      credentialState: 'invalid',
      authenticated: false,
      unusableReason: 'credentials-rejected',
      machineRegistrationState: 'server-confirmed',
      machineRegistered: true,
    });
  });
});
