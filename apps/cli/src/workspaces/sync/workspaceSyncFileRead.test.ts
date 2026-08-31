import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readWorkspaceSyncFileAtRoot } from './workspaceSyncFileRead';

describe('readWorkspaceSyncFileAtRoot', () => {
  it('returns one bounded text preview and verifies its digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-read-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'index.ts'), 'hello');
    const digest = createHash('sha1').update('hello').digest('hex');

    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'src/index.ts',
      expectedDigest: digest,
      maxBytes: 1024,
    })).resolves.toEqual({ status: 'text', text: 'hello', digest, size: 5 });

    await rm(root, { recursive: true, force: true });
  });

  it('reports changed, binary, too-large and missing without leaking a body', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-read-'));
    await writeFile(join(root, 'changed.txt'), 'changed');
    await writeFile(join(root, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, 'large.txt'), '0123456789');

    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'changed.txt',
      expectedDigest: '0'.repeat(40),
      maxBytes: 1024,
    })).resolves.toMatchObject({ status: 'changed' });
    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'binary.dat',
      maxBytes: 1024,
    })).resolves.toMatchObject({ status: 'binary', size: 4 });
    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'large.txt',
      maxBytes: 4,
    })).resolves.toEqual({ status: 'too_large', size: 10 });
    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'missing.txt',
      maxBytes: 1024,
    })).resolves.toEqual({ status: 'missing' });

    await rm(root, { recursive: true, force: true });
  });

  it('rejects root, traversal and symlink escape reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-read-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-sync-read-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));

    for (const relativePath of ['.', '../secret.txt', 'escape.txt']) {
      await expect(readWorkspaceSyncFileAtRoot({ rootPath: root, relativePath, maxBytes: 1024 }))
        .rejects.toMatchObject({ code: 'workspace_root_unsafe' });
    }

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
});
