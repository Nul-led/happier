import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readWorkspaceSyncFileAtRoot } from './workspaceSyncFileRead';

describe('readWorkspaceSyncFileAtRoot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it.skipIf(process.platform !== 'linux')('reads the exact POSIX filename without trimming whitespace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-read-exact-'));
    await writeFile(join(root, ' note.txt'), 'same');
    await writeFile(join(root, 'note.txt'), 'same');
    await writeFile(join(root, String.raw`nested\note.txt`), 'backslash');
    const digest = createHash('sha1').update('same').digest('hex');

    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: ' note.txt',
      expectedDigest: digest,
      maxBytes: 1024,
    })).resolves.toEqual({ status: 'text', text: 'same', digest, size: 4 });

    await rm(join(root, ' note.txt'));
    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: ' note.txt',
      expectedDigest: digest,
      maxBytes: 1024,
    })).resolves.toEqual({ status: 'missing' });
    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'note.txt',
      expectedDigest: digest,
      maxBytes: 1024,
    })).resolves.toMatchObject({ status: 'text', text: 'same' });
    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: String.raw`nested\note.txt`,
      maxBytes: 1024,
    })).resolves.toMatchObject({ status: 'text', text: 'backslash' });

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
    await symlink(outside, join(root, 'escape-parent'), 'dir');

    for (const relativePath of ['.', '../secret.txt', 'escape.txt', 'escape-parent/secret.txt']) {
      await expect(readWorkspaceSyncFileAtRoot({ rootPath: root, relativePath, maxBytes: 1024 }))
        .rejects.toMatchObject({ code: 'workspace_root_unsafe' });
    }

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'linux')('cannot disclose outside bytes when an ancestor is swapped at the authority boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-read-race-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-sync-read-outside-'));
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'preview.txt'), 'inside');
    await writeFile(join(outside, 'preview.txt'), 'outside-secret');

    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'nested/preview.txt',
      maxBytes: 1024,
      assertCurrentAuthority: async () => {
        await rename(join(root, 'nested'), join(root, 'retained'));
        await symlink(outside, join(root, 'nested'), 'dir');
      },
    })).resolves.toMatchObject({ status: 'text', text: 'inside' });

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('rejects a final-component symlink swapped at the authority boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-read-race-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-sync-read-outside-'));
    await writeFile(join(root, 'preview.txt'), 'inside');
    await writeFile(join(outside, 'secret.txt'), 'outside-secret');

    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: root,
      relativePath: 'preview.txt',
      maxBytes: 1024,
      assertCurrentAuthority: async () => {
        await rm(join(root, 'preview.txt'));
        await symlink(join(outside, 'secret.txt'), join(root, 'preview.txt'));
      },
    })).rejects.toMatchObject({ code: 'workspace_root_unsafe' });

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('delegates Windows preview to the native confined-filesystem boundary without pathname fallback', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const runNativeConfinedRead = vi.fn(async () => ({
      status: 'content' as const,
      content: Buffer.from('inside'),
      digest: createHash('sha1').update('inside').digest('hex'),
      size: 6,
    }));
    const assertCurrentAuthority = vi.fn(async () => undefined);

    await expect(readWorkspaceSyncFileAtRoot({
      rootPath: 'C:\\work',
      relativePath: 'preview.txt',
      maxBytes: 1024,
      assertCurrentAuthority,
    }, { runNativeConfinedRead })).resolves.toMatchObject({
      status: 'text',
      text: 'inside',
      size: 6,
    });

    expect(runNativeConfinedRead).toHaveBeenCalledWith({
      rootPath: 'C:\\work',
      relativePath: 'preview.txt',
      maxBytes: 1024,
      assertCurrentAuthority,
    });
  });
});
