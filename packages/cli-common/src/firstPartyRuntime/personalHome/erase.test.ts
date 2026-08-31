import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
        removedPaths: [layout.databasePath, join(layout.configDir, 'server.env')],
        remainingUnknownPaths: [join(layout.dataDir, 'marker.txt')],
      });
    });
    await expect(readFile(sibling, 'utf8')).resolves.toBe('preserve');
    await expect(readFile(join(layout.dataDir, 'marker.txt'), 'utf8')).resolves.toBe('remove');
    await expect(readFile(join(layout.configDir, 'server.env'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
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
