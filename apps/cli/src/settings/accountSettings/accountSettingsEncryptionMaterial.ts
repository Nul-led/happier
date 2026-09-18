import type { Credentials, StoredCredentials } from '@/persistence';
import tweetnacl from 'tweetnacl';

export const ACCOUNT_SETTINGS_ENCRYPTION_MATERIAL_UNAVAILABLE_ERROR_CODE =
  'ACCOUNT_SETTINGS_ENCRYPTION_MATERIAL_UNAVAILABLE' as const;

export class AccountSettingsEncryptionMaterialUnavailableError extends Error {
  readonly code = ACCOUNT_SETTINGS_ENCRYPTION_MATERIAL_UNAVAILABLE_ERROR_CODE;

  constructor(
    message = 'Account settings are encrypted and require account encryption material on this device.',
  ) {
    super(message);
    this.name = 'AccountSettingsEncryptionMaterialUnavailableError';
  }
}

export function requireAccountSettingsEncryptionCredentials(
  credentials: StoredCredentials,
): Credentials {
  if (!credentials.encryption) {
    throw new AccountSettingsEncryptionMaterialUnavailableError();
  }
  return credentials;
}

export function hasUsableAccountSettingsEncryptionMaterial(
  credentials: StoredCredentials,
): credentials is Credentials {
  const encryption = credentials.encryption;
  if (!encryption) return false;
  if (encryption.type === 'legacy') return encryption.secret.length === 32;
  if (encryption.machineKey.length !== 32 || encryption.publicKey.length !== 32) return false;
  const derivedPublicKey = tweetnacl.box.keyPair.fromSecretKey(encryption.machineKey).publicKey;
  return derivedPublicKey.every((byte, index) => byte === encryption.publicKey[index]);
}

export function isAccountSettingsEncryptionMaterialUnavailableError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === ACCOUNT_SETTINGS_ENCRYPTION_MATERIAL_UNAVAILABLE_ERROR_CODE,
  );
}
