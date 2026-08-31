import { createHash } from 'node:crypto';
import { join } from 'node:path';
import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { normalizeServerIdentityIdCapability } from '@happier-dev/protocol';

import { decodeBase64 } from '@/api/encryption';
import { writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { configuration } from '@/configuration';
import {
  writeCredentialsDataKey,
  writeCredentialsLegacy,
  writeCredentialsTokenOnly,
  type Credentials,
  type StoredCredentials,
} from '@/persistence';
import { applyServerSelectionFromArgs } from '@/server/serverSelection';
import { ensureMachineIdForCredentials } from '@/ui/auth';
import { ApiClient } from '@/api/api';
import { ensureMachineRegistered } from '@/api/machine/ensureMachineRegistered';
import { initialMachineMetadata } from '@/daemon/machine/metadata';
import {
  openTerminalProvisioningResponse,
  readTerminalPairingRequirement,
  type TerminalPairingRequirement,
} from '@/auth/terminalProvisioningResponse';
import {
  readProtectedLocalStateFile,
  removeProtectedLocalStateFile,
} from '@/utils/fs/protectedLocalState';

type PendingAuthState = Readonly<{
  publicKey: string;
  secretKey: string;
  claimSecret: string;
  serverIdentityId: string;
  pairingSecret?: string;
  pairingCreatedAtMs?: number;
  pairingExpiresAtMs?: number;
  supportsTokenOnly?: true;
  pairingRequirement?: TerminalPairingRequirement;
  createdAt: string;
}>;

const V3_REQUIRED_ERROR =
  'Authenticated terminal pairing v3 is required. Update the Happier mobile app and scan a new QR code.';

// Bound the claim response before decoding: legitimate v3 payloads are ~141
// bytes (188 base64 chars), so anything beyond this is malformed server input.
const MAX_PROVISIONING_RESPONSE_B64_CHARS = 4096;
const PENDING_AUTH_STATE_PROTECTION = { authority: 'owned' } as const;

function pendingAuthStateDir(): string {
  return join(configuration.activeServerDir, 'auth', 'pending');
}

function pendingAuthStatePath(publicKey: Uint8Array): string {
  const publicKeyHex = createHash('sha256').update(Buffer.from(publicKey)).digest('hex').slice(0, 24);
  return join(pendingAuthStateDir(), `${publicKeyHex}.json`);
}

function decodePublicKey(value: string): Uint8Array {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Missing --public-key');
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
    throw new Error('Invalid --public-key (expected base64 or base64url encoded 32-byte key)');
  })();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasCanonicalEncodedLength(
  value: string,
  encoding: 'base64' | 'base64url',
  expectedLength: number,
): boolean {
  try {
    const decoded = Buffer.from(value, encoding);
    return decoded.length === expectedLength && decoded.toString(encoding) === value;
  } catch {
    return false;
  }
}

