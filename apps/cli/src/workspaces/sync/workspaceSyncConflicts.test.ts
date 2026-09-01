import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { deleteWorkspaceSyncConflictLoserAtRoot } from './workspaceSyncConflicts';

describe('deleteWorkspaceSyncConflictLoserAtRoot', () => {
  it('deletes only a root-confined loser matching the expected kind and digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-'));
    const path = join(root, 'loser.txt');
    await writeFile(path, 'loser');
    const expectedDigest = createHash('sha1').update('loser').digest('hex');
    await deleteWorkspaceSyncConflictLoserAtRoot({ rootPath: root, relativePath: 'loser.txt', expectedKind: 'file', expectedDigest });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(root, { recursive: true, force: true });
  });

  it('returns conflict_changed without mutation when the digest changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-'));
    const path = join(root, 'loser.txt');
    await writeFile(path, 'changed');
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({ rootPath: root, relativePath: 'loser.txt', expectedKind: 'file', expectedDigest: '0'.repeat(40) }))
      .rejects.toMatchObject({ code: 'conflict_changed' });
    await expect(readFile(path, 'utf8')).resolves.toBe('changed');
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a file deletion that omits the digest precondition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-'));
    const path = join(root, 'loser.txt');
    await writeFile(path, 'loser');
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser.txt',
      expectedKind: 'file',
    })).rejects.toMatchObject({ code: 'conflict_resolution_unsupported' });
    await expect(readFile(path, 'utf8')).resolves.toBe('loser');
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a digest on a non-file deletion precondition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-'));
    const path = join(root, 'loser-directory');
    await writeFile(path, 'not-a-directory');
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser-directory',
      expectedKind: 'directory',
      expectedDigest: '0'.repeat(40),
    })).rejects.toMatchObject({ code: 'conflict_resolution_unsupported' });
    await expect(readFile(path, 'utf8')).resolves.toBe('not-a-directory');
    await rm(root, { recursive: true, force: true });
  });

  it('revalidates retained authority after file preconditions and immediately before mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-'));
    const path = join(root, 'loser.txt');
    await writeFile(path, 'loser');
    const expectedDigest = createHash('sha1').update('loser').digest('hex');
    const lost = Object.assign(new Error('root authority changed'), { code: 'root_changed' });
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest,
      assertCurrentAuthority: async () => { throw lost; },
    })).rejects.toBe(lost);
    await expect(readFile(path, 'utf8')).resolves.toBe('loser');
    await rm(root, { recursive: true, force: true });
  });

  it('rejects root deletion and path escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-'));
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({ rootPath: root, relativePath: '.', expectedKind: 'directory' }))
      .rejects.toMatchObject({ code: 'conflict_resolution_unsupported' });
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: '../outside',
      expectedKind: 'file',
      expectedDigest: '0'.repeat(40),
    }))
      .rejects.toMatchObject({ code: 'conflict_resolution_unsupported' });
    await rm(root, { recursive: true, force: true });
  });
});
