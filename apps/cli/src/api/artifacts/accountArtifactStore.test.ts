import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519';

import { ARTIFACT_PLAIN_DATA_KEY_MARKER, encodePlainArtifactStoredContent,
  encodeBase64, decodeBase64, signAccountContentKeyBindingV1, computeContentPublicKeyFingerprint,
  sealEncryptedDataKeyEnvelopeV1, openEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { encryptWithDataKey } from '@/api/encryption';

import { createAccountArtifactStore, createCredentialedAccountArtifactStore } from './accountArtifactStore';

const { mockDelete, mockGet, mockPost } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('axios', () => ({ default: { delete: mockDelete, get: mockGet, post: mockPost } }));
vi.mock('@/configuration', () => ({ configuration: { apiServerUrl: 'http://127.0.0.1:24599' } }));

describe('createAccountArtifactStore', () => {
  beforeEach(() => {
    mockDelete.mockReset();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('owns plain Artifact create/read/CAS/delete semantics for typed consumers', async () => {
    const credentials = { token: 'token', encryption: null } as const;
    const store = createAccountArtifactStore({
      credentials,
      getAccountEncryptionMode: async () => 'plain',
    });
    let created: Record<string, unknown> | undefined;
    mockPost.mockImplementationOnce(async (_url: string, body: Record<string, unknown>) => {
      created = body;
      return { status: 200, data: { id: body.id } };
    });

    const result = await store.create({
      artifactId: 'artifact-1',
      header: { kind: 'example.v1' },
      body: 'body',
    });
    expect(result).toEqual({ artifactId: 'artifact-1', revision: { headerVersion: 1, bodyVersion: 1 } });
    expect(created?.dataEncryptionKey).toBe(ARTIFACT_PLAIN_DATA_KEY_MARKER);

    mockGet.mockResolvedValueOnce({ status: 200, data: {
      id: 'artifact-1', header: created?.header, headerVersion: 3,
      body: created?.body, bodyVersion: 4, dataEncryptionKey: created?.dataEncryptionKey,
      seq: 9, createdAt: 1, updatedAt: 2,
      ownerAccountId: 'owner', access: 'owner', encryptionMode: 'plain',
    } });
    await expect(store.read('artifact-1')).resolves.toMatchObject({
      artifactId: 'artifact-1', header: { kind: 'example.v1' }, body: 'body',
      revision: { headerVersion: 3, bodyVersion: 4 },
    });

    mockGet.mockResolvedValueOnce({ status: 200, data: {
      id: 'artifact-1', header: created?.header, headerVersion: 3,
      body: created?.body, bodyVersion: 4, dataEncryptionKey: created?.dataEncryptionKey,
      seq: 9, createdAt: 1, updatedAt: 2,
      ownerAccountId: 'owner', access: 'owner', encryptionMode: 'plain',
    } });
    mockPost.mockResolvedValueOnce({ status: 200, data: { success: false, error: 'version-mismatch' } });
    await expect(store.update({
      artifactId: 'artifact-1', expectedRevision: { headerVersion: 3, bodyVersion: 4 },
      header: { kind: 'example.v1' }, body: 'changed',
    })).resolves.toEqual({ ok: false, errorCode: 'version_mismatch', error: 'artifact_version_mismatch' });

    mockDelete.mockResolvedValueOnce({ status: 200, data: {} });
    await expect(store.delete('artifact-1')).resolves.toEqual({ ok: true });
  });

  it('rejects incomplete current Artifact authority projections on read and list', async () => {
    const store = createAccountArtifactStore({ credentials: { token: 'token', encryption: null },
      getAccountEncryptionMode: async () => 'plain' });
    const row = { id: 'artifact-1', header: encodePlainArtifactStoredContent({ title: 'Private' }),
      body: encodePlainArtifactStoredContent({ body: 'private' }), headerVersion: 1, bodyVersion: 1,
      dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER, seq: 1, createdAt: 1, updatedAt: 1 };
    mockGet.mockResolvedValueOnce({ status: 200, data: row });
    await expect(store.read('artifact-1')).rejects.toMatchObject({ code: 'artifact_encryption_material_unavailable' });
    mockGet.mockResolvedValueOnce({ status: 200, data: [row] });
    await expect(store.list()).rejects.toMatchObject({ code: 'artifact_encryption_material_unavailable' });
  });

  it('creates plain content from Account mode without probing older server support', async () => {
    const store = createCredentialedAccountArtifactStore({ token: 'token', encryption: null });
    mockGet.mockImplementation(async (url: string) => {
      if (!url.endsWith('/v1/account/encryption')) throw new Error('unexpected_server_probe');
      return { status: 200, data: { mode: 'plain', updatedAt: 1 } };
    });
    mockPost.mockResolvedValueOnce({ status: 200, data: { id: 'artifact-1' } });
    await expect(store.create({ artifactId: 'artifact-1', header: { title: 'Note' }, body: 'note' }))
      .resolves.toMatchObject({ artifactId: 'artifact-1' });
  });

  it('rejects malformed Artifact transport versions instead of manufacturing numeric currentness', async () => {
    const store = createAccountArtifactStore({
      credentials: { token: 'token', encryption: null },
      getAccountEncryptionMode: async () => 'plain',
    });
    mockGet.mockResolvedValueOnce({ status: 200, data: {
      id: 'artifact-1',
      header: 'ignored',
      headerVersion: '1',
      body: 'ignored',
      bodyVersion: 1,
      dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
    } });

    await expect(store.read('artifact-1')).resolves.toBeNull();
  });

  it('passes cancellation through Artifact delete without inventing a revision precondition', async () => {
    const store = createAccountArtifactStore({
      credentials: { token: 'token', encryption: null },
      getAccountEncryptionMode: async () => 'plain',
    });
    const signal = new AbortController().signal;
    mockDelete.mockResolvedValueOnce({ status: 200, data: {} });

    await expect(store.delete('artifact-1', { signal })).resolves.toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledWith(expect.stringContaining('/v1/artifacts/artifact-1'), expect.objectContaining({ signal }));
    expect(mockDelete.mock.calls[0]?.[1]).not.toHaveProperty('data');
  });

  it('carries an explicit deletion revision to the atomic Artifact owner and reports conflicts', async () => {
    const store = createAccountArtifactStore({ credentials: { token: 'token', encryption: null },
      getAccountEncryptionMode: async () => 'plain' });
    mockDelete.mockResolvedValueOnce({ status: 409, data: { error: 'version-mismatch' } });
    await expect(store.delete('artifact-1', { expectedRevision: { headerVersion: 2, bodyVersion: 4 } }))
      .resolves.toMatchObject({ ok: false, errorCode: 'version_mismatch' });
    expect(mockDelete).toHaveBeenCalledWith(expect.stringContaining('/v1/artifacts/artifact-1/revision/2/4'), expect.any(Object));
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('refuses plain Artifact content under persisted E2EE Account mode before disclosure or update', async () => {
    const store = createAccountArtifactStore({
      credentials: { token: 'token', encryption: null },
      getAccountEncryptionMode: async () => 'e2ee',
    });
    mockGet.mockResolvedValue({ status: 200, data: {
      id: 'artifact-1', header: encodePlainArtifactStoredContent({ kind: 'role.v1' }),
      body: encodePlainArtifactStoredContent({ body: 'private role' }),
      headerVersion: 1, bodyVersion: 1, dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
      seq: 1, createdAt: 1, updatedAt: 1,
      ownerAccountId: 'owner', access: 'owner', encryptionMode: 'e2ee',
    } });
    await expect(store.read('artifact-1')).rejects.toMatchObject({ code: 'artifact_account_mode_mismatch' });
    await expect(store.update({ artifactId: 'artifact-1', expectedRevision: { headerVersion: 1, bodyVersion: 1 },
      header: { kind: 'role.v1' }, body: 'changed' })).rejects.toMatchObject({ code: 'artifact_account_mode_mismatch' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('uses the resource owner mode and retains shared access when a keyless viewer opens a plain grant', async () => {
    const store = createAccountArtifactStore({ credentials: { token: 'token', encryption: null },
      getAccountEncryptionMode: async () => 'e2ee' });
    const row = { id: 'shared-1', ownerAccountId: 'other-owner', access: 'edit', encryptionMode: 'plain',
      header: encodePlainArtifactStoredContent({ kind: 'workflow-definition.v1' }), body: encodePlainArtifactStoredContent({ body: 'shared' }),
      headerVersion: 1, bodyVersion: 1, dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER, seq: 1, createdAt: 1, updatedAt: 1 };
    mockGet.mockResolvedValueOnce({ status: 200, data: row });
    await expect(store.read('shared-1')).resolves.toMatchObject({ artifactId: 'shared-1', ownerAccountId: 'other-owner', access: 'edit', body: 'shared' });
    mockGet.mockResolvedValueOnce({ status: 200, data: [row] });
    await expect(store.list()).resolves.toMatchObject({ items: [{ artifactId: 'shared-1', ownerAccountId: 'other-owner', access: 'edit' }] });
  });

  it('opens actual 0.2 Artifact writer bytes through current authenticated read and list projections', async () => {
    // Produced by the clean sibling at 17ba05df68d4d3d4cad1c1241b58e63805db37ed:
    // apps/cli/src/api/encryption.ts encryptWithDataKeyAndNonce and Protocol's
    // serializedJsonValue.ts, boxBundle.ts, encryptedDataKeyEnvelopeV1.ts.
    const dataEncryptionKey = 'AKwBsiCehjVPuFMje13g9PqxPH/L9DOmHAGTaWF/7PELBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEFp2vL9F4qtFp456Ip/CLBk3sduq0hPJdydpvcpyDvxcC/u5pBQ8RJx6w/6IzrX2B';
    const row = { id: 'retained-0.2', ownerAccountId: 'owner', access: 'owner', encryptionMode: 'e2ee',
      header: 'AAEBAQEBAQEBAQEBAQ3D1uj43px+uLGuchVFGVDEkm6RfN1IfDZnIg4T0WCK4Ih8wul2qaIqCzhu40TM8/10hyBxnIk+zjfCKuxZp+HAkzJVLPYUHU1qOQ7EUGS6LvI+dmsnbtYcvYynDW3Ibd9W',
      body: 'AAICAgICAgICAgICAmGWtlgzisVXczX05IfwpRumehKfFPxZ26hckiVv9O1CoOzi80adELG3z4GDttWiQ8EdZyWk1R/XZ7VZ/aIRpitcie/cum50+I58YJfP2KxJGI0nuiw2TLYejO/u6/bxTVjAoaQIdw==',
      dataEncryptionKey, headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 };
    const store = createAccountArtifactStore({ credentials: { token: 'token', encryption: { type: 'dataKey',
      publicKey: decodeBase64('Xf7dO2vUf2+ijuFdlp1bsOpTd01Ii9r53xxuASSz7yI='), machineKey: new Uint8Array(32).fill(3) } },
      getAccountEncryptionMode: async () => 'e2ee' });
    mockGet.mockImplementation(async (url: string) => ({ status: 200, data: url.endsWith('/recipients')
      ? { artifactId: row.id, ownerAccountId: 'owner', access: 'owner', encryptionMode: 'e2ee',
        dataEncryptionKey, callerDataEncryptionKey: dataEncryptionKey, recipients: [] }
      : url.endsWith('/v1/artifacts') ? [row] : row }));
    await expect(store.read(row.id)).resolves.toMatchObject({ header: { title: '0.2 note' }, body: 'retained note', access: 'owner' });
    await expect(store.list()).resolves.toMatchObject({ items: [{ header: { title: '0.2 note' }, ownerAccountId: 'owner', access: 'owner' }] });
  });

  it('prepares a late Team recipient on a key-holding editor open through the fenced envelope writer', async () => {
    const viewerSecret = randomBytes(32);
    const viewerPublic = x25519.getPublicKey(viewerSecret);
    const recipientSecret = randomBytes(32);
    const recipientPublic = x25519.getPublicKey(recipientSecret);
    const signingSecret = randomBytes(32);
    const signingPublic = ed25519.getPublicKey(signingSecret);
    const dataKey = randomBytes(32);
    const callerEnvelope = encodeBase64(sealEncryptedDataKeyEnvelopeV1({ dataKey, recipientPublicKey: viewerPublic, randomBytes }));
    const ownerEnvelope = encodeBase64(sealEncryptedDataKeyEnvelopeV1({ dataKey, recipientPublicKey: recipientPublic, randomBytes }));
    const fingerprint = computeContentPublicKeyFingerprint(recipientPublic);
    const store = createAccountArtifactStore({ credentials: { token: 'token', encryption: { type: 'dataKey', publicKey: viewerPublic, machineKey: viewerSecret } },
      getAccountEncryptionMode: async () => 'e2ee' });
    mockGet.mockImplementation(async (url: string) => url.endsWith('/recipients') ? { status: 200, data: {
      artifactId: 'shared-1', ownerAccountId: 'owner', access: 'edit', encryptionMode: 'e2ee', dataEncryptionKey: ownerEnvelope,
      callerDataEncryptionKey: callerEnvelope, recipients: [{ recipientAccountId: 'late-member', contentPublicKeyFingerprint: fingerprint,
        encryptedDataKey: null, recipientContentPublicKeyFingerprint: null, contentKey: { status: 'available',
          accountSigningPublicKey: Buffer.from(signingPublic).toString('hex'), contentPublicKey: encodeBase64(recipientPublic),
          contentPublicKeySignature: encodeBase64(signAccountContentKeyBindingV1({ accountSigningSecretKey: new Uint8Array([...signingSecret, ...signingPublic]), contentPublicKey: recipientPublic })) } }],
    } } : { status: 200, data: { id: 'shared-1', ownerAccountId: 'owner', access: 'edit', encryptionMode: 'e2ee',
      header: encodeBase64(encryptWithDataKey({ kind: 'role.v1' }, dataKey)), body: encodeBase64(encryptWithDataKey({ body: 'role' }, dataKey)),
      dataEncryptionKey: callerEnvelope, headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 } });
    mockPost.mockResolvedValue({ status: 200, data: { appliedRecipientAccountIds: ['late-member'], skippedRecipientAccountIds: [] } });
    await expect(store.read('shared-1')).resolves.toMatchObject({ body: 'role', access: 'edit' });
    const request = mockPost.mock.calls[0]?.[1];
    expect(request.expectedDataEncryptionKey).toBe(ownerEnvelope);
    expect(request.recipientKeyEnvelopes).toHaveLength(1);
    expect(openEncryptedDataKeyEnvelopeV1({ envelope: decodeBase64(request.recipientKeyEnvelopes[0].encryptedDataKey), recipientSecretKeyOrSeed: recipientSecret })).toEqual(new Uint8Array(dataKey));
  });
});
