import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { preparePluginDevelopmentRoot } from './developmentCandidateMaterializer';

describe('preparePluginDevelopmentRoot', () => {
  it('uses the trusted author root in place and does no package-manager or copy work for source-only changes', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'happier-dev-source-in-place-'));
    try {
      await mkdir(join(rootPath, 'src'));
      await writeFile(join(rootPath, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
      const runManagedPluginPnpm = vi.fn();

      const prepared = await preparePluginDevelopmentRoot({
        sourceRootPath: rootPath,
        prepareDependencies: false,
      }, { runManagedPluginPnpm });

      expect(prepared.rootPath).toBe(rootPath);
      expect(runManagedPluginPnpm).not.toHaveBeenCalled();
      await prepared.cleanup();
      await expect(readFile(join(rootPath, 'src', 'index.ts'), 'utf8'))
        .resolves.toBe('export const value = 1;\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('prepares changed dependencies once in the author root through the managed toolchain', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'happier-dev-dependencies-in-place-'));
    try {
      await writeFile(join(rootPath, 'package.json'), '{"name":"fixture"}\n', 'utf8');
      await writeFile(join(rootPath, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8');
      const runManagedPluginPnpm = vi.fn(async () => ({
        ok: true as const,
        result: { exitCode: 0, signal: null, stdout: '', stderr: '' },
      }));

      const prepared = await preparePluginDevelopmentRoot({
        sourceRootPath: rootPath,
        prepareDependencies: true,
        sdkRegistryOrigin: 'https://registry.example.test/',
      }, { runManagedPluginPnpm });

      expect(prepared.rootPath).toBe(rootPath);
      expect(runManagedPluginPnpm).toHaveBeenCalledOnce();
      expect(runManagedPluginPnpm).toHaveBeenCalledWith({
        projectRoot: rootPath,
        args: ['install', '--ignore-scripts', '--frozen-lockfile'],
        sdkRegistryOrigin: 'https://registry.example.test',
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