function parsePendingAuthState(raw: string): PendingAuthState {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('Invalid auth state');
  const {
    publicKey,
    secretKey,
    claimSecret,
    serverIdentityId,
    createdAt,
    pairingSecret,
    pairingCreatedAtMs,
    pairingExpiresAtMs,
    supportsTokenOnly,
    pairingRequirement,
  } = parsed;
  if (typeof publicKey !== 'string' || !hasCanonicalEncodedLength(publicKey, 'base64', 32)) {
    throw new Error('Invalid auth state (publicKey)');
  }
  if (typeof secretKey !== 'string' || !hasCanonicalEncodedLength(secretKey, 'base64', 32)) {
    throw new Error('Invalid auth state (secretKey)');
  }
  if (typeof claimSecret !== 'string' || !hasCanonicalEncodedLength(claimSecret, 'base64url', 32)) {
    throw new Error('Invalid auth state (claimSecret)');
  }
  if (typeof createdAt !== 'string') throw new Error('Invalid auth state (createdAt)');
  const normalizedServerIdentityId = normalizeServerIdentityIdCapability(serverIdentityId);
  if (!normalizedServerIdentityId) throw new Error('Invalid auth state (serverIdentityId)');
  if (supportsTokenOnly !== undefined && supportsTokenOnly !== true) {
    throw new Error('Invalid auth state (supportsTokenOnly)');
  }
  if (pairingRequirement !== undefined && pairingRequirement !== 'v3') {
    throw new Error('Invalid auth state (pairingRequirement)');
  }

  const hasPairingField = pairingSecret !== undefined
    || pairingCreatedAtMs !== undefined
    || pairingExpiresAtMs !== undefined;
  let validatedPairing: Readonly<{
    pairingSecret: string;
    pairingCreatedAtMs: number;
    pairingExpiresAtMs: number;
  }> | null = null;
  if (hasPairingField) {
    if (
      typeof pairingSecret !== 'string'
      || !hasCanonicalEncodedLength(pairingSecret, 'base64url', 32)
    ) {
      throw new Error('Invalid auth state (pairingSecret)');
    }
    if (typeof pairingCreatedAtMs !== 'number' || !Number.isSafeInteger(pairingCreatedAtMs) || pairingCreatedAtMs < 0) {
      throw new Error('Invalid auth state (pairingCreatedAtMs)');
    }
    if (
      typeof pairingExpiresAtMs !== 'number'
      || !Number.isSafeInteger(pairingExpiresAtMs)
      || pairingExpiresAtMs <= pairingCreatedAtMs
    ) {
      throw new Error('Invalid auth state (pairingExpiresAtMs)');
    }
    validatedPairing = { pairingSecret, pairingCreatedAtMs, pairingExpiresAtMs };
  } else if (supportsTokenOnly === true || pairingRequirement === 'v3') {
    throw new Error('Invalid auth state (pairing context)');
  }

  return {
    publicKey,
    secretKey,
    claimSecret,
    serverIdentityId: normalizedServerIdentityId,
    createdAt,
    ...(validatedPairing ?? {}),
    ...(supportsTokenOnly === true ? { supportsTokenOnly: true } : {}),
    ...(pairingRequirement === 'v3' ? { pairingRequirement } : {}),
  };
}

async function completeClaimedCredentialHandoff(params: Readonly<{
  credentials: StoredCredentials;
  statePath: string;
}>): Promise<string> {
  // The relay claim is one-shot. Once credentials are durable, this request
  // must no longer be retryable even if the subsequent registration fails.
  await removeProtectedLocalStateFile(params.statePath, PENDING_AUTH_STATE_PROTECTION);
  try {
    const { machineId } = await ensureMachineIdForCredentials(params.credentials);
    const api = await ApiClient.create(params.credentials);
    const registered = await ensureMachineRegistered({
      api,
      machineId,
      metadata: initialMachineMetadata,
      caller: 'auth.wait',
    });
    return registered.machineId;
  } catch (cause) {
    throw new Error(
      'Authentication credentials were saved, but machine registration is incomplete. '
      + 'Run `happier auth login` to retry machine setup.',
      { cause },
    );
  }
}

