import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { resolvePersonalHomeRuntimeLayout } from './layout.js';
import { erasePersonalHomeData } from './erase.js';
import { acquirePersonalHomeOperationLock, withPersonalHomeOperationLock } from './lock.js';

describe('Personal Home erase', () => {
  it('requires the facade operation lease before deleting the data root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data'),
      },
    });
    await mkdir(layout.dataDir, { recursive: true });
    await mkdir(layout.configDir, { recursive: true });
    await writeFile(join(layout.configDir, 'server.env'), 'managed=1');
    const marker = join(layout.dataDir, 'marker.txt');
    await writeFile(marker, 'keep?');

    await expect(erasePersonalHomeData({ layout, operationLeaseHeld: true })).rejects.toMatchObject({
      code: 'unsafe_data_root',
    });
    await expect(readFile(marker, 'utf8')).resolves.toBe('keep?');
  });

  it('removes only exact Home-owned targets and reports unknown siblings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data'),
      },
    });
    await mkdir(layout.dataDir, { recursive: true });
    await mkdir(layout.configDir, { recursive: true });
    await writeFile(join(layout.configDir, 'server.env'), 'managed=1');
    await writeFile(join(layout.dataDir, 'marker.txt'), 'remove');
    const sibling = join(root, 'sibling.txt');
    await writeFile(sibling, 'preserve');

    await writeFile(layout.databasePath, 'database');
    await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
      await expect(erasePersonalHomeData({ layout, operationLeaseHeld: true })).resolves.toEqual({
        outcome: 'completed',
        removedPaths: [layout.databasePath, join(layout.configDir, 'server.env')],
        remainingOwnedPaths: [],
        remainingUnknownPaths: [join(layout.dataDir, 'marker.txt')],
        error: null,
      });
    });
    await expect(readFile(sibling, 'utf8')).resolves.toBe('preserve');
    await expect(readFile(join(layout.dataDir, 'marker.txt'), 'utf8')).resolves.toBe('remove');
    await expect(readFile(join(layout.configDir, 'server.env'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preflights every owned target before deleting any when a later target is unsafe', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-preflight-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data'),
      },
    });
    const outside = join(root, 'outside');
    await mkdir(layout.dataDir, { recursive: true });
    await mkdir(layout.configDir, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(layout.databasePath, 'preserve-database');
    await writeFile(join(outside, 'secret'), 'preserve-outside');
    await symlink(outside, layout.publicFilesDir);

    try {
      await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
        await expect(erasePersonalHomeData({ layout, operationLeaseHeld: true })).rejects.toMatchObject({
          code: 'unsafe_data_root',
        });
      });
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('preserve-database');
      await expect(readFile(join(outside, 'secret'), 'utf8')).resolves.toBe('preserve-outside');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns exact partial facts when a platform deletion fails after earlier removals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-partial-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data'),
      },
    });
    await mkdir(layout.dataDir, { recursive: true });
    await writeFile(layout.databasePath, 'remove-first');
    await writeFile(layout.masterSecretPath, 'deletion-will-fail');

    try {
      await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
        const result = await erasePersonalHomeData(
          { layout, operationLeaseHeld: true },
          {
            lstat,
            readdir,
            rm: async (target, options) => {
              if (target === layout.masterSecretPath) {
                throw Object.assign(new Error('simulated platform refusal'), { code: 'EACCES' });
              }
              await rm(target, options);
            },
          },
        );
        expect(result).toEqual({
          outcome: 'partial',
          removedPaths: [layout.databasePath],
          remainingOwnedPaths: [layout.masterSecretPath],
          remainingUnknownPaths: [],
          error: `Failed to remove Personal Home target ${layout.masterSecretPath}: simulated platform refusal`,
        });
      });
      await expect(readFile(layout.databasePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(layout.masterSecretPath, 'utf8')).resolves.toBe('deletion-will-fail');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses to erase under another operation kind owned by this process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-wrong-lease-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: { HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'), HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data') },
    });
    await mkdir(layout.dataDir, { recursive: true });
    await writeFile(layout.databasePath, 'preserve');
    const release = await acquirePersonalHomeOperationLock(layout.dataDir, 'backup');
    try {
      await expect(erasePersonalHomeData({ layout, operationLeaseHeld: true })).rejects.toMatchObject({ code: 'unsafe_data_root' });
      await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('preserve');
    } finally {
      await release();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a same-process erase branch that does not own the exact async lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-concurrent-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: { HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'), HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data') },
    });
    await mkdir(layout.dataDir, { recursive: true });
    await writeFile(layout.databasePath, 'preserve');
    let resumeIndependent: () => void = () => undefined;
    const resume = new Promise<void>((resolveResume) => { resumeIndependent = resolveResume; });
    const independent = (async () => {
      await resume;
      return erasePersonalHomeData({ layout, operationLeaseHeld: true });
    })();

    try {
      await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
        resumeIndependent();
        await expect(independent).rejects.toMatchObject({ code: 'unsafe_data_root' });
        await expect(readFile(layout.databasePath, 'utf8')).resolves.toBe('preserve');
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
