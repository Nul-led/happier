import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '../crypto/base64.js';
import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import { openBoxBundleWithSecretKey, sealBoxBundle } from '../crypto/boxBundle.js';
import { signAccountContentKeyBindingV1 } from '../crypto/accountContentKeyBindingV1.js';
import { computeContentPublicKeyFingerprint, signMachineInstallationProof } from '../machines/identity/installationIdentity.js';
import { RunnerClaimPayloadV1Schema, RunnerEndpointFactsContentV1Schema, RunnerEndpointFactsStoredContentV1Schema, signRunnerEndpointFactsV1, verifyRunnerClaimV1, verifyRunnerEndpointFactsV1 } from './endpoint.js';

function claimFixture() {
  const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(1));
  const installationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(2));
  const boxKey = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(3));
  const binding = {
    activationId: '00000000-0000-4000-8000-000000000001',
    homeServerIdentityId: 'srv_runner_claim_test',
    creatorAccountId: 'creator-account',
    creatorTokenEpoch: 3,
    activationExpiresAt: null,
    workspace: { kind: 'choose_on_endpoint' as const },
    sessionId: 'reserved-session',
    machineId: 'reserved-machine',
    authoringCommitment: encodeBase64(new Uint8Array(32).fill(4), 'base64url'),
    activationSigningPublicKey: encodeBase64(activationKey.publicKey, 'base64url'),
    artifact: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'a'.repeat(64) },
    endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator-account' },
  };
  const payload = {
    v: 1,
    purpose: 'happier.ephemeral-session-runner.claim',
    binding,
    runnerBoxPublicKey: encodeBase64(boxKey.publicKey, 'base64url'),
    installation: {
      installationId: 'runner-installation',
      publicKey: encodeBase64(installationKey.publicKey, 'base64url'),
      proof: signMachineInstallationProof({
        payload: { version: 1, installationId: 'runner-installation', machineId: binding.machineId, accountId: binding.creatorAccountId },
        privateKey: installationKey.secretKey,
      }),
    },
    protocolEpoch: 1,
  };
  function sign(value: unknown) {
    return encodeBase64(tweetnacl.sign.detached(
      new TextEncoder().encode(createCanonicalJsonSigningInput(value)), activationKey.secretKey,
    ), 'base64url');
  }
  return { binding, payload, sign, activationKey, installationKey, claim: { payload, signature: sign(payload) } };
}

