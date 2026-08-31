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
      authenticated: true,
      machineId: 'machine-local-only',
      machineRegistered: false,
    });
  });
});
