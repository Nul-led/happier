import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActionExecutor, decodePlainArtifactStoredContent, encodePlainArtifactStoredContent, ARTIFACT_PLAIN_DATA_KEY_MARKER, type ArtifactPublicLinkIssuedV1 } from '@happier-dev/protocol';
import * as persistence from '@/persistence';
import { createCliActionDeps } from './createCliActionDeps';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('axios', () => ({ default: http }));

describe('Account Artifact Actions through the real CLI host composition', () => {
  let root: string;
  const artifactId = '11111111-1111-4111-8111-111111111111';
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cli-artifact-actions-'));
    await mkdir(join(root, 'workspace'));
    http.get.mockReset(); http.post.mockReset(); http.delete.mockReset();
    // Machine identity is persistent machine-local configuration, a system boundary.
    vi.spyOn(persistence, 'readSettings').mockResolvedValue({ schemaVersion: persistence.SUPPORTED_SCHEMA_VERSION,
      onboardingCompleted: true, machineId: 'local-machine' });
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
  function deps(onPublicLinkIssued?: (link: ArtifactPublicLinkIssuedV1) => void) {
    return createCliActionDeps({ token: 'token', credentials: { token: 'token', encryption: null },
      onPublicLinkIssued,
      sessionId: 'session', mode: 'plain', ctx: null,
      rawSession: { machineId: 'local-machine', path: join(root, 'workspace'),
        metadata: JSON.stringify({ machineId: 'local-machine', path: join(root, 'workspace') }) } });
  }
  it('lists and revokes owner public links and refuses creation without a local delivery consumer', async () => {
    const publicShare = { id: 'share-1', subject: { kind: 'artifact', id: artifactId }, expiresAt: null, maxUses: null,
      useCount: 0, isConsentRequired: false, createdAt: 1, updatedAt: 1, keyDerivation: 'fragment_v1' };
    http.get.mockImplementation(async (url: string) => ({ status: 200, data: url.includes('/v1/public-shares') ? { publicShares: [publicShare] }
      : { id: artifactId, header: encodePlainArtifactStoredContent({ title: 'Note' }),
        body: encodePlainArtifactStoredContent({ body: 'note' }), dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER, ownerAccountId: 'owner', access: 'owner', encryptionMode: 'plain',
        headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 } }));
    http.delete.mockResolvedValue({ status: 200, data: { success: true } });
    const host = deps();
    const context = { surface: 'cli' as const };
    await expect(host.artifactAction?.({ actionId: 'artifact.public_link.list', input: { artifactId }, context })).resolves.toEqual({ publicShares: [publicShare] });
    await expect(host.artifactAction?.({ actionId: 'artifact.public_link.revoke', input: { artifactId, shareId: 'share-1' }, context })).resolves.toMatchObject({ revoked: true });
    await expect(host.artifactAction?.({ actionId: 'artifact.public_link.create', input: { artifactId }, context })).resolves.toMatchObject({ ok: false, errorCode: 'public_link_custody_unavailable' });
    expect(http.post).not.toHaveBeenCalled();
  });
  it('delivers a created Artifact fragment link only to the explicit local host callback', async () => {
    const issued: ArtifactPublicLinkIssuedV1[] = [];
    const publicShare = { id: 'share-1', subject: { kind: 'artifact', id: artifactId }, expiresAt: null, maxUses: null,
      useCount: 0, isConsentRequired: false, createdAt: 1, updatedAt: 1, keyDerivation: 'fragment_v1' };
    http.get.mockResolvedValue({ status: 200, data: { id: artifactId, header: encodePlainArtifactStoredContent({ title: 'Note' }),
      body: encodePlainArtifactStoredContent({ body: 'note' }), dataEncryptionKey: ARTIFACT_PLAIN_DATA_KEY_MARKER,
      ownerAccountId: 'owner', access: 'owner', encryptionMode: 'plain', headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 } });
    http.post.mockResolvedValue({ status: 200, data: { publicShare, isolatedOrigin: 'https://public.example.test' } });
    const executor = createActionExecutor({ ...deps(link => { issued.push(link); }), isActionApprovalRequired: () => false });
    const result = await executor.execute('artifact.public_link.create', { artifactId },
      { surface: 'cli', presentUserConfirmation: { actionId: 'artifact.public_link.create' } });
    expect(result).toEqual({ ok: true, result: { publicShare } });
    expect(issued).toHaveLength(1);
    expect(issued[0]?.url).toBe(`https://public.example.test/s/${issued[0]?.lookupId}#k=${issued[0]?.secret}`);
    expect(JSON.stringify({ physical: http.post.mock.calls[0]?.[1], result })).not.toContain(issued[0]?.secret);
    expect(http.post.mock.calls[0]?.[1]).not.toHaveProperty('encryptedDataKey');
  });
  it('creates and reads Account content through the Action executor and existing mode-aware store', async () => {
    let row: unknown;
    http.get.mockImplementation(async (url: string) => ({ status: 200,
      data: url.endsWith('/v1/account/encryption') ? { mode: 'plain', updatedAt: 1 } : row }));
    http.post.mockImplementation(async (_url: string, value: Record<string, unknown>) => {
      row = { ...value, ownerAccountId: 'owner', access: 'owner', encryptionMode: 'plain',
        headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 };
      return { status: 200, data: { id: value.id, headerVersion: 1, bodyVersion: 1 } };
    });
    const executor = createActionExecutor({ ...deps(), isActionApprovalRequired: () => false });
    await expect(executor.execute('artifact.create', { artifactId, header: { title: 'Note', kind: 'published.v1' }, body: 'note' },
      { surface: 'cli', presentUserConfirmation: { actionId: 'artifact.create' } })).resolves.toMatchObject({ ok: true,
        result: { artifactId, revision: { headerVersion: 1, bodyVersion: 1 } } });
    await expect(executor.execute('artifact.get', { artifactId }, { surface: 'cli' })).resolves.toMatchObject({ ok: true,
      result: { artifact: { artifactId, header: { title: 'Note' }, body: 'note', access: 'owner' } } });
  });

  it('preserves quota details through the public Action failure envelope', async () => {
    http.get.mockResolvedValue({ status: 200, data: { mode: 'plain', updatedAt: 1 } });
    http.post.mockResolvedValue({ status: 413, data: { error: 'quota_exceeded', budget: 'account', limitBytes: 10, usedBytes: 20 } });
    const executor = createActionExecutor({ ...deps(), isActionApprovalRequired: () => false });
    await expect(executor.execute('artifact.create', { artifactId, header: {}, body: 'note' },
      { surface: 'cli', presentUserConfirmation: { actionId: 'artifact.create' } })).resolves.toMatchObject({
        ok: false, errorCode: 'quota_exceeded', details: { budget: 'account', limitBytes: 10, usedBytes: 20 },
      });
  });

  it('creates and updates binary content only from the host-proved caller workspace', async () => {
    const bytes = Buffer.from([0xff, 0, 42]);
    await writeFile(join(root, 'workspace', 'image.png'), bytes);
    let row: Record<string, unknown> = {};
    http.get.mockImplementation(async (url: string) => ({ status: 200,
      data: url.endsWith('/v1/account/encryption') ? { mode: 'plain', updatedAt: 1 } : row }));
    http.post.mockImplementation(async (_url: string, input: Record<string, unknown>) => {
      row = { ...row, ...input, id: artifactId, ownerAccountId: 'owner', access: 'owner', encryptionMode: 'plain',
        headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 };
      return { status: 200, data: { ...row, success: true } };
    });
    const executor = createActionExecutor({ ...deps(), isActionApprovalRequired: () => false });
    const caller = { surface: 'cli' as const, actionCaller: { kind: 'session' as const, sessionId: 'session' }, defaultSessionId: 'session' };
    await expect(executor.execute('artifact.create', { artifactId, header: {}, uploadPath: 'image.png', mime: 'image/png' },
      { ...caller, presentUserConfirmation: { actionId: 'artifact.create' } })).resolves.toMatchObject({ ok: true });
    expect(row.blob).toMatchObject({ content: { t: 'plain', v: bytes.toString('base64') } });
    await expect(executor.execute('artifact.update', { artifactId, header: {}, expectedRevision: { headerVersion: 1, bodyVersion: 1 },
      uploadPath: 'image.png', mime: 'image/png' }, { ...caller, presentUserConfirmation: { actionId: 'artifact.update' } }))
      .resolves.toMatchObject({ ok: true });
    http.post.mockClear();
    await expect(executor.execute('artifact.create', { header: {}, uploadPath: '../private.png' },
      { ...caller, presentUserConfirmation: { actionId: 'artifact.create' } })).resolves.toMatchObject({ ok: false, errorCode: 'artifact_source_forbidden' });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('publishes only the authenticated caller workspace and refuses retargeting identity or another machine', async () => {
    await writeFile(join(root, 'workspace', 'result.txt'), 'result');
    http.get.mockResolvedValue({ status: 200, data: { mode: 'plain', updatedAt: 1 } });
    http.post.mockImplementation(async (_url: string, value: { id: string }) => ({ status: 200,
      data: { id: value.id, headerVersion: 1, bodyVersion: 1 } }));
    const host = deps();
    const executor = createActionExecutor({ ...host, isActionApprovalRequired: () => false });
    const context = { surface: 'cli' as const, actionCaller: { kind: 'session' as const, sessionId: 'session' },
      defaultSessionId: 'session', runtimeRunId: 'run', presentUserConfirmation: { actionId: 'artifact.publish_from_file' as const } };
    await expect(executor.execute('artifact.publish_from_file', { path: 'result.txt' }, context)).resolves.toMatchObject({ ok: true });
    const header = decodePlainArtifactStoredContent(http.post.mock.calls[0]?.[1].header);
    expect(header).toMatchObject({ source: { sessionId: 'session', runId: 'run', machineId: 'local-machine', path: 'result.txt' } });
    http.post.mockClear();
    await expect(executor.execute('artifact.publish_from_file', { path: 'result.txt', sessionId: 'foreign' }, context))
      .resolves.toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
    await expect(host.artifactAction?.({ actionId: 'artifact.publish_from_file', input: { path: 'result.txt' },
      context: { ...context, defaultSessionId: 'foreign' } })).resolves.toMatchObject({ ok: false, errorCode: 'artifact_source_unavailable' });
    const foreign = createCliActionDeps({ token: 'token', credentials: { token: 'token', encryption: null },
      sessionId: 'session', mode: 'plain', ctx: null,
      rawSession: { machineId: 'remote-machine', path: join(root, 'workspace') } });
    await expect(foreign.artifactAction?.({ actionId: 'artifact.publish_from_file', input: { path: 'result.txt' }, context }))
      .resolves.toMatchObject({ ok: false, errorCode: 'artifact_source_unavailable' });
    expect(http.post).not.toHaveBeenCalled();
  });
});