describe('Runner claim verification', () => {
  it('accepts a maximally escaped valid path and rejects a sealed bundle beyond the facts JSON bound', () => {
    const recipient = tweetnacl.box.keyPair();
    const content = {
      v: 1,
      directory: `/${'\u0001'.repeat(9_999)}`,
      machine: {
        host: 'runner.example.test',
        platform: 'linux',
        happyCliVersion: '0.3.0',
        happyHomeDir: `/${'\u0001'.repeat(9_999)}`,
        homeDir: `/${'\u0001'.repeat(9_999)}`,
      },
    };
    expect(RunnerEndpointFactsContentV1Schema.safeParse(content).success).toBe(true);
    const seal = (plaintext: Uint8Array) => sealBoxBundle({ plaintext, recipientPublicKey: recipient.publicKey, randomBytes: tweetnacl.randomBytes });
    const bundle = seal(new TextEncoder().encode(JSON.stringify(content)));
    expect(RunnerEndpointFactsStoredContentV1Schema.safeParse({ t: 'encrypted', c: encodeBase64(bundle, 'base64url') }).success).toBe(true);
    const opened = openBoxBundleWithSecretKey({ bundle, recipientSecretKey: recipient.secretKey });
    expect(opened && JSON.parse(new TextDecoder().decode(opened))).toEqual(content);
    // Every bounded path unit can require at most six JSON ASCII bytes.
    const oversized = seal(new Uint8Array(
      (10_000 * 3 + 255 + 191) * 6
        + JSON.stringify({ v: 1, directory: '', machine: { host: '', platform: 'linux', happyCliVersion: '', happyHomeDir: '', homeDir: '' } }).length
        + 1,
    ));
    expect(RunnerEndpointFactsStoredContentV1Schema.safeParse({ t: 'encrypted', c: encodeBase64(oversized, 'base64url') }).success).toBe(false);
  });
  it('requires strict endpoint-owned Machine facts instead of accepting creator placeholders', () => {
    const machine = {
      host: 'runner.example.test',
      platform: 'linux',
      happyCliVersion: '0.3.0',
      happyHomeDir: '/runner/home',
      homeDir: '/runner/home',
    } as const;
    expect(RunnerEndpointFactsContentV1Schema.safeParse({ v: 1, directory: '/work/project', machine }).success).toBe(true);
    expect(RunnerEndpointFactsContentV1Schema.safeParse({ v: 1, directory: '/work/project' }).success).toBe(false);
    expect(RunnerEndpointFactsContentV1Schema.safeParse({ v: 1, directory: '/work/project', machine: { ...machine, platform: 'freebsd' } }).success).toBe(false);
    expect(RunnerEndpointFactsContentV1Schema.safeParse({ v: 1, directory: '/work/project', machine: { ...machine, injected: true } }).success).toBe(false);
  });
  it('authenticates stored facts against the exact claim and rejects purpose, content and Home substitutions', () => {
    const { binding, payload, claim, activationKey, installationKey } = claimFixture();
    const facts = signRunnerEndpointFactsV1({ payload: {
      v: 1, purpose: 'happier.ephemeral-session-runner.endpoint-facts',
      claim: RunnerClaimPayloadV1Schema.parse(payload),
      content: { t: 'plain', v: { v: 1, directory: '/work/project', machine: {
        host: 'runner.example.test', platform: 'linux', happyCliVersion: '0.3.0',
        happyHomeDir: '/runner/home', homeDir: '/runner/home',
      } } },
    }, activationSecretKey: activationKey.secretKey, installationSecretKey: installationKey.secretKey });
    const verify = (endpointFacts: unknown) => verifyRunnerEndpointFactsV1({ endpointFacts, claim, expectedBinding: binding });
    expect(verify(facts)).toEqual(facts);
    const changedHome = signRunnerEndpointFactsV1({ payload: { ...facts.payload,
      claim: { ...facts.payload.claim, binding: { ...facts.payload.claim.binding, homeServerIdentityId: 'srv_substituted_home' } },
    }, activationSecretKey: activationKey.secretKey, installationSecretKey: installationKey.secretKey });
    expect(verify(changedHome)).toBeNull();
    for (const changed of [
      { ...facts, payload: { ...facts.payload, purpose: 'happier.ephemeral-session-runner.consent' } },
      { ...facts, payload: { ...facts.payload, content: { t: 'plain', v: { ...facts.payload.content.v, directory: '/work/substituted' } } } },
      { ...facts, payload: { ...facts.payload, unknown: true } },
      { ...facts, installationSignature: `${facts.installationSignature}=` },
      { ...facts, activationSignature: claim.signature },
    ]) expect(verify(changed)).toBeNull();
  });
  it('accepts the signed exact creator binding and rejects substituted Home, keys and installation custody', () => {
    const { binding, payload, claim, sign } = claimFixture();
    expect(verifyRunnerClaimV1({ claim, expectedBinding: binding })).toEqual(claim);

    for (const patch of [
      { homeServerIdentityId: 'srv_other_home' },
      { creatorAccountId: 'another-account' },
      { creatorTokenEpoch: 4 },
      { activationExpiresAt: 123 },
      { workspace: { kind: 'endpoint_home' } },
      { sessionId: 'another-session' },
      { machineId: 'another-machine' },
      { artifact: { ...binding.artifact, sha256: 'b'.repeat(64) } },
      { endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'another-account' } },
    ]) {
      const changedPayload = { ...payload, binding: { ...binding, ...patch } };
      expect(verifyRunnerClaimV1({
        claim: { payload: changedPayload, signature: sign(changedPayload) }, expectedBinding: binding,
      })).toBeNull();
    }

    const substitutedBox = { ...payload, runnerBoxPublicKey: encodeBase64(tweetnacl.box.keyPair().publicKey, 'base64url') };
    expect(verifyRunnerClaimV1({ claim: { ...claim, payload: substitutedBox }, expectedBinding: binding })).toBeNull();
    const substitutedInstallation = {
      ...payload,
      installation: { ...payload.installation, publicKey: encodeBase64(tweetnacl.sign.keyPair().publicKey, 'base64url') },
    };
    expect(verifyRunnerClaimV1({
      claim: { payload: substitutedInstallation, signature: sign(substitutedInstallation) }, expectedBinding: binding,
    })).toBeNull();
  });

  it('rejects unknown fields, noncanonical keys, low-order box keys and recipient mode confusion even when signed', () => {
    const { binding, payload, sign } = claimFixture();
    const canonicalKey = payload.runnerBoxPublicKey;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const noncanonicalKey = canonicalKey.slice(0, -1) + alphabet[alphabet.indexOf(canonicalKey.slice(-1)) + 1];
    for (const changedPayload of [
      { ...payload, unknown: true },
      { ...payload, purpose: 'happier.ephemeral-session-runner.consent' },
      { ...payload, runnerBoxPublicKey: `${canonicalKey}=` },
      { ...payload, runnerBoxPublicKey: ` ${canonicalKey}` },
      { ...payload, runnerBoxPublicKey: noncanonicalKey },
      { ...payload, runnerBoxPublicKey: encodeBase64(new Uint8Array(32), 'base64url') },
      { ...payload, installation: { ...payload.installation, proof: { ...payload.installation.proof, unknown: true } } },
      { ...payload, binding: { ...binding, endpointFactsRecipient: { ...binding.endpointFactsRecipient, contentPublicKey: canonicalKey } } },
    ]) {
      expect(verifyRunnerClaimV1({
        claim: { payload: changedPayload, signature: sign(changedPayload) }, expectedBinding: binding,
      })).toBeNull();
    }
  });

  it('binds E2EE endpoint facts to the creator-authenticated Account content key', () => {
    const { binding, payload, sign } = claimFixture();
    const accountKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(4));
    const contentKey = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(5));
    const recipient = {
      mode: 'e2ee',
      creatorAccountId: binding.creatorAccountId,
      accountSigningPublicKey: encodeBase64(accountKey.publicKey, 'base64url'),
      contentPublicKey: encodeBase64(contentKey.publicKey, 'base64url'),
      contentPublicKeySignature: encodeBase64(signAccountContentKeyBindingV1({
        accountSigningSecretKey: accountKey.secretKey, contentPublicKey: contentKey.publicKey,
      }), 'base64url'),
      contentPublicKeyFingerprint: computeContentPublicKeyFingerprint(contentKey.publicKey),
    };
    const expectedBinding = { ...binding, endpointFactsRecipient: recipient };
    const signedPayload = { ...payload, binding: expectedBinding };
    const claim = { payload: signedPayload, signature: sign(signedPayload) };
    expect(verifyRunnerClaimV1({ claim, expectedBinding })).toEqual(claim);
    for (const patch of [
      { contentPublicKeyFingerprint: `content-public-key-sha256:${'0'.repeat(64)}` },
      { contentPublicKeySignature: encodeBase64(new Uint8Array(64), 'base64url') },
      { contentPublicKey: encodeBase64(tweetnacl.box.keyPair().publicKey, 'base64url') },
    ]) {
      const changedBinding = { ...expectedBinding, endpointFactsRecipient: { ...recipient, ...patch } };
      const changedPayload = { ...payload, binding: changedBinding };
      expect(verifyRunnerClaimV1({
        claim: { payload: changedPayload, signature: sign(changedPayload) }, expectedBinding: changedBinding,
      })).toBeNull();
    }
  });

  it('rejects an identity-point activation key even when its forged signature verifies', () => {
    const { binding, payload } = claimFixture();
    const identityPoint = new Uint8Array(32);
    identityPoint[0] = 1;
    const forgedSignature = new Uint8Array(64);
    forgedSignature[0] = 1;
    const expectedBinding = { ...binding, activationSigningPublicKey: encodeBase64(identityPoint, 'base64url') };
    const forgedPayload = { ...payload, binding: expectedBinding };
    expect(verifyRunnerClaimV1({
      claim: { payload: forgedPayload, signature: encodeBase64(forgedSignature, 'base64url') },
      expectedBinding,
    })).toBeNull();
  });
});
