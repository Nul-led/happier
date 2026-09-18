import type { StoredCredentials } from '@/persistence';

import {
  deriveAccountMachineKeyFromRecoverySecret,
  encodeBase64 as encodeProtocolBase64,
  isPlainMachineDataKeyMarker,
  openEncryptedDataKeyEnvelopeV1,
  resolvePublishedMachineDataEncryptionKeyV1,
  type ExpectedRunnerMachineContentKeyBindingV1,
} from '@happier-dev/protocol';
import tweetnacl from 'tweetnacl';
import { decodeJwtPayload } from '@/cloud/decodeJwtPayload';
import { decodeBase64, encodeBase64 } from '../encryption';
import {
  createMachineContentCodec,
  type MachineContentCodec,
  type MachineContentEncryptionContext,
} from './machineStoredContent';

export class MachineContentKeyUnavailableError extends Error {
  readonly code = 'machine_content_key_unavailable' as const;

  constructor(readonly machineId: string) {
    super(`Machine ${machineId} published a data encryption key this account cannot open`);
    this.name = 'MachineContentKeyUnavailableError';
  }
}

type PublishedMachineContentInput = Readonly<{
  credentials: StoredCredentials;
  machineId: string;
  publishedDataEncryptionKey: unknown;
  machineKind?: 'persistent' | 'ephemeral_session_runner';
  installationId?: string | null;
  runnerContentKeyBinding?: unknown;
  /** Independently trusted scope. The local Legacy credential supplies the trusted signer. */
  expectedRunnerMachineContentKeyBinding?: Omit<
    ExpectedRunnerMachineContentKeyBindingV1,
    'accountSigningPublicKeyBase64Url'
  >;
}>;

export function resolveLegacyExpectedRunnerMachineContentKeyBinding(params: Readonly<{
  credentials: StoredCredentials;
  homeServerIdentityId: string;
  machineId: string;
}>): Omit<ExpectedRunnerMachineContentKeyBindingV1, 'accountSigningPublicKeyBase64Url'> | null {
  const homeServerIdentityId = params.homeServerIdentityId.trim();
  const machineId = params.machineId.trim();
  const accountId = decodeJwtPayload(params.credentials.token)?.sub;
  if (
    !homeServerIdentityId
    || !machineId
    || typeof accountId !== 'string'
    || !accountId.trim()
    || params.credentials.encryption?.type !== 'legacy'
  ) return null;
  return {
    homeServerIdentityId,
    creatorAccountId: accountId.trim(),
    machineId,
  };
}

/**
 * A present Machine envelope names its content key. Account material only opens
 * that envelope; neither failed opening nor malformed presence permits fallback.
 * Genuine null/absence retains the released credential-specific Machine reader.
 */
export function resolvePublishedMachineEncryptionContext(
  params: PublishedMachineContentInput,
): MachineContentEncryptionContext {
  const published = params.publishedDataEncryptionKey;
  const encryption = params.credentials.encryption;
  const accountContentSecret = encryption?.type === 'dataKey'
    ? encryption.machineKey
    : encryption?.type === 'legacy'
      ? deriveAccountMachineKeyFromRecoverySecret(encryption.secret)
      : null;
  const openedDataEncryptionKey =
    typeof published === 'string'
    && !isPlainMachineDataKeyMarker(published)
    && accountContentSecret
      ? openPublishedEnvelope(published, accountContentSecret)
      : null;
  const resolution = resolvePublishedMachineDataEncryptionKeyV1({
    machine: {
      id: params.machineId,
      kind: params.machineKind,
      installationId: params.installationId,
      dataEncryptionKey: published,
      runnerContentKeyBinding: params.runnerContentKeyBinding,
    },
    openedDataEncryptionKey,
    expectedAccountMode: encryption ? 'e2ee' : 'plain',
    ...(params.expectedRunnerMachineContentKeyBinding && encryption?.type === 'legacy'
      ? {
          expectedRunnerBinding: {
            ...params.expectedRunnerMachineContentKeyBinding,
            accountSigningPublicKeyBase64Url: encodeProtocolBase64(
              tweetnacl.sign.keyPair.fromSeed(encryption.secret).publicKey,
              'base64url',
            ),
          },
        }
      : {}),
  });
  if (resolution.status === 'plain') return { encryptionMode: 'plain' };
  if (resolution.status === 'legacy' && encryption) {
    return encryption.type === 'legacy'
      ? { encryptionMode: 'e2ee', encryptionKey: encryption.secret, encryptionVariant: 'legacy' }
      : { encryptionMode: 'e2ee', encryptionKey: encryption.machineKey, encryptionVariant: 'dataKey' };
  }
  if (resolution.status === 'e2ee') {
    return {
      encryptionMode: 'e2ee',
      encryptionKey: resolution.dataKey,
      encryptionVariant: 'dataKey',
    };
  }
  throw new MachineContentKeyUnavailableError(params.machineId);
}

export function resolvePublishedMachineContentCodec(params: PublishedMachineContentInput): MachineContentCodec {
  return createMachineContentCodec(resolvePublishedMachineEncryptionContext(params));
}

function openPublishedEnvelope(
  published: string,
  accountContentSecret: Uint8Array,
): Uint8Array | null {
  try {
    const envelope = decodeBase64(published);
    if (encodeBase64(envelope) !== published) return null;
    return openEncryptedDataKeyEnvelopeV1({
      envelope,
      recipientSecretKeyOrSeed: accountContentSecret,
    });
  } catch {
    return null;
  }
}
