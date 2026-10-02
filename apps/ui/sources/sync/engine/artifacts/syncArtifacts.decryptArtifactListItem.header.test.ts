import { describe, expect, it } from 'vitest';

import { encodeBase64 } from '@/encryption/base64';
import { Encryption } from '@/sync/encryption/encryption';
import { ArtifactEncryption } from '@/sync/encryption/artifactEncryption';
import type { Artifact } from '@/sync/domains/artifacts/artifactTypes';
import { ARTIFACT_PLAIN_DATA_KEY_MARKER, encodePlainArtifactStoredContent } from '@happier-dev/protocol';

import { applySocketArtifactUpdate, decryptArtifactListItem, decryptArtifactWithBody, decryptSocketNewArtifactUpdate } from './syncArtifacts';

describe('decryptArtifactListItem (artifact headers)', () => {
  it.each(['plain', 'e2ee'] as const)('refuses malformed and specialized binary %s bodies across full and socket reads', async (mode) => {
    const encryption = mode === 'plain' ? null : await Encryption.create(new Uint8Array(32).fill(11));
    const key = new Uint8Array(32).fill(12);
    const codec = new ArtifactEncryption(key);
    const envelope = encryption ? encodeBase64(await encryption.encryptEncryptionKey(key)) : ARTIFACT_PLAIN_DATA_KEY_MARKER;
    const reference = { blobId: 'e791014a-ec77-4a6b-a5d6-e210fe841561', mime: 'image/png', sizeBytes: 0, sha256: '0'.repeat(64) };
    for (const input of [{ kind: 'artifact.legacy', body: { ...reference, sizeBytes: -1 } },
      { kind: 'approval_request.v1', body: reference }]) {
      const header = { kind: input.kind, title: 'Invalid content' };
      // Malformed remote storage is deliberately encoded without the body schema.
      const stored = mode === 'plain' ? encodePlainArtifactStoredContent({ body: input.body }) : await codec.encryptHeader({ body: input.body });
      const artifact: Artifact = { id: 'invalid', ownerAccountId: 'owner', access: 'owner', encryptionMode: mode,
        header: mode === 'plain' ? encodePlainArtifactStoredContent(header) : await codec.encryptHeader(header),
        body: stored, dataEncryptionKey: envelope, headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 };
      const artifactDataKeys = new Map();
      const full = await decryptArtifactWithBody({ artifact, encryption, artifactDataKeys });
      const socket = await decryptSocketNewArtifactUpdate({ artifactId: artifact.id, ...artifact, encryption, artifactDataKeys });
      for (const row of [full, socket]) expect(row).toMatchObject({ isDecrypted: false, availability: { kind: 'locked' } });
      const validStored = mode === 'plain' ? encodePlainArtifactStoredContent({ body: 'prior content' }) : await codec.encryptBody({ body: 'prior content' });
      const existing = await decryptArtifactWithBody({ artifact: { ...artifact, body: validStored }, encryption, artifactDataKeys });
      if (!existing?.isDecrypted) throw new Error('Valid fixture must open');
      const updated = await applySocketArtifactUpdate({ existingArtifact: existing, createdAt: 2, dataEncryptionKey: mode === 'plain' ? null : key,
        body: { value: stored, version: 2 } });
      expect(updated).toMatchObject({ isDecrypted: false, availability: { kind: 'locked' } });
    }
  });

  it('preserves decrypted header metadata on the returned artifact', async () => {
    const masterSecret = new Uint8Array(32).fill(1);
    const encryption = await Encryption.create(masterSecret);

    const artifactKey = new Uint8Array(32).fill(2);
    const encryptedKeyEnvelope = await encryption.encryptEncryptionKey(artifactKey);

    const artifactEncryption = new ArtifactEncryption(artifactKey);
    const headerPayload = {
      v: 1,
      kind: 'approval_request.v1',
      title: 'Approval: do thing',
      approvalStatus: 'open',
      draft: false,
    };
    const encryptedHeader = await artifactEncryption.encryptHeader(headerPayload);

    const artifact: Artifact = {
      ownerAccountId: 'owner', access: 'owner', encryptionMode: 'e2ee',
      id: 'a1',
      header: encryptedHeader,
      headerVersion: 1,
      body: undefined,
      bodyVersion: undefined,
      dataEncryptionKey: encodeBase64(encryptedKeyEnvelope, 'base64'),
      seq: 1,
      createdAt: 10,
      updatedAt: 20,
    };

    const decrypted = await decryptArtifactListItem({
      artifact,
      encryption,
      artifactDataKeys: new Map(),
    });

    expect(decrypted?.title).toBe('Approval: do thing');
    expect(decrypted?.header).toMatchObject({
      kind: 'approval_request.v1',
      approvalStatus: 'open',
    });
  });

  it.each(['plain', 'e2ee'] as const)('keeps raw %s metadata separate from presentation on full, list and socket reads', async (mode) => {
    const encryption = mode === 'plain' ? null : await Encryption.create(new Uint8Array(32).fill(11));
    const key = new Uint8Array(32).fill(12);
    const codec = new ArtifactEncryption(key);
    const metadata = { kind: 'workflow-definition.v1', definitionId: 'workflow',
      revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: '  Workflow  ' } };
    const storedHeader = mode === 'plain' ? encodePlainArtifactStoredContent(metadata) : await codec.encryptHeader(metadata);
    const storedBody = mode === 'plain' ? encodePlainArtifactStoredContent({ body: 'body' }) : await codec.encryptBody({ body: 'body' });
    const envelope = encryption ? encodeBase64(await encryption.encryptEncryptionKey(key)) : ARTIFACT_PLAIN_DATA_KEY_MARKER;
    const artifact: Artifact = { id: 'workflow', ownerAccountId: 'owner', access: 'owner', encryptionMode: mode,
      header: storedHeader, body: storedBody, dataEncryptionKey: envelope, headerVersion: 1, bodyVersion: 1,
      seq: 1, createdAt: 1, updatedAt: 1 };
    const artifactDataKeys = new Map();
    const list = await decryptArtifactListItem({ artifact, encryption, artifactDataKeys });
    const full = await decryptArtifactWithBody({ artifact, encryption, artifactDataKeys });
    const socket = await decryptSocketNewArtifactUpdate({ artifactId: artifact.id, ...artifact, encryption, artifactDataKeys });
    for (const row of [list, full, socket]) {
      expect(row?.rawHeader).toEqual(metadata);
      expect(row?.header).toMatchObject({ title: null, v: 1 });
    }
    if (!full) throw new Error('Fixture must open');
    const nextMetadata = { ...metadata, revision: { headerVersion: 2, bodyVersion: 1 } };
    const nextHeader = mode === 'plain' ? encodePlainArtifactStoredContent(nextMetadata) : await codec.encryptHeader(nextMetadata);
    const updated = await applySocketArtifactUpdate({ existingArtifact: full, createdAt: 2,
      dataEncryptionKey: mode === 'plain' ? null : key, header: { version: 2, value: nextHeader } });
    expect(updated.rawHeader).toEqual(nextMetadata);
    expect(updated.body).toBe('body');
  });
});
