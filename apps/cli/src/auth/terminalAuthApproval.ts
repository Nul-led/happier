import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import { randomBytes } from 'node:crypto';
import axios from 'axios';
import tweetnacl from 'tweetnacl';
import {
  resolveTerminalProvisioningVariantV2,
  sealTerminalProvisioningV3Payload,
  sealTerminalProvisioningV3TokenOnlyPayload,
  normalizeServerIdentityIdCapability,
} from '@happier-dev/protocol';
import type { ResolvedHomeTarget } from '@happier-dev/cli-common/homeTarget';

import { configuration } from '@/configuration';
import { readStoredCredentials, readStoredCredentialsForServerId, type StoredCredentials } from '@/persistence';
import { getServerProfile } from '@/server/serverProfiles';
import { acquireTerminalAuthEnrollmentRuntime } from '@/auth/terminalAuthEnrollmentRuntime';
import { verifyTerminalAuthEnrollmentRuntime } from '@/auth/terminalAuthEnrollmentClient';
import { fetchServerFeaturesSnapshot } from '@/features/serverFeaturesClient';

export class TokenOnlyTerminalApprovalUpgradeRequiredError extends Error {
  readonly code = 'TOKEN_ONLY_TERMINAL_APPROVAL_UPGRADE_REQUIRED' as const;

  constructor() {
    super(
      'Token-only CLI-to-remote pairing requires a newer terminal approval protocol. '
      + 'Upgrade both CLIs when support is available, or approve from a device with Account encryption material.',
    );
    this.name = 'TokenOnlyTerminalApprovalUpgradeRequiredError';
  }
}

export class TerminalPairingContextInvalidError extends Error {
  readonly code = 'TERMINAL_PAIRING_CONTEXT_INVALID' as const;

  constructor() {
    super(
      'The terminal pairing authentication context is malformed. '
      + 'Run `happier auth request --json` on the remote machine and approve the new request.',
    );
    this.name = 'TerminalPairingContextInvalidError';
  }
}

export class TerminalPairingContextExpiredError extends Error {
  readonly code = 'TERMINAL_PAIRING_CONTEXT_EXPIRED' as const;

  constructor() {
    super(
      'The terminal pairing authentication context has expired. '
      + 'Run `happier auth request --json` on the remote machine and approve the new request.',
    );
    this.name = 'TerminalPairingContextExpiredError';
  }
}

export class TerminalPairingContextRequiredError extends Error {
  readonly code = 'TERMINAL_PAIRING_CONTEXT_REQUIRED' as const;

  constructor() {
    super(
      'Authenticated terminal pairing requires a v3 pairing context from the remote requester. '
      + 'Upgrade the remote CLI, then run `happier auth request --json` on the remote machine and approve the new request.',
    );
    this.name = 'TerminalPairingContextRequiredError';
  }
}

export class LegacyTerminalProvisioningUnavailableError extends Error {
  readonly code = 'LEGACY_TERMINAL_PROVISIONING_UNAVAILABLE' as const;

  constructor() {
    super(
      'This CLI holds legacy recovery-secret credentials that cannot provision authenticated pairing material. '
      + 'Re-authenticate with `happier auth login` to obtain current credentials, or approve from a device with data-key material.',
    );
    this.name = 'LegacyTerminalProvisioningUnavailableError';
  }
}

export class TerminalProvisioningMaterialInvalidError extends Error {
  readonly code = 'TERMINAL_PROVISIONING_MATERIAL_INVALID' as const;

  constructor() {
    super(
      'Stored account encryption material is inconsistent; refusing to provision pairing material. '
      + 'Re-authenticate with `happier auth login` to restore consistent credentials.',
    );
    this.name = 'TerminalProvisioningMaterialInvalidError';
  }
}

/**
 * Unvalidated v3 pairing context as received from the remote requester's
 * `auth request --json` envelope. The approval owner below is the single
 * validator; callers forward it verbatim and must not parse or drop it.
 */
export type TerminalPairingAuthentication = Readonly<{
  secret: Uint8Array;
  createdAtMs: number;
  expiresAtMs: number;
}>;

function decodePairingSecret(raw: string): Uint8Array {
  try {
    const decoded = Buffer.from(raw, 'base64url');
    if (decoded.length === 32 && decoded.toString('base64url') === raw) {
      return new Uint8Array(decoded);
    }
  } catch {
    // fall through to the typed invalid-context error
  }
  throw new TerminalPairingContextInvalidError();
}

