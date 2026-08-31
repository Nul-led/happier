import { afterAll, describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import * as privacyKit from 'privacy-kit';
import { randomBytes } from 'node:crypto';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { fetchJson } from '../../src/testkit/http';
import { waitFor } from '../../src/testkit/timing';
import { writeTestManifestForServer } from '../../src/testkit/manifestForServer';
import { FailureArtifacts } from '../../src/testkit/failureArtifacts';
import { envFlag } from '../../src/testkit/env';
import {
  FeaturesResponseSchema,
  computeHomeQrBindingProofV2,
  computeHomeQrConfirmationCodeV2,
  deriveHomeQrBindingKeyV2,
  deriveHomeQrRendezvousSecretV2,
  deriveHomeQrRendezvousVerifierV2,
  encodeHomeQrInviteV2Payload,
  openBoxBundle,
  openTerminalProvisioningV3Response,
  parseHomeQrInviteV2Payload,
  sealTerminalProvisioningV3TokenOnlyPayload,
  verifyHomeQrBindingProofV2,
  type HomeQrInviteV2,
} from '@happier-dev/protocol';

const run = createRunDirs({ runLabel: 'core' });

function toPrivacyKitBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(input.byteLength);
  out.set(input);
  return out;
}

async function createTokenFromSecretSeed(baseUrl: string, seed: Uint8Array): Promise<string> {
  const kp = tweetnacl.sign.keyPair.fromSeed(seed);
  const challenge = Uint8Array.from(randomBytes(32));
  const signature = tweetnacl.sign.detached(challenge, kp.secretKey);
  const body = {
    publicKey: privacyKit.encodeBase64(toPrivacyKitBytes(kp.publicKey)),
    challenge: privacyKit.encodeBase64(toPrivacyKitBytes(challenge)),
    signature: privacyKit.encodeBase64(toPrivacyKitBytes(signature)),
  };

  const res = await fetchJson<{ token?: string }>(`${baseUrl}/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 15_000,
  });
  if (res.status !== 200 || typeof res.data?.token !== 'string' || res.data.token.length === 0) {
    throw new Error(`Failed to create token from secret (status=${res.status})`);
  }
  return res.data.token;
}

async function fetchHomeServerIdentityId(baseUrl: string): Promise<string> {
  const response = await fetchJson<unknown>(`${baseUrl}/v1/features`, { timeoutMs: 15_000 });
  expect(response.status).toBe(200);
  const payload = FeaturesResponseSchema.parse(response.data);
  const serverIdentityId = payload.capabilities.serverIdentity.serverIdentityId;
  expect(typeof serverIdentityId).toBe('string');
  if (!serverIdentityId) throw new Error('Expected Home server identity');
  return serverIdentityId;
}

function decryptTokenEncryptedBundle(params: { tokenEncryptedBase64: string; recipientSecretKey: Uint8Array }): string {
  const opened = openBoxBundle({
    bundle: privacyKit.decodeBase64(params.tokenEncryptedBase64),
    recipientSecretKeyOrSeed: params.recipientSecretKey,
  });
  if (!opened) {
    throw new Error('Failed to decrypt tokenEncrypted bundle');
  }
  return new TextDecoder().decode(opened);
}

describe('core e2e: auth pairing (desktop QR → mobile scan)', () => {
  let server: StartedServer | null = null;

  afterAll(async () => {
    await server?.stop();
  });

  it('restores a logged-out mobile device via desktop pairing QR', async () => {
    const testDir = run.testDir('auth-pairing-desktop-qr-mobile-scan');
    const saveArtifactsOnSuccess = envFlag(['HAPPIER_E2E_SAVE_ARTIFACTS', 'HAPPY_E2E_SAVE_ARTIFACTS'], false);
    const startedAt = new Date().toISOString();

    server = await startServerLight({
      testDir,
      extraEnv: {
        HAPPIER_FEATURE_AUTH_PAIRING__DESKTOP_QR_MOBILE_SCAN_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
        HAPPIER_FEATURE_ENCRYPTION__DEFAULT_ACCOUNT_MODE: 'plain',
      },
    });
    const startedServer = server;
    if (!startedServer) throw new Error('missing server fixture');

    writeTestManifestForServer({
      testDir,
      server: startedServer,
      startedAt,
      runId: run.runId,
      testName: 'auth-pairing-desktop-qr-mobile-scan',
      sessionIds: [],
      env: {
        CI: process.env.CI,
        HAPPIER_E2E_SAVE_ARTIFACTS: process.env.HAPPIER_E2E_SAVE_ARTIFACTS ?? process.env.HAPPY_E2E_SAVE_ARTIFACTS,
      },
    });

    const artifacts = new FailureArtifacts();

    let passed = false;
    try {
      const desktopSigningSeed = Uint8Array.from(randomBytes(32));
      const desktopToken = await createTokenFromSecretSeed(startedServer.baseUrl, desktopSigningSeed);
      const homeServerIdentityId = await fetchHomeServerIdentityId(startedServer.baseUrl);
      const qrSecret = Uint8Array.from(randomBytes(32));
      const rendezvousSecret = deriveHomeQrRendezvousSecretV2(qrSecret);
      const rendezvousVerifier = deriveHomeQrRendezvousVerifierV2(qrSecret);
      const issuedAtMs = Date.now();

      const startRes = await fetchJson<{ pairId?: string; expiresAt?: string }>(`${startedServer.baseUrl}/v1/auth/pairing/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${desktopToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secretHash: Buffer.from(rendezvousVerifier).toString('base64url') }),
        timeoutMs: 15_000,
      });
      expect(startRes.status).toBe(200);
      expect(typeof startRes.data?.pairId).toBe('string');
      expect(typeof startRes.data?.expiresAt).toBe('string');
      const pairId = String(startRes.data.pairId);
      const expiresAtMs = Date.parse(String(startRes.data.expiresAt));
      expect(Number.isSafeInteger(expiresAtMs)).toBe(true);

      const invite: HomeQrInviteV2 = {
        v: 2,
        intent: 'home_device',
        pairId,
        home: {
          v: 1,
          homeServerIdentityId,
          canonicalServerUrl: startedServer.baseUrl,
          revision: 1,
          endpoints: [{ kind: 'https', url: startedServer.baseUrl }],
        },
        qrSecretBase64Url: Buffer.from(qrSecret).toString('base64url'),
        issuedAtMs,
        expiresAtMs,
      };
      const parsedInvite = parseHomeQrInviteV2Payload(encodeHomeQrInviteV2Payload(invite), { nowMs: Date.now() });
      expect(parsedInvite).toEqual(invite);
      if (!parsedInvite) throw new Error('Expected canonical Home QR V2 invite');

      const mobileKp = tweetnacl.box.keyPair();
      const mobilePublicKeyBase64 = privacyKit.encodeBase64(toPrivacyKitBytes(mobileKp.publicKey));
      const joiningBindingParams = {
        qrSecret,
        pairId: parsedInvite.pairId,
        homeServerIdentityId: parsedInvite.home.homeServerIdentityId,
        requesterPublicKey: mobileKp.publicKey,
        expiresAtMs: parsedInvite.expiresAtMs,
      };
      const bindingProof = computeHomeQrBindingProofV2(joiningBindingParams);
      const joiningConfirmationCode = computeHomeQrConfirmationCodeV2(joiningBindingParams);

      const requestAuthRes = await fetchJson<{ state?: string }>(`${startedServer.baseUrl}/v1/auth/account/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: mobilePublicKeyBase64 }),
        timeoutMs: 15_000,
      });
      expect(requestAuthRes.status).toBe(200);
      expect(requestAuthRes.data?.state).toBe('requested');

      const malformedBindingRes = await fetchJson<{ error?: string }>(`${startedServer.baseUrl}/v1/auth/pairing/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairId,
          secret: Buffer.from(rendezvousSecret).toString('base64url'),
          publicKey: mobilePublicKeyBase64,
          bindingProof: Buffer.from(randomBytes(31)).toString('base64url'),
          homeServerIdentityId,
          expiresAtMs,
        }),
        timeoutMs: 15_000,
      });
      expect(malformedBindingRes.status).toBe(400);

      const wrongHomeRes = await fetchJson<{ error?: string }>(`${startedServer.baseUrl}/v1/auth/pairing/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairId,
          secret: Buffer.from(rendezvousSecret).toString('base64url'),
          publicKey: mobilePublicKeyBase64,
          bindingProof,
          homeServerIdentityId: `${homeServerIdentityId}-wrong`,
          expiresAtMs,
        }),
        timeoutMs: 15_000,
      });
      expect(wrongHomeRes.status).toBe(403);
      expect(wrongHomeRes.data?.error).toBe('wrong_home');

      const requestPairingRes = await fetchJson<{ state?: string }>(`${startedServer.baseUrl}/v1/auth/pairing/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairId,
          secret: Buffer.from(rendezvousSecret).toString('base64url'),
          publicKey: mobilePublicKeyBase64,
          bindingProof,
          homeServerIdentityId,
          expiresAtMs,
          deviceLabel: 'Test Phone',
        }),
        timeoutMs: 15_000,
      });
      expect(requestPairingRes.status).toBe(200);
      expect(requestPairingRes.data?.state).toBe('requested');

      const statusRes = await fetchJson<{
        state?: string;
        pairId?: string;
        expiresAt?: string;
        homeServerIdentityId?: string;
        requestedPublicKey?: string;
        bindingProof?: string;
        requestedDeviceLabel?: string | null;
      }>(`${startedServer.baseUrl}/v1/auth/pairing/status?pairId=${encodeURIComponent(pairId)}`, {
        headers: { Authorization: `Bearer ${desktopToken}` },
        timeoutMs: 15_000,
      });
      expect(statusRes.status).toBe(200);
      expect(statusRes.data?.state).toBe('requested');
      expect(statusRes.data?.pairId).toBe(pairId);
      expect(Date.parse(String(statusRes.data?.expiresAt))).toBe(expiresAtMs);
      expect(statusRes.data?.requestedPublicKey).toBe(mobilePublicKeyBase64);
      expect(statusRes.data?.homeServerIdentityId).toBe(homeServerIdentityId);
      expect(statusRes.data?.bindingProof).toBe(bindingProof);
      const trustedBindingParams = {
        qrSecret,
        pairId: String(statusRes.data?.pairId),
        homeServerIdentityId: String(statusRes.data?.homeServerIdentityId),
        requesterPublicKey: privacyKit.decodeBase64(String(statusRes.data?.requestedPublicKey)),
        expiresAtMs: Date.parse(String(statusRes.data?.expiresAt)),
      };
      expect(verifyHomeQrBindingProofV2(trustedBindingParams, String(statusRes.data?.bindingProof))).toBe(true);
      const wrongBindingProof = `${bindingProof[0] === 'A' ? 'B' : 'A'}${bindingProof.slice(1)}`;
      expect(verifyHomeQrBindingProofV2(trustedBindingParams, wrongBindingProof)).toBe(false);
      const trustedConfirmationCode = computeHomeQrConfirmationCodeV2(trustedBindingParams);
      expect(trustedConfirmationCode).toBe(joiningConfirmationCode);
      expect(trustedConfirmationCode).toMatch(/^\d{6}$/u);

      const legacyCompletionRes = await fetchJson<{ error?: string }>(`${startedServer.baseUrl}/v1/auth/account/response`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${desktopToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicKey: mobilePublicKeyBase64,
          response: 'legacy-v1-untyped-response',
        }),
        timeoutMs: 15_000,
      });
      expect(legacyCompletionRes.status).toBe(426);
      expect(legacyCompletionRes.data?.error).toBe('account_provisioning_update_required');

      const encryptedResponse = sealTerminalProvisioningV3TokenOnlyPayload({
        terminalEphemeralPublicKey: mobileKp.publicKey,
        pairingSecret: deriveHomeQrBindingKeyV2(qrSecret),
        createdAtMs: issuedAtMs,
        expiresAtMs,
        randomBytes: (n: number) => Uint8Array.from(randomBytes(n)),
      });

      const responseRes = await fetchJson<{ success?: boolean }>(`${startedServer.baseUrl}/v1/auth/account/response`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${desktopToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pairId,
          publicKey: mobilePublicKeyBase64,
          response: privacyKit.encodeBase64(toPrivacyKitBytes(encryptedResponse)),
          homeServerIdentityId,
          responseKind: 'tokenOnly',
        }),
        timeoutMs: 15_000,
      });
      expect(responseRes.status).toBe(200);
      expect(responseRes.data?.success).toBe(true);

      const legacyPollRes = await fetchJson<{ error?: string }>(`${startedServer.baseUrl}/v1/auth/account/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: mobilePublicKeyBase64 }),
        timeoutMs: 15_000,
      });
      expect(legacyPollRes.status).toBe(426);
      expect(legacyPollRes.data?.error).toBe('account_provisioning_update_required');

      const authorizedState: {
        value: { state: 'authorized'; tokenEncrypted: string; response: string } | null;
      } = { value: null };
      await waitFor(async () => {
        const pollRes = await fetchJson<{
          state?: 'requested' | 'authorized';
          tokenEncrypted?: string;
          response?: string;
        }>(`${startedServer.baseUrl}/v2/auth/account/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey: mobilePublicKeyBase64 }),
          timeoutMs: 15_000,
        });
        if (pollRes.status !== 200) return false;
        if (pollRes.data?.state !== 'authorized') return false;
        if (typeof pollRes.data.tokenEncrypted !== 'string' || typeof pollRes.data.response !== 'string') return false;
        authorizedState.value = {
          state: 'authorized',
          tokenEncrypted: pollRes.data.tokenEncrypted,
          response: pollRes.data.response,
        };
        return true;
      }, { timeoutMs: 20_000, intervalMs: 500 });
      const authorized = authorizedState.value;
      if (!authorized) {
        throw new Error('Expected authorized payload');
      }

      artifacts.json('authorized.payload.json', () => authorized);

      const mobileToken = decryptTokenEncryptedBundle({
        tokenEncryptedBase64: authorized.tokenEncrypted,
        recipientSecretKey: mobileKp.secretKey,
      });
      const provisionedMaterial = openTerminalProvisioningV3Response({
        payload: privacyKit.decodeBase64(authorized.response),
        recipientSecretKeyOrSeed: mobileKp.secretKey,
        terminalEphemeralPublicKey: mobileKp.publicKey,
        pairingSecret: deriveHomeQrBindingKeyV2(qrSecret),
        createdAtMs: issuedAtMs,
        expiresAtMs,
        nowMs: Date.now(),
      });
      expect(provisionedMaterial).toEqual({ type: 'tokenOnly' });

      const profileRes = await fetchJson<unknown>(`${startedServer.baseUrl}/v1/account/profile`, {
        headers: { Authorization: `Bearer ${mobileToken}` },
        timeoutMs: 15_000,
      });
      expect(profileRes.status).toBe(200);

      passed = true;
    } finally {
      await artifacts.dumpAll(testDir, { onlyIf: saveArtifactsOnSuccess || !passed });
    }
  }, 240_000);
});
