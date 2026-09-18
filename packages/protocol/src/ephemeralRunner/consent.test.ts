import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '../crypto/base64.js';
import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import { signMachineInstallationProof } from '../machines/identity/installationIdentity.js';
import { signRunnerClaimV1, type RunnerClaimPayloadV1 } from './endpoint.js';
import { verifyRunnerConsentV1 } from './consent.js';

describe('Runner consent verification', () => {
  it('requires both keys to consent to the same reviewed commitment and exact authenticated claim', () => {
    const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(11));
    const installationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(12));
    const claimPayload = {
      v: 1,
      purpose: 'happier.ephemeral-session-runner.claim',
      binding: {
        activationId: '00000000-0000-4000-8000-000000000011',
        homeServerIdentityId: 'srv_consent_test',
        creatorAccountId: 'creator',
        creatorTokenEpoch: 2,
        activationExpiresAt: null,
        workspace: { kind: 'choose_on_endpoint' as const },
        sessionId: 'session',
        machineId: 'machine',
        authoringCommitment: encodeBase64(new Uint8Array(32).fill(4), 'base64url'),
        activationSigningPublicKey: encodeBase64(activationKey.publicKey, 'base64url'),
        artifact: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'a'.repeat(64) },
        endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator' },
      },
      runnerBoxPublicKey: encodeBase64(tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(13)).publicKey, 'base64url'),
      installation: {
        installationId: 'installation',
        publicKey: encodeBase64(installationKey.publicKey, 'base64url'),
        proof: signMachineInstallationProof({
          payload: { version: 1, installationId: 'installation', machineId: 'machine', accountId: 'creator' },
          privateKey: installationKey.secretKey,
        }),
      },
      protocolEpoch: 1,
    } satisfies RunnerClaimPayloadV1;
    const claim = signRunnerClaimV1({ payload: claimPayload, activationSecretKey: activationKey.secretKey });
    const payload = {
      v: 1,
      purpose: 'happier.ephemeral-session-runner.consent',
      allow: true,
      claim: claim.payload,
      launchManifestCommitment: encodeBase64(new Uint8Array(32).fill(21), 'base64url'),
    };
    function sign(value: unknown, secretKey: Uint8Array) {
      return encodeBase64(tweetnacl.sign.detached(
        new TextEncoder().encode(createCanonicalJsonSigningInput(value)), secretKey,
      ), 'base64url');
    }
    const consent = {
      payload,
      activationSignature: sign(payload, activationKey.secretKey),
      installationSignature: sign(payload, installationKey.secretKey),
    };
    const expected = {
      claim,
      expectedBinding: claim.payload.binding,
      expectedLaunchManifestCommitment: payload.launchManifestCommitment,
    };
    expect(verifyRunnerConsentV1({ consent, ...expected })).toEqual(consent);

    const changedCommitment = encodeBase64(new Uint8Array(32).fill(22), 'base64url');
    expect(verifyRunnerConsentV1({ consent, ...expected, expectedLaunchManifestCommitment: changedCommitment })).toBeNull();
    for (const changedPayload of [
      { ...payload, allow: false },
      { ...payload, unknown: true },
      { ...payload, purpose: 'happier.ephemeral-session-runner.projection' },
      { ...payload, launchManifestCommitment: changedCommitment },
      { ...payload, claim: { ...claim.payload, binding: { ...claim.payload.binding, machineId: 'another-machine' } } },
    ]) {
      expect(verifyRunnerConsentV1({
        ...expected,
        consent: {
          payload: changedPayload,
          activationSignature: sign(changedPayload, activationKey.secretKey),
          installationSignature: sign(changedPayload, installationKey.secretKey),
        },
      })).toBeNull();
    }
    expect(verifyRunnerConsentV1({ ...expected, consent: { ...consent, installationSignature: consent.activationSignature } })).toBeNull();
    expect(verifyRunnerConsentV1({ ...expected, consent: { ...consent, activationSignature: consent.installationSignature } })).toBeNull();
    expect(verifyRunnerConsentV1({ ...expected, consent: { ...consent, installationSignature: `${consent.installationSignature}=` } })).toBeNull();
  });
});