function parseTerminalPairingAuthentication(
  pairing: unknown,
  nowMs: number,
): TerminalPairingAuthentication {
  if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)) {
    throw new TerminalPairingContextInvalidError();
  }
  // Untrusted remote JSON boundary: narrow once here, then validate strictly.
  const pairingRecord = pairing as Record<string, unknown>;
  const expectedKeys = ['createdAtMs', 'expiresAtMs', 'secretB64Url'];
  const actualKeys = Object.keys(pairingRecord).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TerminalPairingContextInvalidError();
  }
  const { secretB64Url, createdAtMs, expiresAtMs } = pairingRecord;
  if (typeof secretB64Url !== 'string') {
    throw new TerminalPairingContextInvalidError();
  }
  if (typeof createdAtMs !== 'number' || !Number.isSafeInteger(createdAtMs)) {
    throw new TerminalPairingContextInvalidError();
  }
  if (typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs)) {
    throw new TerminalPairingContextInvalidError();
  }
  if (createdAtMs < 0 || expiresAtMs <= createdAtMs) {
    throw new TerminalPairingContextInvalidError();
  }
  if (nowMs > expiresAtMs) {
    throw new TerminalPairingContextExpiredError();
  }
  return {
    secret: decodePairingSecret(secretB64Url),
    createdAtMs,
    expiresAtMs,
  };
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

function publicKeyMatchesMachineKey(publicKey: Uint8Array, machineKey: Uint8Array): boolean {
  const derived = tweetnacl.box.keyPair.fromSecretKey(machineKey).publicKey;
  if (derived.length !== publicKey.length) return false;
  let difference = 0;
  for (let index = 0; index < derived.length; index += 1) {
    difference |= derived[index]! ^ publicKey[index]!;
  }
  return difference === 0;
}

/**
 * The material kind actually sealed, always matching the canonical
 * `TerminalProvisioningV2Response` discriminant — never a caller-supplied flag.
 */
export type SealedProvisioningResponseKind = 'tokenOnly' | 'dataKey';

function sealProvisioningMaterial(params: Readonly<{
  recipientPublicKey: Uint8Array;
  creds: StoredCredentials;
  pairing: TerminalPairingAuthentication;
  supportsTokenOnly: boolean;
}>): Readonly<{ kind: SealedProvisioningResponseKind; response: string }> {
  const v3Context = {
    terminalEphemeralPublicKey: params.recipientPublicKey,
    pairingSecret: params.pairing.secret,
    createdAtMs: params.pairing.createdAtMs,
    expiresAtMs: params.pairing.expiresAtMs,
    randomBytes: (length: number) => new Uint8Array(randomBytes(length)),
  } as const;

  // One canonical material decision, owned by the shared protocol resolver.
  // The CLI supplies only its authoritative persisted credential shape as
  // resolver inputs; the requester's token-only capability is compatibility
  // admission below and never a mode authority.
  const variant = resolveTerminalProvisioningVariantV2({
    encryptionMode: params.creds.encryption ? 'e2ee' : 'plain',
    dataKeyMaterialAvailable: params.creds.encryption?.type === 'dataKey',
  });

  if (variant === 'legacyProvisioningUnavailable') {
    // Legacy recovery-secret material has no bound v3 writer. Deriving and
    // issuing the machine key as dataKey would newly mint unbound-equivalent
    // legacy material, which the provisioning contract forbids.
    throw new LegacyTerminalProvisioningUnavailableError();
  }

  if (variant === 'tokenOnly') {
    // A token-only credential provisions token-only material. The requester
    // capability flag is admission only — it can refuse the approval but
    // never selects or downgrades the material.
    if (!params.supportsTokenOnly) {
      throw new TokenOnlyTerminalApprovalUpgradeRequiredError();
    }
    return {
      kind: 'tokenOnly',
      response: Buffer.from(sealTerminalProvisioningV3TokenOnlyPayload(v3Context)).toString('base64'),
    };
  }

  const encryption = params.creds.encryption;
  if (encryption?.type !== 'dataKey') {
    // Unreachable with the resolver inputs above; kept fail-closed for
    // invariant safety rather than inferring material.
    throw new TerminalProvisioningMaterialInvalidError();
  }
  const { publicKey, machineKey } = encryption;
  if (!publicKeyMatchesMachineKey(publicKey, machineKey)) {
    throw new TerminalProvisioningMaterialInvalidError();
  }
  return {
    kind: 'dataKey',
    response: Buffer.from(
      sealTerminalProvisioningV3Payload({ ...v3Context, contentPrivateKey: machineKey }),
    ).toString('base64'),
  };
}

