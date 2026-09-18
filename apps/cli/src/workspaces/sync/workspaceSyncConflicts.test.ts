import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renameObserver = vi.hoisted(() => ({
  current: null as null | ((source: string, destination: string) => Promise<void>),
}));
const removeObserver = vi.hoisted(() => ({
  current: null as null | ((path: string) => Promise<void>),
}));
const openObserver = vi.hoisted(() => ({
  current: null as null | ((path: string) => Promise<void>),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (source: Parameters<typeof actual.rename>[0], destination: Parameters<typeof actual.rename>[1]) => {
      await actual.rename(source, destination);
      await renameObserver.current?.(String(source), String(destination));
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      await removeObserver.current?.(String(args[0]));
      return await actual.rm(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      await openObserver.current?.(String(args[0]));
      return await actual.open(...args);
    },
  };
});

import { deleteWorkspaceSyncConflictLoserAtRoot } from './workspaceSyncConflicts';

describe('deleteWorkspaceSyncConflictLoserAtRoot', () => {
  afterEach(() => {
    renameObserver.current = null;
    removeObserver.current = null;
    openObserver.current = null;
    vi.restoreAllMocks();
  });

  it('deletes only a root-confined loser matching the expected kind and digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-'));
    const path = join(root, 'loser.txt');
    await writeFile(path, 'loser');
    const expectedDigest = createHash('sha1').update('loser').digest('hex');
    await deleteWorkspaceSyncConflictLoserAtRoot({ rootPath: root, relativePath: 'loser.txt', expectedKind: 'file', expectedDigest });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'linux')('deletes the exact POSIX filename without trimming whitespace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-exact-'));
    const spacedPath = join(root, ' note.txt');
    const plainPath = join(root, 'note.txt');
    await writeFile(spacedPath, 'same');
    await writeFile(plainPath, 'same');
    const expectedDigest = createHash('sha1').update('same').digest('hex');

    await deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: ' note.txt',
      expectedKind: 'file',
      expectedDigest,
    });

    await expect(readFile(spacedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(plainPath, 'utf8')).resolves.toBe('same');
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

  it('delegates Windows deletion to the native confined-filesystem boundary without pathname fallback', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const expectedDigest = createHash('sha1').update('loser').digest('hex');
    const assertCurrentAuthority = vi.fn(async () => undefined);
    const runNativeConfinedDelete = vi.fn(async () => undefined);

    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: 'C:\\work',
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest,
      assertCurrentAuthority,
    }, { runNativeConfinedDelete })).resolves.toBeUndefined();

    expect(runNativeConfinedDelete).toHaveBeenCalledWith({
      rootPath: 'C:\\work',
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest,
      assertCurrentAuthority,
    });
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
    const outside = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'outside');
    await symlink(outside, join(root, 'escape-parent'), 'dir');
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({ rootPath: root, relativePath: '.', expectedKind: 'directory' }))
      .rejects.toMatchObject({ code: 'conflict_resolution_unsupported' });
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: '../outside',
      expectedKind: 'file',
      expectedDigest: '0'.repeat(40),
    }))
      .rejects.toMatchObject({ code: 'conflict_resolution_unsupported' });
    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'escape-parent/secret.txt',
      expectedKind: 'file',
      expectedDigest: createHash('sha1').update('outside').digest('hex'),
    }))
      .rejects.toMatchObject({ code: 'conflict_resolution_unsupported' });
    await expect(readFile(join(outside, 'secret.txt'), 'utf8')).resolves.toBe('outside');
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'linux')('keeps deletion on the retained parent when an ancestor is swapped after authority validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-race-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-outside-'));
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'loser.txt'), 'inside');
    await writeFile(join(outside, 'loser.txt'), 'outside');
    const digest = createHash('sha1').update('inside').digest('hex');

    await deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'nested/loser.txt',
      expectedKind: 'file',
      expectedDigest: digest,
      assertCurrentAuthority: async () => {
        await rename(join(root, 'nested'), join(root, 'retained'));
        await symlink(outside, join(root, 'nested'), 'dir');
      },
    });

    await expect(readFile(join(root, 'retained', 'loser.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(outside, 'loser.txt'), 'utf8')).resolves.toBe('outside');
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('does not mutate when the final component is swapped after authority validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-race-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-outside-'));
    await writeFile(join(root, 'loser.txt'), 'inside');
    await writeFile(join(outside, 'secret.txt'), 'outside');
    const digest = createHash('sha1').update('inside').digest('hex');

    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest: digest,
      assertCurrentAuthority: async () => {
        await rm(join(root, 'loser.txt'));
        await symlink(join(outside, 'secret.txt'), join(root, 'loser.txt'));
      },
    })).rejects.toMatchObject({ code: 'conflict_changed' });

    await expect(readFile(join(outside, 'secret.txt'), 'utf8')).resolves.toBe('outside');
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'linux')('does not follow a final symlink introduced before digest verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-final-read-race-'));
    const outside = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-final-read-outside-'));
    const loser = join(root, 'loser.txt');
    const secret = join(outside, 'secret.txt');
    await writeFile(loser, 'inside');
    await writeFile(secret, 'outside-secret');
    const digest = createHash('sha1').update('inside').digest('hex');
    let swapped = false;
    openObserver.current = async (path) => {
      if (!swapped && basename(path) === 'loser.txt') {
        swapped = true;
        await rm(loser);
        await symlink(secret, loser);
      }
    };

    await expect(deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest: digest,
    })).rejects.toMatchObject({ code: 'conflict_changed' });

    expect(swapped).toBe(true);
    await expect(readFile(secret, 'utf8')).resolves.toBe('outside-secret');
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('preserves a quarantined same-kind directory replacement after authority validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-identity-race-'));
    const path = join(root, 'loser');
    const originalPath = join(root, 'original-loser');
    await mkdir(path);
    await writeFile(join(path, 'original.txt'), 'original');

    const failure = await deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser',
      expectedKind: 'directory',
      assertCurrentAuthority: async () => {
        await rename(path, originalPath);
        await mkdir(path);
        await writeFile(join(path, 'replacement.txt'), 'replacement');
      },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const recoveryName = (await readdir(root)).find((entry) => entry.startsWith('.happier-delete-'));
    expect(recoveryName).toBeTruthy();
    expect(failure).toMatchObject({
      code: 'conflict_changed',
      cause: expect.objectContaining({ code: 'conflict_changed' }),
      recoveryPath: join(await realpath(root), recoveryName!),
    });
    await expect(readFile(join(originalPath, 'original.txt'), 'utf8')).resolves.toBe('original');
    await expect(readFile(join(root, recoveryName!, 'replacement.txt'), 'utf8')).resolves.toBe('replacement');
    await rm(root, { recursive: true, force: true });
  });

  it('never overwrites a replacement that appears while a quarantined loser is being revalidated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-rollback-race-'));
    const path = join(root, 'loser.txt');
    await writeFile(path, 'loser');
    const expectedDigest = createHash('sha1').update('loser').digest('hex');

    renameObserver.current = async (source, destination) => {
      if (basename(source) === 'loser.txt' && basename(destination).startsWith('.happier-delete-')) {
        await writeFile(path, 'newer editor bytes');
      }
    };

    const operation = deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest,
      assertCurrentAuthority: async () => {
        // Make the post-rename digest check fail after the originally admitted
        // bytes have been isolated from the public pathname.
        await writeFile(path, 'changed admitted bytes');
      },
    });

    const failure = await operation.then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: 'conflict_changed' });
    await expect(readFile(path, 'utf8')).resolves.toBe('newer editor bytes');

    const recoveryName = (await readdir(root)).find((entry) => entry.startsWith('.happier-delete-'));
    expect(recoveryName).toBeTruthy();
    expect(failure).toMatchObject({
      cause: expect.objectContaining({ code: 'conflict_changed' }),
      recoveryPath: join(await realpath(root), recoveryName!),
    });
    await expect(readFile(join(root, recoveryName!), 'utf8')).resolves.toBe('changed admitted bytes');
    await rm(root, { recursive: true, force: true });
  });

  it('returns the stable conflict_changed recovery outcome for a post-quarantine filesystem failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-sync-conflict-recovery-'));
    const path = join(root, 'loser.txt');
    await writeFile(path, 'loser');
    const expectedDigest = createHash('sha1').update('loser').digest('hex');
    const removalFailure = Object.assign(new Error('simulated removal failure'), { code: 'EACCES' });

    removeObserver.current = async (removedPath) => {
      if (basename(removedPath).startsWith('.happier-delete-')) throw removalFailure;
    };

    const failure = await deleteWorkspaceSyncConflictLoserAtRoot({
      rootPath: root,
      relativePath: 'loser.txt',
      expectedKind: 'file',
      expectedDigest,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const recoveryName = (await readdir(root)).find((entry) => entry.startsWith('.happier-delete-'));
    expect(recoveryName).toBeTruthy();
    expect(failure).toMatchObject({
      code: 'conflict_changed',
      cause: removalFailure,
      recoveryPath: join(await realpath(root), recoveryName!),
    });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, recoveryName!), 'utf8')).resolves.toBe('loser');

    removeObserver.current = null;
    await rm(root, { recursive: true, force: true });
  });
});
