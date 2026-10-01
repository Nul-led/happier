import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { testState } = vi.hoisted(() => {
  return {
    testState: {
      repoRootDir: '',
      transientStatMissingPath: '',
      transientStatMissingTriggered: false,
      fileReads: [] as { path: string; bytes: number }[],
    },
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');

  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>): ReturnType<typeof actual.readFileSync> => {
      const contents = actual.readFileSync(...args);
      testState.fileReads.push({ path: String(args[0]), bytes: Buffer.byteLength(contents) });
      return contents;
    },
    statSync: (...args: Parameters<typeof actual.statSync>): ReturnType<typeof actual.statSync> => {
      const [pathLike] = args;
      const resolvedPath = typeof pathLike === 'string'
        ? pathLike
        : pathLike instanceof URL
          ? pathLike.pathname
          : pathLike.toString();

      if (
        testState.transientStatMissingPath.length > 0
        && resolvedPath === testState.transientStatMissingPath
        && !testState.transientStatMissingTriggered
      ) {
        testState.transientStatMissingTriggered = true;
        const error = new Error(`ENOENT: no such file or directory, stat '${resolvedPath}'`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }

      return actual.statSync(...args);
    },
  };
});

vi.mock('../paths', () => {
  return {
    repoRootDir: () => testState.repoRootDir,
  };
});