export async function approveTerminalAuthRequest(params: Readonly<{
  publicKey: string;
  pairing?: unknown;
  supportsTokenOnly?: boolean;
  target?: ResolvedHomeTarget;
}>): Promise<void> {
  const recipientPk = decodePublicKey(params.publicKey);
  const targetCredentials = params.target
    ? await resolveCredentialsForApprovalTarget(params.target)
    : null;
  const creds = params.target ? targetCredentials?.credentials ?? null : await readStoredCredentials();
  if (!creds) {
    throw new Error('Not authenticated. Run `happier auth login` first.');
  }
  const pairing = params.pairing === undefined || params.pairing === null
    ? null
    : parseTerminalPairingAuthentication(params.pairing, Date.now());
  if (!pairing) {
    // No unbound writer exists: every current approval seals an authenticated
    // v3 response, so a requester without pairing context cannot be served.
    throw new TerminalPairingContextRequiredError();
  }
  const material = sealProvisioningMaterial({
    recipientPublicKey: recipientPk,
    creds,
    pairing,
    supportsTokenOnly: params.supportsTokenOnly === true,
  });

  const acquired = params.target?.descriptor
    ? await acquireTerminalAuthEnrollmentRuntime(params.target.descriptor, params.target.preferredTransport)
    : null;
  if (acquired && !acquired.ok) {
    throw new Error('Unable to acquire the selected Home enrollment carrier.');
  }
  const runtimeOrigin = acquired?.ok
    ? acquired.runtime.runtimeOrigin
    : params.target?.applicationUrl ?? configuration.apiServerUrl;
  try {
    if (acquired?.ok && params.target) {
      const snapshot = await fetchServerFeaturesSnapshot({ serverUrl: runtimeOrigin, token: creds.token });
      verifyTerminalAuthEnrollmentRuntime({ target: params.target, runtime: acquired.runtime, snapshot });
    }
    if (params.target?.authority === 'manual_url' && targetCredentials?.observedHomeServerIdentityId) {
      const authenticatedSnapshot = await fetchServerFeaturesSnapshot({ serverUrl: runtimeOrigin, token: creds.token });
      const authenticatedIdentity = authenticatedSnapshot.status === 'ready'
        ? normalizeServerIdentityIdCapability(
            authenticatedSnapshot.features.capabilities.serverIdentity?.serverIdentityId,
          )
        : null;
      if (authenticatedIdentity !== targetCredentials.observedHomeServerIdentityId) {
        throw new Error('The explicit remote Home route changed identity before approval. No approval was sent.');
      }
    }
    await axios.post(
    `${runtimeOrigin}/v1/auth/response`,
    {
      publicKey: encodePublicKeyBase64(recipientPk),
      response: material.response,
      responseKind: material.kind,
    },
    { headers: { ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(), Authorization: `Bearer ${creds.token}` } },
    );
  } finally {
    if (acquired?.ok) await acquired.close();
  }
}

async function resolveCredentialsForApprovalTarget(target: ResolvedHomeTarget): Promise<Readonly<{
  credentials: StoredCredentials;
  observedHomeServerIdentityId: string | null;
}> | null> {
  const profileReferences = [
    target.profileId,
    target.homeServerIdentityId,
    target.applicationUrl,
    target.canonicalAuthUrl,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (target.authority !== 'manual_url') {
    for (const profileReference of profileReferences) {
      try {
        const profile = await getServerProfile(profileReference);
        const observedIdentity = profile.homeConnectionDescriptor?.homeServerIdentityId ?? null;
        if (target.homeServerIdentityId && observedIdentity && observedIdentity !== target.homeServerIdentityId) {
          continue;
        }
        const credentials = await readStoredCredentialsForServerId(profile.id);
        if (credentials) return { credentials, observedHomeServerIdentityId: null };
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('not found')) throw error;
      }
    }
  }

  // Released pair-remote URL flags may name a public route for a saved
  // loopback Home. URL coincidence cannot select that Home's bearer. Observe
  // the stable identity at the explicit route first, then bind credentials by
  // that identity. A route that does not resolve to a saved Home fails before
  // any bearer is disclosed.
  if (target.authority === 'manual_url') {
    const snapshot = await fetchServerFeaturesSnapshot({ serverUrl: target.applicationUrl });
    const observedHomeServerIdentityId = snapshot.status === 'ready'
      ? normalizeServerIdentityIdCapability(snapshot.features.capabilities.serverIdentity?.serverIdentityId)
      : null;
    if (!observedHomeServerIdentityId) {
      throw new Error('Unable to verify the explicit remote Home route. No approval was sent.');
    }
    try {
      const profile = await getServerProfile(observedHomeServerIdentityId);
      const credentials = await readStoredCredentialsForServerId(profile.id);
      if (credentials) return { credentials, observedHomeServerIdentityId };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('not found')) throw error;
    }
    throw new Error('The explicit remote Home route does not match a saved Home. No approval was sent.');
  }
  return null;
}
