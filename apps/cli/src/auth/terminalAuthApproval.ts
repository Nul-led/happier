import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import { randomBytes } from 'node:crypto';
import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { createServerUrlComparableKey, deriveAccountMachineKeyFromRecoverySecret, sealTerminalProvisioningV3Payload, sealTerminalProvisioningV3TokenOnlyPayload } from '@happier-dev/protocol';

import { ConnectedServiceCredentialHttpClient } from '@/api/client/connectedServiceCredentialApi';
import { resolveCliFeatureDecision, resolveCliFeatureDecisionForServer } from '@/features/featureDecisionService';
import { configuration } from '@/configuration';
import { readStoredCredentials, type Credentials } from '@/persistence';

export class TokenOnlyTerminalApprovalUpgradeRequiredError extends Error {
  readonly code = 'TOKEN_ONLY_TERMINAL_APPROVAL_UPGRADE_REQUIRED' as const;

  constructor() {
    super(
      'Token-only CLI-to-remote pairing requires an authenticated v3 request with token-only reader support. '
      + 'Update the recipient CLI and use --request-file with a new auth request.',
    );
    this.name = 'TokenOnlyTerminalApprovalUpgradeRequiredError';
  }
}

function decodePublicKey(value: string): Uint8Array {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Missing public key');
  const tryBase64 = (enc: BufferEncoding): Uint8Array | null => {
    try {
      const buf = Buffer.from(raw, enc);
      if (buf.length !== tweetnacl.box.publicKeyLength) return null;
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  };
  return tryBase64('base64') ?? tryBase64('base64url') ?? (() => {
    throw new Error('Invalid public key (expected base64 or base64url encoded 32-byte key)');
  })();
}

function encodePublicKeyBase64(pk: Uint8Array): string {
  return Buffer.from(pk).toString('base64');
}

function encryptForTerminal(recipientPublicKey: Uint8Array, plaintext: Uint8Array): string {
  const ephemeral = tweetnacl.box.keyPair();
  const nonce = randomBytes(tweetnacl.box.nonceLength);
  const cipher = tweetnacl.box(plaintext, nonce, recipientPublicKey, ephemeral.secretKey);
  const bundle = Buffer.concat([Buffer.from(ephemeral.publicKey), Buffer.from(nonce), Buffer.from(cipher)]);
  return bundle.toString('base64');
}

function buildApprovalPayload(creds: Credentials): Uint8Array {
  const machineKey =
    creds.encryption.type === 'legacy'
      ? deriveAccountMachineKeyFromRecoverySecret(creds.encryption.secret)
      : creds.encryption.machineKey;

  const plaintext = new Uint8Array(33);
  plaintext[0] = 0;
  plaintext.set(machineKey, 1);
  return plaintext;
}

export type TerminalAuthApprovalRequest = Readonly<{
  publicKey: string;
  pairing?: Readonly<{ secretB64Url: string; createdAtMs: number; expiresAtMs: number }>;
  supportsTokenOnly?: boolean;
}>;

/** Accept the existing request JSON or private pending state without retaining its private key. */
export function parseTerminalAuthApprovalRequest(
  value: unknown,
  allowedServerUrls: readonly string[] = [configuration.serverUrl, configuration.apiServerUrl],
): TerminalAuthApprovalRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid auth request file');
  const packet = value as Record<string, unknown>;
  if (typeof packet.publicKey !== 'string') throw new Error('Invalid auth request (publicKey)');
  const publicKey = encodePublicKeyBase64(decodePublicKey(packet.publicKey));
  for (const field of ['serverUrl', 'publicServerUrl'] as const) {
    const url = packet[field];
    if (url === undefined) continue;
    if (typeof url !== 'string' || !allowedServerUrls.some((allowed) => {
      try { return createServerUrlComparableKey(url) === createServerUrlComparableKey(allowed); }
      catch { return false; }
    })) throw new Error('Auth request belongs to a different relay. Select the matching server before approval.');
  }
  const hasPairing = packet.pairing !== undefined || packet.pairingSecret !== undefined
    || packet.pairingCreatedAtMs !== undefined || packet.pairingExpiresAtMs !== undefined;
  if (!hasPairing) {
    if (packet.pairingRequirement === 'v3') throw new Error('Authenticated terminal pairing context is missing. Create a new auth request.');
    return { publicKey };
  }
  const pairing = packet.pairing !== undefined
    ? packet.pairing as Record<string, unknown>
    : { secretB64Url: packet.pairingSecret, createdAtMs: packet.pairingCreatedAtMs, expiresAtMs: packet.pairingExpiresAtMs };
  if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)
    || typeof pairing.secretB64Url !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing.secretB64Url)
    || Buffer.from(pairing.secretB64Url, 'base64url').length !== 32
    || !Number.isSafeInteger(pairing.createdAtMs) || !Number.isSafeInteger(pairing.expiresAtMs)
    || (pairing.createdAtMs as number) < 0 || (pairing.expiresAtMs as number) <= (pairing.createdAtMs as number)) {
    throw new Error('Invalid authenticated terminal pairing context');
  }
  const createdAtMs = pairing.createdAtMs as number;
  const expiresAtMs = pairing.expiresAtMs as number;
  const nowMs = Date.now();
  if (createdAtMs > nowMs || expiresAtMs <= nowMs) throw new Error('Terminal pairing request expired or is not yet valid. Create a new auth request.');
  return {
    publicKey,
    pairing: { secretB64Url: pairing.secretB64Url, createdAtMs, expiresAtMs },
    supportsTokenOnly: packet.supportsTokenOnly === true,
  };
}

