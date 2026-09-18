import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { VerifiedEphemeralSessionRunnerPrincipalSchema } from '@happier-dev/protocol/ephemeralRunner/principal';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import tweetnacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';

import { createEphemeralRunnerRestrictedRpcAdmission } from './restrictedTransportAdmission';

const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
  kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'creator',
  activationId: '00000000-0000-4000-8000-000000000013', sessionId: 'session-13', machineId: 'machine-13',
  installationId: 'installation-13',
  installationPublicKey: encodeBase64(tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(3)).publicKey, 'base64url'),
  creatorTokenEpoch: 2,
});

describe('ephemeral Runner restricted transport admission', () => {
  const admission = createEphemeralRunnerRestrictedRpcAdmission({
    principal,
  });

  it('admits only registered exact-Session RPC and rejects arbitrary methods, resource mismatch and caller authority', async () => {
    await expect(admission.authorizeRpc({
      method: `machine-13:${RPC_METHODS.READ_FILE}`,
      params: { sessionId: 'session-13', path: 'README.md' },
      authorization: { kind: 'session.write', sessionId: 'session-13' },
    })).resolves.toEqual({ ok: true });

    const deniedRequests: Array<Parameters<typeof admission.authorizeRpc>[0]> = [
      { method: 'machine-13:machine.admin.list', params: {}, authorization: { kind: 'session.write', sessionId: 'session-13' } },
      { method: `other:${RPC_METHODS.READ_FILE}`, params: { sessionId: 'session-13' }, authorization: { kind: 'session.write', sessionId: 'session-13' } },
      { method: `machine-13:${RPC_METHODS.READ_FILE}`, params: { sessionId: 'other' }, authorization: { kind: 'session.write', sessionId: 'session-13' } },
      { method: `machine-13:${RPC_METHODS.READ_FILE}`, params: { sessionId: 'session-13', machineId: 'other' }, authorization: { kind: 'session.write', sessionId: 'session-13' } },
      { method: `machine-13:${RPC_METHODS.READ_FILE}`, params: { sessionId: 'session-13', authority: 'admin' }, authorization: { kind: 'session.write', sessionId: 'session-13' } },
      {
        method: `machine-13:${RPC_METHODS.READ_FILE}`,
        params: { sessionId: 'session-13' },
        // Deliberately malformed boundary input: callers cannot add Account authority.
        authorization: { kind: 'session.write', sessionId: 'session-13', accountId: 'creator' } as never,
      },
    ];
    for (const request of deniedRequests) {
      await expect(admission.authorizeRpc(request)).resolves.toMatchObject({ ok: false });
    }
  });
});
