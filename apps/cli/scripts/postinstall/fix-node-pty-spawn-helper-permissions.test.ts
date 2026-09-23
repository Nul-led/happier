import { createRequire } from 'node:module';
import { chmodSync, copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { createTempDirSync, removeTempDirSync } from '../../src/testkit/fs/tempDir';

const require = createRequire(import.meta.url);

function loadPostinstallFromSource(root: string) {
  // Resolve the authored CommonJS export, independent of stale bundled dist.
  const commonDir = join(root, 'node_modules', '@happier-dev', 'cli-common');
  mkdirSync(commonDir, { recursive: true });
  for (const name of ['package.json', 'nodePtySpawnHelperPermissions.cjs']) {
    copyFileSync(new URL(`../../../../packages/cli-common/${name}`, import.meta.url), join(commonDir, name));
  }
  const scriptPath = join(root, 'fix-node-pty-spawn-helper-permissions.cjs');
  copyFileSync(new URL('./fix-node-pty-spawn-helper-permissions.cjs', import.meta.url), scriptPath);
  return require(scriptPath) as {
    fixNodePtySpawnHelperPermissions: (options?: { cwd?: string }) => { fixed: number; paths: string[] };
  };
}

describe('fixNodePtySpawnHelperPermissions', () => {
  it('restores executable permissions for bundled node-pty spawn helpers', () => {
    if (process.platform === 'win32') return;

    const root = createTempDirSync('happier-node-pty-permissions-');
    try {
      const { fixNodePtySpawnHelperPermissions } = loadPostinstallFromSource(root);
      const helperPaths = ['node-pty', '@homebridge/node-pty-prebuilt-multiarch'].flatMap((packageName) => [
        join(root, 'node_modules', packageName, 'build', 'Release', 'spawn-helper'),
        join(root, 'node_modules', packageName, 'build', 'Debug', 'spawn-helper'),
        join(root, 'node_modules', packageName, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
        join(root, 'node_modules', packageName, 'prebuilds', 'darwin-x64', 'spawn-helper'),
      ]);

      for (const helperPath of helperPaths) {
        mkdirSync(join(helperPath, '..'), { recursive: true });
        writeFileSync(helperPath, '#!/usr/bin/env node\n', 'utf8');
        chmodSync(helperPath, 0o644);
      }

      const result = fixNodePtySpawnHelperPermissions({ cwd: root });
      expect(result.fixed).toBe(helperPaths.length);

      for (const helperPath of helperPaths) {
        const mode = statSync(helperPath).mode & 0o777;
        expect(mode & 0o111).not.toBe(0);
      }
    } finally {
      removeTempDirSync(root);
    }
  });

  it('accepts absent optional packages and helpers', () => {
    const root = createTempDirSync('happier-node-pty-absent-');
    try {
      const { fixNodePtySpawnHelperPermissions } = loadPostinstallFromSource(root);
      expect(fixNodePtySpawnHelperPermissions({ cwd: root }).fixed).toBe(0);
    } finally {
      removeTempDirSync(root);
    }
  });

  it('surfaces malformed prebuild directories rather than silently omitting them', () => {
    const root = createTempDirSync('happier-node-pty-invalid-');
    try {
      const { fixNodePtySpawnHelperPermissions } = loadPostinstallFromSource(root);
      const packageDir = join(root, 'node_modules', 'node-pty');
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(join(packageDir, 'prebuilds'), 'not a directory');
      expect(() => fixNodePtySpawnHelperPermissions({ cwd: root })).toThrow();
    } finally {
      removeTempDirSync(root);
    }
  });

  it('surfaces permission failures from the filesystem', () => {
    const root = createTempDirSync('happier-node-pty-denied-');
    try {
      const { fixNodePtySpawnHelperPermissions } = loadPostinstallFromSource(root);
      const helper = join(root, 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper');
      mkdirSync(join(helper, '..'), { recursive: true });
      writeFileSync(helper, 'helper');
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      // Permission errors depend on the host account; mock only the OS boundary.
      const chmod = vi.spyOn(require('node:fs') as typeof import('node:fs'), 'chmodSync').mockImplementation(() => { throw error; });
      try {
        expect(() => fixNodePtySpawnHelperPermissions({ cwd: root })).toThrow(error);
      } finally {
        chmod.mockRestore();
      }
    } finally {
      removeTempDirSync(root);
    }
  });
});