describe('uiWebSourceFingerprint', () => {
  beforeEach(() => {
    vi.resetModules();
    testState.repoRootDir = '';
    testState.transientStatMissingPath = '';
    testState.transientStatMissingTriggered = false;
    testState.fileReads = [];
  });

  afterAll(() => {
    vi.doUnmock('../paths');
    vi.resetModules();
  });

  it('changes when a same-sized source file changes without mtime precision changing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    await mkdir(sourcesDir, { recursive: true });
    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');

    const sourceFile = join(sourcesDir, 'sessionState.ts');
    const sameSizeBefore = 'const value = 1;\n';
    const sameSizeAfter = 'const value = 2;\n';
    expect(sameSizeBefore.length).toBe(sameSizeAfter.length);

    const fixedMtime = new Date('2026-04-05T00:00:00.000Z');
    await writeFile(sourceFile, sameSizeBefore, 'utf8');
    await utimes(sourceFile, fixedMtime, fixedMtime);

    const firstFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    await writeFile(sourceFile, sameSizeAfter, 'utf8');
    await utimes(sourceFile, fixedMtime, fixedMtime);

    vi.resetModules();
    testState.repoRootDir = rootDir;
    const secondFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    expect(secondFingerprint).not.toBe(firstFingerprint);

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it('recomputes within the same module instance when source contents change', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-live-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    await mkdir(sourcesDir, { recursive: true });
    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');

    const sourceFile = join(sourcesDir, 'sessionState.ts');
    const before = 'const value = 1;\n';
    const after = 'const value = 2;\n';
    expect(before.length).toBe(after.length);

    await writeFile(sourceFile, before, 'utf8');
    const { resolveUiWebSourceFingerprint } = await import('./uiWebSourceFingerprint');
    const firstFingerprint = resolveUiWebSourceFingerprint();

    await writeFile(sourceFile, after, 'utf8');
    const secondFingerprint = resolveUiWebSourceFingerprint();

    expect(secondFingerprint).not.toBe(firstFingerprint);

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it('changes when an imported internal workspace package source changes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-workspace-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    const protocolDir = join(rootDir, 'packages', 'protocol');
    const protocolSrcDir = join(protocolDir, 'src');
    await mkdir(sourcesDir, { recursive: true });
    await mkdir(protocolSrcDir, { recursive: true });
    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');
    await writeFile(
      join(uiDir, 'package.json'),
      JSON.stringify({
        name: '@happier-dev/ui',
        dependencies: {
          '@happier-dev/protocol': '0.0.0',
        },
      }),
      'utf8',
    );
    await writeFile(join(protocolDir, 'package.json'), JSON.stringify({ name: '@happier-dev/protocol' }), 'utf8');

    const packageSourceFile = join(protocolSrcDir, 'index.ts');
    const sameSizeBefore = 'export const value = 1;\n';
    const sameSizeAfter = 'export const value = 2;\n';
    expect(sameSizeBefore.length).toBe(sameSizeAfter.length);

    const fixedMtime = new Date('2026-04-05T00:00:00.000Z');
    await writeFile(packageSourceFile, sameSizeBefore, 'utf8');
    await utimes(packageSourceFile, fixedMtime, fixedMtime);

    const firstFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    await writeFile(packageSourceFile, sameSizeAfter, 'utf8');
    await utimes(packageSourceFile, fixedMtime, fixedMtime);

    vi.resetModules();
    testState.repoRootDir = rootDir;
    const secondFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    expect(secondFingerprint).not.toBe(firstFingerprint);

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it('changes when a transitively imported internal workspace package source changes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-transitive-workspace-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    const agentsDir = join(rootDir, 'packages', 'agents');
    const agentsSrcDir = join(agentsDir, 'src');
    const protocolDir = join(rootDir, 'packages', 'protocol');
    const protocolSrcDir = join(protocolDir, 'src');
    await mkdir(sourcesDir, { recursive: true });
    await mkdir(agentsSrcDir, { recursive: true });
    await mkdir(protocolSrcDir, { recursive: true });
    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');
    await writeFile(
      join(uiDir, 'package.json'),
      JSON.stringify({
        name: '@happier-dev/ui',
        dependencies: {
          '@happier-dev/agents': '0.0.0',
        },
      }),
      'utf8',
    );
    await writeFile(
      join(agentsDir, 'package.json'),
      JSON.stringify({
        name: '@happier-dev/agents',
        dependencies: {
          '@happier-dev/protocol': '0.0.0',
        },
      }),
      'utf8',
    );
    await writeFile(join(protocolDir, 'package.json'), JSON.stringify({ name: '@happier-dev/protocol' }), 'utf8');

    const packageSourceFile = join(protocolSrcDir, 'index.ts');
    const sameSizeBefore = 'export const value = 1;\n';
    const sameSizeAfter = 'export const value = 2;\n';
    expect(sameSizeBefore.length).toBe(sameSizeAfter.length);

    const fixedMtime = new Date('2026-04-05T00:00:00.000Z');
    await writeFile(packageSourceFile, sameSizeBefore, 'utf8');
    await utimes(packageSourceFile, fixedMtime, fixedMtime);

    const firstFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    await writeFile(packageSourceFile, sameSizeAfter, 'utf8');
    await utimes(packageSourceFile, fixedMtime, fixedMtime);

    vi.resetModules();
    testState.repoRootDir = rootDir;
    const secondFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    expect(secondFingerprint).not.toBe(firstFingerprint);

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it.each([
    'babel.config.js',
    'app.config.js',
    'appVariantConfig.cjs',
    'tsconfig.json',
  ])('changes when a root-level UI config file changes: %s', async (fileName) => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-config-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    await mkdir(sourcesDir, { recursive: true });
    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');

    const targetFile = join(uiDir, fileName);
    const sameSizeBefore = 'export default 1;\n';
    const sameSizeAfter = 'export default 2;\n';
    expect(sameSizeBefore.length).toBe(sameSizeAfter.length);

    const fixedMtime = new Date('2026-04-05T00:00:00.000Z');
    await writeFile(targetFile, sameSizeBefore, 'utf8');
    await utimes(targetFile, fixedMtime, fixedMtime);

    const firstFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    await writeFile(targetFile, sameSizeAfter, 'utf8');
    await utimes(targetFile, fixedMtime, fixedMtime);

    vi.resetModules();
    testState.repoRootDir = rootDir;
    const secondFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    expect(secondFingerprint).not.toBe(firstFingerprint);

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it('does not read published or staged workspace dist outputs while retaining source inputs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-ignore-dist-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    const cliCommonDir = join(rootDir, 'packages', 'cli-common');
    // Names produced by atomic_dir_swap, buildTypeScriptPackageDist and cli-common's dist publisher.
    const generatedDirs = [
      'dist',
      '.tmp.1788686160975.2429811.a72fa98fde7bb',
      '.tmp.1788686160975.2429811.a72fa98fde7bb.hstack-backup.2429811.1788686160976',
      '.backup.1788686160975.2429811.a72fa98fde7bb',
      '.dist.build.1788686160975.2429811.a72fa98fde7bb',
      '.dist.backup.1788686160975.2429811.a72fa98fde7bb',
      '.dist.hstack-stage-Ab12cD',
      '.dist.hstack-backup.2429811.1788686160975',
    ];
    const generatedFiles = generatedDirs.map((dir) => join(cliCommonDir, dir, 'runtime.js.map'));
    // A generic dot-directory or a matching name below src is not a package build-output root.
    const sourceFiles = [
      join(cliCommonDir, '.tmp.sources', 'runtime.ts'),
      join(cliCommonDir, 'src', generatedDirs[1]!, 'runtime.ts'),
    ];

    await mkdir(sourcesDir, { recursive: true });
    for (const file of [...generatedFiles, ...sourceFiles]) {
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, 'export const value = "before";\n', 'utf8');
    }

    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');
    await writeFile(
      join(uiDir, 'package.json'),
      JSON.stringify({
        name: '@happier-dev/ui',
        dependencies: {
          '@happier-dev/cli-common': '0.0.0',
        },
      }),
      'utf8',
    );
    await writeFile(join(cliCommonDir, 'package.json'), JSON.stringify({ name: '@happier-dev/cli-common' }), 'utf8');
    const { resolveUiWebSourceFingerprint } = await import('./uiWebSourceFingerprint');
    const firstFingerprint = resolveUiWebSourceFingerprint();
    const generatedReads = testState.fileReads.filter(({ path }) => generatedFiles.includes(path));
    expect({ files: generatedReads.length, bytes: generatedReads.reduce((total, read) => total + read.bytes, 0) })
      .toEqual({ files: 0, bytes: 0 });

    for (const file of generatedFiles) {
      await writeFile(file, 'export const value = "after ";\n', 'utf8');
    }
    expect(resolveUiWebSourceFingerprint()).toBe(firstFingerprint);

    let previousFingerprint = firstFingerprint;
    for (const file of sourceFiles) {
      await writeFile(file, 'export const value = "after ";\n', 'utf8');
      const nextFingerprint = resolveUiWebSourceFingerprint();
      expect(nextFingerprint).not.toBe(previousFingerprint);
      previousFingerprint = nextFingerprint;
    }

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it('ignores internal workspace TypeScript incremental build metadata', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-ignore-tsbuildinfo-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    const pluginSdkDir = join(rootDir, 'packages', 'plugin-sdk');
    const buildInfoFile = join(pluginSdkDir, '.tsbuildinfo');

    await mkdir(sourcesDir, { recursive: true });
    await mkdir(pluginSdkDir, { recursive: true });

    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');
    await writeFile(
      join(uiDir, 'package.json'),
      JSON.stringify({
        name: '@happier-dev/ui',
        dependencies: {
          '@happier-dev/plugin-sdk': '0.0.0',
        },
      }),
      'utf8',
    );
    await writeFile(
      join(pluginSdkDir, 'package.json'),
      JSON.stringify({ name: '@happier-dev/plugin-sdk' }),
      'utf8',
    );
    await writeFile(buildInfoFile, '{"version":"before"}\n', 'utf8');

    const firstFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();
    await writeFile(buildInfoFile, '{"version":"after"}\n', 'utf8');

    vi.resetModules();
    testState.repoRootDir = rootDir;
    const secondFingerprint = (await import('./uiWebSourceFingerprint')).resolveUiWebSourceFingerprint();

    expect(secondFingerprint).toBe(firstFingerprint);

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it('does not read Cargo workspace output while retaining Rust sources and lockfiles', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-cargo-'));
    testState.repoRootDir = rootDir;
    const uiDir = join(rootDir, 'apps', 'ui');
    const packageDir = join(rootDir, 'packages', 'iroh-native');
    const generatedFile = join(packageDir, 'rust', 'target', 'debug', 'native.o');
    const sourceFiles = [
      join(packageDir, 'rust', 'happier-iroh-core', 'src', 'lib.rs'),
      join(packageDir, 'rust', 'Cargo.toml'),
      join(packageDir, 'rust', 'Cargo.lock'),
      join(packageDir, 'src', 'target', 'browser.ts'),
    ];
    try {
      await mkdir(uiDir, { recursive: true });
      await writeFile(join(uiDir, 'package.json'), JSON.stringify({ dependencies: { '@happier-dev/iroh-native': '*' } }));
      for (const file of [generatedFile, ...sourceFiles]) {
        await mkdir(join(file, '..'), { recursive: true });
        await writeFile(file, 'before');
      }
      const { resolveUiWebSourceFingerprint } = await import('./uiWebSourceFingerprint');
      const firstFingerprint = resolveUiWebSourceFingerprint();
      const generatedReads = testState.fileReads.filter(({ path }) => path === generatedFile);
      expect({ files: generatedReads.length, bytes: generatedReads.reduce((total, read) => total + read.bytes, 0) })
        .toEqual({ files: 0, bytes: 0 });
      await writeFile(generatedFile, 'after');
      expect(resolveUiWebSourceFingerprint()).toBe(firstFingerprint);

      let previousFingerprint = firstFingerprint;
      for (const file of sourceFiles) {
        await writeFile(file, 'after');
        const nextFingerprint = resolveUiWebSourceFingerprint();
        expect(nextFingerprint).not.toBe(previousFingerprint);
        previousFingerprint = nextFingerprint;
      }
      await rm(join(packageDir, 'rust', 'Cargo.toml'));
      const withoutCargoWorkspace = resolveUiWebSourceFingerprint();
      await writeFile(generatedFile, 'now a source directory without a Cargo workspace');
      expect(resolveUiWebSourceFingerprint()).not.toBe(withoutCargoWorkspace);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('ignores transient ENOENT while hashing internal workspace files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-fingerprint-missing-file-'));
    testState.repoRootDir = rootDir;

    const uiDir = join(rootDir, 'apps', 'ui');
    const sourcesDir = join(uiDir, 'sources');
    const cliCommonDir = join(rootDir, 'packages', 'cli-common');
    const flakyFile = join(cliCommonDir, 'src', 'systemTasks', 'kinds', 'sshHostTrust.ts');

    await mkdir(sourcesDir, { recursive: true });
    await mkdir(join(cliCommonDir, 'src', 'systemTasks', 'kinds'), { recursive: true });

    await writeFile(join(uiDir, 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(uiDir, 'metro.config.js'), 'module.exports = {};\n', 'utf8');
    await writeFile(
      join(uiDir, 'package.json'),
      JSON.stringify({
        name: '@happier-dev/ui',
        dependencies: {
          '@happier-dev/cli-common': '0.0.0',
        },
      }),
      'utf8',
    );
    await writeFile(join(cliCommonDir, 'package.json'), JSON.stringify({ name: '@happier-dev/cli-common' }), 'utf8');
    await writeFile(flakyFile, 'export const trust = "placeholder";\n', 'utf8');

    testState.transientStatMissingPath = flakyFile;
    const { resolveUiWebSourceFingerprint } = await import('./uiWebSourceFingerprint');
    expect(() => resolveUiWebSourceFingerprint()).not.toThrow();
    expect(testState.transientStatMissingTriggered).toBe(true);

    await rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });
});
