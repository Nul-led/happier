import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { resolvePersonalHomeRuntimeArtifactPaths, resolvePersonalHomeRuntimeLayout } from './layout.js';
import { erasePersonalHomeData } from './erase.js';
import { acquirePersonalHomeOperationLock, withPersonalHomeOperationLock } from './lock.js';

describe('Personal Home erase', () => {
  it.each([
    ['linux root', 'linux' as const, '/', '/home/alice'],
    ['linux user home', 'linux' as const, '/home/alice', '/home/alice'],
    ['Windows drive root', 'win32' as const, 'C:\\', 'C:\\Users\\alice'],
    ['Windows user home', 'win32' as const, 'C:\\Users\\Alice', 'c:\\users\\alice\\'],
  ])('refuses the %s as a destructive data root', async (_label, platform, dataDir, userHomeDir) => {
    const layout = {
      ...resolvePersonalHomeRuntimeLayout({ platform, homeDir: userHomeDir }),
      dataDir,
    };
    await expect(erasePersonalHomeData(
      { layout, operationLeaseHeld: true, userHomeDir },
    )).rejects.toMatchObject({ code: 'unsafe_data_root' });
  });

  it('refuses destructive directory roots that overlap the data root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-overlap-'));
    const layout = {
      ...resolvePersonalHomeRuntimeLayout({ homeDir: root, platform: 'linux' }),
      publicFilesDir: root,
    };
    await mkdir(layout.dataDir, { recursive: true });
    await expect(withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => (
      erasePersonalHomeData({ layout, operationLeaseHeld: true, userHomeDir: join(root, 'home') })
    ))).rejects.toMatchObject({ code: 'unsafe_data_root' });
    await rm(root, { recursive: true, force: true });
  });

  it('refuses a file-shaped owned target that resolves to the user-home root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-file-root-'));
    const userHomeDir = join(root, 'home');
    const layout = {
      ...resolvePersonalHomeRuntimeLayout({ homeDir: userHomeDir, platform: 'linux' }),
      databasePath: userHomeDir,
    };
    await mkdir(layout.dataDir, { recursive: true });
    await mkdir(userHomeDir, { recursive: true });
    try {
      await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
        await expect(erasePersonalHomeData({ layout, operationLeaseHeld: true, userHomeDir })).rejects.toMatchObject({
          code: 'unsafe_data_root',
        });
      });
      await expect(lstat(userHomeDir)).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
        inspectionComplete: true,
        inspectionError: null,
        error: null,
      });
    });
    await expect(readFile(sibling, 'utf8')).resolves.toBe('preserve');
    await expect(readFile(join(layout.dataDir, 'marker.txt'), 'utf8')).resolves.toBe('remove');
    await expect(readFile(join(layout.configDir, 'server.env'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes continuity descriptors, startup readiness, and update recovery artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-continuity-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime-install'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime-install', 'data'),
      },
    });
    const artifacts = resolvePersonalHomeRuntimeArtifactPaths(layout);
    await mkdir(layout.dataDir, { recursive: true });
    await mkdir(layout.configDir, { recursive: true });
    await writeFile(join(layout.configDir, 'server.env'), 'managed=1');
    for (const path of [
      layout.irohEndpointKeyPath,
      artifacts.irohEndpointDescriptorPath,
      artifacts.homeConnectionDescriptorPath,
      artifacts.startupReceiptPath,
      artifacts.updateRecoveryPath,
    ]) {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, 'continuity');
    }
    await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
      await expect(erasePersonalHomeData({ layout, operationLeaseHeld: true })).resolves.toMatchObject({
        outcome: 'completed',
        remainingOwnedPaths: [],
      });
    });
    for (const path of [
      layout.irohEndpointKeyPath,
      artifacts.irohEndpointDescriptorPath,
      artifacts.homeConnectionDescriptorPath,
      artifacts.startupReceiptPath,
      artifacts.updateRecoveryPath,
    ]) await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(root, { recursive: true, force: true });
  });

  it('inspects runtime and operation residuals without treating those directories as blanket-retained', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-residuals-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime-install'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime-install', 'data'),
      },
    });
    const artifacts = resolvePersonalHomeRuntimeArtifactPaths(layout);
    const runtimeResidual = join(layout.dataDir, 'runtime', 'unexpected.json');
    const operationResidual = join(layout.dataDir, '.operations', 'unexpected.json');
    await mkdir(join(layout.dataDir, '.operations'), { recursive: true });
    await mkdir(join(layout.dataDir, 'runtime'), { recursive: true });
    await writeFile(runtimeResidual, 'unexpected');
    await writeFile(operationResidual, 'unexpected');
    await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
      const result = await erasePersonalHomeData({ layout, operationLeaseHeld: true });
      expect(result.outcome).toBe('completed');
      expect(result.remainingUnknownPaths).toEqual(expect.arrayContaining([runtimeResidual, operationResidual]));
      expect(result.remainingUnknownPaths).not.toContain(artifacts.operationLockPath);
    });
    await rm(root, { recursive: true, force: true });
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
          inspectionComplete: true,
          inspectionError: null,
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

  it('retains irreversible success when residual inspection fails after every owned target was deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-post-inspection-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data'),
      },
    });
    await mkdir(layout.dataDir, { recursive: true });
    await writeFile(layout.databasePath, 'remove-me');
    try {
      await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
        const result = await erasePersonalHomeData(
          { layout, operationLeaseHeld: true },
          {
            lstat,
            rm,
            readdir: async (target) => {
              if (target === layout.dataDir) throw Object.assign(new Error('simulated residual inspection failure'), { code: 'EACCES' });
              return readdir(target);
            },
          },
        );
        expect(result).toMatchObject({
          outcome: 'completed_with_cleanup_attention',
          removedPaths: [layout.databasePath],
          inspectionComplete: false,
          inspectionError: 'simulated residual inspection failure',
        });
      });
      await expect(readFile(layout.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the residual paths it already inspected when the retained lease artifact cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-personal-home-erase-lease-artifact-'));
    const layout = resolvePersonalHomeRuntimeLayout({
      homeDir: root,
      env: {
        HAPPIER_SELF_HOST_INSTALL_ROOT: join(root, 'runtime'),
        HAPPIER_SERVER_LIGHT_DATA_DIR: join(root, 'runtime', 'data'),
      },
    });
    const artifacts = resolvePersonalHomeRuntimeArtifactPaths(layout);
    const residual = join(layout.dataDir, 'unexpected-user-file.txt');
    await mkdir(layout.dataDir, { recursive: true });
    await writeFile(layout.databasePath, 'remove-me');
    await writeFile(residual, 'keep-me-visible');
    try {
      await withPersonalHomeOperationLock(layout.dataDir, 'erase', async () => {
        const result = await erasePersonalHomeData(
          { layout, operationLeaseHeld: true },
          {
            readdir,
            rm,
            lstat: async (target) => {
              if (String(target) === artifacts.operationLockPath) {
                throw Object.assign(new Error('simulated lease artifact read failure'), { code: 'EACCES' });
              }
              return lstat(target);
            },
          },
        );
        expect(result).toMatchObject({
          outcome: 'completed_with_cleanup_attention',
          removedPaths: [layout.databasePath],
          inspectionComplete: false,
          inspectionError: 'simulated lease artifact read failure',
        });
        // A destructive erase must still disclose the residual user paths it did observe.
        expect(result.remainingUnknownPaths).toContain(residual);
      });
      await expect(readFile(residual, 'utf8')).resolves.toBe('keep-me-visible');
    } finally {
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
