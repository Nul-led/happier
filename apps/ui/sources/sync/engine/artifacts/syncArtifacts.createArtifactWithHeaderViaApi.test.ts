import { describe, expect, it, vi } from 'vitest';

import { Encryption } from '@/sync/encryption/encryption';
import type { ArtifactDataKeyCache } from './syncArtifacts';
import type { ArtifactCreateRequest, DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

describe('createArtifactWithHeaderViaApi', () => {
  it('preserves passthrough header metadata in local decrypted artifacts', async () => {
    const encryption = await Encryption.create(new Uint8Array(32).fill(9));
    const artifactDataKeys: ArtifactDataKeyCache = new Map();
    const added: DecryptedArtifact[] = [];
    // Captured HTTP is the external boundary; mode checks, API and crypto stay real.
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/v1/account/encryption') return new Response(JSON.stringify({ mode: 'e2ee', updatedAt: 0 }));
      expect(path).toBe('/v1/artifacts');
      const input = JSON.parse(String(init?.body)) as ArtifactCreateRequest;
      return new Response(JSON.stringify({ ...input, ownerAccountId: 'owner', access: 'owner', encryptionMode: 'e2ee',
        headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 0, updatedAt: 0 }));
    });

    const { createArtifactWithHeaderViaApi } = await import('./syncArtifacts');

    const artifactId = await createArtifactWithHeaderViaApi({
      credentials: { token: 't', secret: 's' },
      header: { v: 1, kind: 'approval_request.v1', title: 'Approve export', approvalStatus: 'open' },
      body: '{"v":1}',
      encryption,
      artifactDataKeys,
      request,
      addArtifact: (artifact) => added.push(artifact),
    });

    expect(typeof artifactId).toBe('string');
    expect(added).toHaveLength(1);
    expect(added[0]?.header?.kind).toBe('approval_request.v1');
    expect(added[0]?.header?.approvalStatus).toBe('open');
    expect(added[0]?.title).toBe('Approve export');
    expect(added[0]).toMatchObject({ ownerAccountId: 'owner', access: 'owner' });
  });
});
