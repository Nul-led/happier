import { describe, expect, it } from 'vitest';

import { resolveActiveServerAuthReadiness } from './resolveActiveServerAuthReadiness';

describe('resolveActiveServerAuthReadiness', () => {
  it('does not report a locally allocated machine id as server-registered', async () => {
    const readiness = await resolveActiveServerAuthReadiness({
      readCredentialsFn: async () => ({
        token: 'valid-token',
        encryption: null,
        credentialProvenance: 'stored_session',
      }),
      readSettingsFn: async () => ({
        machineId: 'machine-local-only',
        machineIdConfirmedByServer: false,
      }) as Awaited<ReturnType<typeof import('@/persistence').readSettings>>,
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
      readSettingsFn: async () => ({
        machineId: 'machine-confirmed',
        machineIdConfirmedByServer: true,
      }) as Awaited<ReturnType<typeof import('@/persistence').readSettings>>,
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

  it('distinguishes missing, rejected, and server-confirmed readiness facts', async () => {
    const missing = await resolveActiveServerAuthReadiness({
      readCredentialsFn: async () => null,
      readSettingsFn: async () => ({
        schemaVersion: 6,
        onboardingCompleted: false,
      }),
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
      readSettingsFn: async () => ({
        machineId: 'machine-confirmed',
        machineIdConfirmedByServer: true,
      }) as Awaited<ReturnType<typeof import('@/persistence').readSettings>>,
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
