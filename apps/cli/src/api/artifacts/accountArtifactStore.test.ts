import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ARTIFACT_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';

import { createAccountArtifactStore } from './accountArtifactStore';

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
      requirePlainWriteCompatibility: async () => undefined,
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
    } });
    await expect(store.read('artifact-1')).resolves.toMatchObject({
      artifactId: 'artifact-1', header: { kind: 'example.v1' }, body: 'body',
      revision: { headerVersion: 3, bodyVersion: 4 },
    });

    mockGet.mockResolvedValueOnce({ status: 200, data: {
      id: 'artifact-1', header: created?.header, headerVersion: 3,
      body: created?.body, bodyVersion: 4, dataEncryptionKey: created?.dataEncryptionKey,
      seq: 9, createdAt: 1, updatedAt: 2,
    } });
    mockPost.mockResolvedValueOnce({ status: 200, data: { success: false, error: 'version-mismatch' } });
    await expect(store.update({
      artifactId: 'artifact-1', expectedRevision: { headerVersion: 3, bodyVersion: 4 },
      header: { kind: 'example.v1' }, body: 'changed',
    })).resolves.toEqual({ ok: false, errorCode: 'version_mismatch', error: 'artifact_version_mismatch' });

    mockDelete.mockResolvedValueOnce({ status: 200, data: {} });
    await expect(store.delete('artifact-1')).resolves.toEqual({ ok: true });
  });

  it('rejects malformed Artifact transport versions instead of manufacturing numeric currentness', async () => {
    const store = createAccountArtifactStore({
      credentials: { token: 'token', encryption: null },
      getAccountEncryptionMode: async () => 'plain',
      requirePlainWriteCompatibility: async () => undefined,
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
      requirePlainWriteCompatibility: async () => undefined,
    });
    const signal = new AbortController().signal;
    mockDelete.mockResolvedValueOnce({ status: 200, data: {} });

    await expect(store.delete('artifact-1', { signal })).resolves.toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledWith(expect.stringContaining('/v1/artifacts/artifact-1'), expect.objectContaining({ signal }));
    expect(mockDelete.mock.calls[0]?.[1]).not.toHaveProperty('data');
  });
});
