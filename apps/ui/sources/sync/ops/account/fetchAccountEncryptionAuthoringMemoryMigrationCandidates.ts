import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { createApiAuthoringMemoryTransport } from '@/sync/api/account/apiAuthoringMemory';
import { createAuthoringMemoryCipher } from '@/sync/encryption/authoringMemoryEncryption';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import { getRandomBytes } from '@/platform/cryptoRandom';
import type { AccountEncryptionAuthoringMemoryMigrationCandidate } from './buildAccountEncryptionAuthoringMemoryDirective';

/** Reads the complete census at the captured Home rather than a local projection. */
export async function fetchAccountEncryptionAuthoringMemoryMigrationCandidates(params: Readonly<{
  credentials: AuthCredentials;
  mode: 'plain' | 'e2ee';
  request(path: string, init?: RequestInit): Promise<Response>;
}>): Promise<readonly AccountEncryptionAuthoringMemoryMigrationCandidate[]> {
  const cipher = createAuthoringMemoryCipher({
    mode: params.mode,
    material: params.mode === 'plain' ? null : resolveAccountScopedCryptoMaterialFromCredentials(params.credentials),
    randomBytes: getRandomBytes,
  });
  const { rows } = await createApiAuthoringMemoryTransport({ request: params.request }).list();
  return rows.flatMap((row) => row.content === null ? [] : [{
    key: row.key, revision: row.revision, value: cipher.open(row.key, row.content),
  }]);
}
