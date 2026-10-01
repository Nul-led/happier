import { describe, expect, it, vi } from 'vitest';

import { createAuthoringMemoryCipher } from '@/sync/encryption/authoringMemoryEncryption';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';
import { fetchAccountEncryptionAuthoringMemoryMigrationCandidates } from './fetchAccountEncryptionAuthoringMemoryMigrationCandidates';

const randomBytes = (length: number) => new Uint8Array(length);
const encryptedCredentials = { token: 't', secret: Buffer.from(new Uint8Array(32).fill(31)).toString('base64url') };

describe('fetchAccountEncryptionAuthoringMemoryMigrationCandidates', () => {
  it.each(['plain', 'e2ee'] as const)('opens the authoritative active rows and excludes tombstones (%s)', async (mode) => {
    const credentials = mode === 'plain' ? { token: 't' } : encryptedCredentials;
    const cipher = createAuthoringMemoryCipher({
      mode, material: mode === 'plain' ? null : resolveAccountScopedCryptoMaterialFromCredentials(credentials), randomBytes,
    });
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ rows: [
      { key: 'lastUsedProfile', revision: 4, content: cipher.seal('lastUsedProfile', 'profile-a') },
      { key: 'recentMachinePaths', revision: 2, content: null },
    ] }));
    await expect(fetchAccountEncryptionAuthoringMemoryMigrationCandidates({ credentials, mode, request }))
      .resolves.toEqual([{ key: 'lastUsedProfile', revision: 4, value: 'profile-a' }]);
    expect(request.mock.calls[0]?.[0]).toBe('/v1/account/authoring-memory');
  });

  it('fails closed when E2EE material is absent, the row has the wrong mode, or its key binding is wrong', async () => {
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => Response.json({ rows: [] }));
    await expect(fetchAccountEncryptionAuthoringMemoryMigrationCandidates({ credentials: { token: 't' }, mode: 'e2ee', request })).rejects.toThrow();
    const cipher = createAuthoringMemoryCipher({ mode: 'e2ee', material: resolveAccountScopedCryptoMaterialFromCredentials(encryptedCredentials), randomBytes });
    for (const content of [{ t: 'plain', v: 'profile-a' }, cipher.seal('lastUsedProfile', 'profile-a')]) {
      request.mockImplementation(async () => Response.json({ rows: [{ key: 'recentMachinePaths', revision: 2, content }] }));
      await expect(fetchAccountEncryptionAuthoringMemoryMigrationCandidates({ credentials: encryptedCredentials, mode: 'e2ee', request })).rejects.toThrow();
    }
  });
});
