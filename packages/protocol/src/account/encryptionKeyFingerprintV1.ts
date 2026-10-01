import { sha256 } from '@noble/hashes/sha2';
import { hexToBytes } from '@noble/hashes/utils';

import { encodeBase64 } from '../crypto/base64.js';
import {
  ContentPublicKeyFingerprintSchema,
  type ContentPublicKeyFingerprint,
} from '../machines/identity/contentPublicKeyFingerprint.js';

const ACCOUNT_ENCRYPTION_MIGRATE_KEY_FINGERPRINT_V1_PREFIX = 'aemk1_' as const;

export function computeAccountEncryptionMigrateKeyFingerprintV1(
  publicKey: Uint8Array,
): string {
  return `${ACCOUNT_ENCRYPTION_MIGRATE_KEY_FINGERPRINT_V1_PREFIX}${encodeBase64(sha256(publicKey), 'base64url')}`;
}

export function convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(
  fingerprint: ContentPublicKeyFingerprint,
): string {
  const canonical = ContentPublicKeyFingerprintSchema.parse(fingerprint);
  const digestHex = canonical.slice(canonical.indexOf(':') + 1);
  return `${ACCOUNT_ENCRYPTION_MIGRATE_KEY_FINGERPRINT_V1_PREFIX}${encodeBase64(hexToBytes(digestHex), 'base64url')}`;
}