export async function approveTerminalAuthRequest(params: TerminalAuthApprovalRequest): Promise<void> {
  const request = parseTerminalAuthApprovalRequest(params);
  const recipientPk = decodePublicKey(request.publicKey);
  const creds = await readStoredCredentials();
  if (!creds) throw new Error('Not authenticated. Run `happier auth login` first.');
  let response: string;
  if (request.pairing) {
    const context = {
      terminalEphemeralPublicKey: recipientPk,
      pairingSecret: new Uint8Array(Buffer.from(request.pairing.secretB64Url, 'base64url')),
      createdAtMs: request.pairing.createdAtMs,
      expiresAtMs: request.pairing.expiresAtMs,
      randomBytes: (length: number) => new Uint8Array(randomBytes(length)),
    };
    if (!creds.encryption) {
      if (!request.supportsTokenOnly) throw new TokenOnlyTerminalApprovalUpgradeRequiredError();
      const [accountMode, plaintextStorage] = await Promise.all([
        new ConnectedServiceCredentialHttpClient(creds).getAccountEncryptionMode({ refresh: true }),
        resolveCliFeatureDecisionForServer({ featureId: 'encryption.plaintextStorage', env: process.env, serverUrl: configuration.apiServerUrl }),
      ]);
      const keylessAccounts = resolveCliFeatureDecision({ featureId: 'e2ee.keylessAccounts', env: process.env, serverSnapshot: plaintextStorage.serverSnapshot });
      if (accountMode !== 'plain' || plaintextStorage.decision.state !== 'enabled' || keylessAccounts.state !== 'enabled') {
        throw new Error('Token-only terminal pairing is not permitted by the active account policy');
      }
    }
    const payload = creds.encryption
      ? sealTerminalProvisioningV3Payload({ ...context, contentPrivateKey: buildApprovalPayload(creds).slice(1) })
      : sealTerminalProvisioningV3TokenOnlyPayload(context);
    response = Buffer.from(payload).toString('base64');
  } else {
    if (!creds.encryption) throw new TokenOnlyTerminalApprovalUpgradeRequiredError();
    response = encryptForTerminal(recipientPk, buildApprovalPayload(creds));
  }
  await axios.post(
    `${configuration.apiServerUrl}/v1/auth/response`,
    { publicKey: encodePublicKeyBase64(recipientPk), response },
    { headers: { ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(), Authorization: `Bearer ${creds.token}` } },
  );
}