export async function handleAuthWait(argsRaw: string[]): Promise<void> {
  const args = await applyServerSelectionFromArgs(argsRaw);

  const json = args.includes('--json');
  if (!json) {
    console.error('Missing required flag: --json');
    process.exit(2);
  }

  const keyIndex = args.findIndex((a) => a === '--public-key');
  const publicKeyRaw = keyIndex >= 0 ? (args[keyIndex + 1] ?? '') : '';
  if (!publicKeyRaw || String(publicKeyRaw).startsWith('--')) {
    console.error('Missing required flag: --public-key <base64>');
    process.exit(2);
  }

  const publicKeyBytes = decodePublicKey(String(publicKeyRaw));
  const statePath = pendingAuthStatePath(publicKeyBytes);
  const state = parsePendingAuthState(await readProtectedLocalStateFile(
    statePath,
    PENDING_AUTH_STATE_PROTECTION,
  ));
  const pairingRequirement = state.pairingRequirement ?? readTerminalPairingRequirement();
  const pairing =
    state.pairingSecret !== undefined
    && state.pairingCreatedAtMs !== undefined
    && state.pairingExpiresAtMs !== undefined
      ? {
          secret: decodeBase64(state.pairingSecret, 'base64url'),
          createdAtMs: state.pairingCreatedAtMs,
          expiresAtMs: state.pairingExpiresAtMs,
        }
      : null;
  if (pairingRequirement === 'v3' && !pairing) {
    console.error(`${V3_REQUIRED_ERROR} Run \`happier auth request --json\` again.`);
    process.exit(1);
  }

  const pollIntervalMsRaw = Number(process.env.HAPPIER_AUTH_POLL_INTERVAL_MS ?? '');
  const pollIntervalMs = Number.isFinite(pollIntervalMsRaw) && pollIntervalMsRaw > 0 ? pollIntervalMsRaw : 1000;

  while (true) {
    const statusRes = await axios.get(`${configuration.apiServerUrl}/v1/auth/request/status`, {
      params: { publicKey: state.publicKey },
    });
    const status = statusRes?.data?.status;
    if (status === 'not_found') {
      console.error('Authentication request expired. Run `happier auth request --json` again.');
      process.exit(1);
    }

    if (status === 'authorized') {
      const claimRes = await axios.post(`${configuration.apiServerUrl}/v1/auth/request/claim`, {
        publicKey: state.publicKey,
        claimSecret: state.claimSecret,
      });
      const claimData = claimRes?.data;
      if (claimData?.state !== 'authorized') {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }
      const claimedServerIdentityId = normalizeServerIdentityIdCapability(claimData.serverIdentityId);
      if (claimedServerIdentityId !== state.serverIdentityId) {
        console.error(
          `The authentication response came from a different Home identity `
          + `(expected ${state.serverIdentityId}, received ${claimedServerIdentityId ?? 'missing'}). `
          + 'Credentials were not changed; create a new request for the intended Home.',
        );
        process.exit(1);
      }
      const token = String(claimData.token ?? '');
      const responseB64 = String(claimData.response ?? '');
      if (!token || !responseB64 || responseB64.length > MAX_PROVISIONING_RESPONSE_B64_CHARS) {
        console.error('Unexpected response from server.');
        process.exit(1);
      }

      const terminalSecretKey = decodeBase64(state.secretKey);
      const opened = openTerminalProvisioningResponse({
        payload: decodeBase64(responseB64),
        terminalSecretKey,
        terminalPublicKey: publicKeyBytes,
        pairing,
        requirement: pairingRequirement,
        nowMs: Date.now(),
        supportsTokenOnly: state.supportsTokenOnly === true,
      });
      if (!opened) {
        console.error(
          pairingRequirement === 'v3'
            ? V3_REQUIRED_ERROR
            : 'Failed to decrypt auth response.',
        );
        process.exit(1);
      }

      if (opened.type === 'legacy') {
        await writeCredentialsLegacy({ secret: opened.key, token });
        const credentials: Credentials = {
          token,
          encryption: {
            type: 'legacy',
            secret: opened.key,
          },
        };
        const machineId = await completeClaimedCredentialHandoff({ credentials, statePath });
        await writeJsonStdout({
          success: true,
          token,
          encryptionType: 'legacy' as const,
          pairingAuthentication: opened.authenticated ? 'v3' : 'legacy',
          machineId,
        });
        return;
      }

      if (opened.type === 'dataKey') {
        const machineKey = opened.key;
        const publicKey = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;
        await writeCredentialsDataKey({ publicKey, machineKey, token });
        const credentials: Credentials = {
          token,
          encryption: {
            type: 'dataKey',
            publicKey,
            machineKey,
          },
        };
        const machineId = await completeClaimedCredentialHandoff({ credentials, statePath });
        await writeJsonStdout({
          success: true,
          token,
          encryptionType: 'dataKey' as const,
          pairingAuthentication: opened.authenticated ? 'v3' : 'legacy',
          machineId,
        });
        return;
      }

      await writeCredentialsTokenOnly({ token });
      const credentials: StoredCredentials = {
        token,
        encryption: null,
      };
      const machineId = await completeClaimedCredentialHandoff({ credentials, statePath });
      await writeJsonStdout({
        success: true,
        token,
        encryptionType: 'tokenOnly' as const,
        pairingAuthentication: 'v3' as const,
        machineId,
      });
      return;
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
