import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveDaemonServiceRuntimeTarget } from './runtimeTarget.js';

describe('resolveDaemonServiceRuntimeTarget', () => {
  const originalArgv = process.argv;
  let packageRoot: string;
  beforeEach(() => {
    packageRoot = mkdtempSync(join(tmpdir(), 'happier-service-package-'));
    const entryPath = join(packageRoot, 'package-dist', 'index.mjs');
    mkdirSync(join(packageRoot, 'package-dist'));
    writeFileSync(entryPath, 'export {};\n');
    process.argv = [process.execPath, entryPath];
  });
  afterEach(() => {
    process.argv = originalArgv;
    rmSync(packageRoot, { recursive: true, force: true });
  });

  it('uses the launched development dist when no package-dist exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'happier-service-runtime-'));
    const originalArgv = process.argv;
    const entryPath = join(root, 'dist', 'index.mjs');
    try {
      mkdirSync(join(root, 'dist'));
      writeFileSync(entryPath, 'export {};\n');
      process.argv = [process.execPath, entryPath];
      expect(resolveDaemonServiceRuntimeTarget({ currentExecPath: process.execPath })).toEqual({
        nodePath: process.execPath,
        entryPath,
      });
    } finally {
      process.argv = originalArgv;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers the bundled package-dist entrypoint when the current runtime executable is bun', () => {
    expect(
      resolveDaemonServiceRuntimeTarget({
        currentExecPath: '/opt/homebrew/bin/bun',
        runtimeExecutable: '/opt/homebrew/bin/bun',
      }),
    ).toEqual({
      nodePath: '/opt/homebrew/bin/bun',
      entryPath: join(packageRoot, 'package-dist', 'index.mjs'),
    });
  });

  it('prefers the bundled package-dist entrypoint for an explicit managed js runtime wrapper', () => {
    expect(
      resolveDaemonServiceRuntimeTarget({
        currentExecPath: '/Applications/Happier.app/Contents/MacOS/happier',
        explicitNodePath: '/Users/test/.happier/tools/js-runtime/current/bin/happier-js-runtime',
      }),
    ).toEqual({
      nodePath: '/Users/test/.happier/tools/js-runtime/current/bin/happier-js-runtime',
      entryPath: join(packageRoot, 'package-dist', 'index.mjs'),
    });
  });

  it('keeps an empty entrypoint for a self-contained binary with no explicit runtime override', () => {
    expect(
      resolveDaemonServiceRuntimeTarget({
        currentExecPath: '/Applications/Happier.app/Contents/MacOS/happier',
      }),
    ).toEqual({
      nodePath: '/Applications/Happier.app/Contents/MacOS/happier',
      entryPath: '',
    });
  });
});
