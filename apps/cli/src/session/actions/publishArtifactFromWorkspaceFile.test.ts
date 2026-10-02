import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePlainArtifactStoredContent } from '@happier-dev/protocol';
import { createAccountArtifactStore } from '@/api/artifacts/accountArtifactStore';
import { publishArtifactFromWorkspaceFile } from './publishArtifactFromWorkspaceFile';

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('axios', () => ({ default: http }));

describe('explicit Artifact publication from the caller workspace', () => {
  let root: string;
  const store = () => createAccountArtifactStore({ credentials: { token: 'test-token', encryption: null },
    getAccountEncryptionMode: async () => 'plain' });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'artifact-publication-'));
    await mkdir(join(root, 'workspace'));
    http.post.mockReset();
    http.post.mockImplementation(async (_url: string, body: { id: string }) => ({ status: 200,
      data: { id: body.id, headerVersion: 1, bodyVersion: 1 } }));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('publishes a completed multi-chunk text copy with host-owned provenance', async () => {
    const text = 'Published output\n'.repeat(40_000);
    await writeFile(join(root, 'workspace', 'result.md'), text);
    await expect(publishArtifactFromWorkspaceFile({ store: store(), caller: {
      sessionId: 'session', machineId: 'machine', directory: join(root, 'workspace'), runId: 'run',
    }, input: { path: 'result.md', title: 'Result', mime: 'text/markdown' } }))
      .resolves.toMatchObject({ revision: { headerVersion: 1, bodyVersion: 1 } });
    const payload = http.post.mock.calls[0]?.[1];
    expect(decodePlainArtifactStoredContent(payload.header)).toMatchObject({ title: 'Result', kind: 'published.v1',
      mime: 'text/markdown', sizeBytes: Buffer.byteLength(text), source: {
        sessionId: 'session', runId: 'run', machineId: 'machine', path: 'result.md',
        sha: createHash('sha256').update(text).digest('hex'),
      } });
    expect(decodePlainArtifactStoredContent(payload.body)).toEqual({ body: text });
  });

  it('refuses parent traversal and symlink escapes before Artifact creation', async () => {
    await writeFile(join(root, 'private.txt'), 'outside');
    await symlink(join(root, 'private.txt'), join(root, 'workspace', 'escape.txt'));
    for (const path of ['../private.txt', 'escape.txt']) {
      await expect(publishArtifactFromWorkspaceFile({ store: store(), caller: {
        sessionId: 'session', machineId: 'machine', directory: join(root, 'workspace'),
      }, input: { path } })).rejects.toMatchObject({ code: 'artifact_source_forbidden' });
    }
    expect(http.post).not.toHaveBeenCalled();
  });

  it.each([{ mime: 'image/png', bytes: Buffer.from([0xff, 0xfe, 0, 42]) },
    { mime: 'application/pdf', bytes: Buffer.from('%PDF-1.7\n1 0 obj\nendobj\n%%EOF') }])
  ('publishes $mime files as private blob content with workspace provenance', async ({ bytes, mime }) => {
    await writeFile(join(root, 'workspace', 'binary'), bytes);
    await expect(publishArtifactFromWorkspaceFile({ store: store(), caller: {
      sessionId: 'session', machineId: 'machine', directory: join(root, 'workspace'),
    }, input: { path: 'binary', mime } })).resolves.toMatchObject({ revision: { bodyVersion: 1 } });
    const payload = http.post.mock.calls[0]?.[1];
    expect(payload.blob.content).toEqual({ t: 'plain', v: bytes.toString('base64') });
    expect(decodePlainArtifactStoredContent(payload.body)).toMatchObject({ body: {
      blobId: payload.blob.blobId, mime, sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    } });
    expect(decodePlainArtifactStoredContent(payload.header)).toMatchObject({ source: { path: 'binary', sessionId: 'session' } });
  });

  it('does not create an Artifact when transfer fails or cancellation precedes it', async () => {
    const caller = { sessionId: 'session', machineId: 'machine', directory: join(root, 'workspace') };
    await expect(publishArtifactFromWorkspaceFile({ store: store(), caller, input: { path: 'missing' } })).rejects.toBeDefined();
    await writeFile(join(root, 'workspace', 'binary'), Buffer.from([0xff, 0xfe]));
    const controller = new AbortController();
    controller.abort();
    await expect(publishArtifactFromWorkspaceFile({ store: store(), caller, input: { path: 'binary' }, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(http.post).not.toHaveBeenCalled();
  });
});
