import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const RETIRED_SOURCE_DIRECTORIES = [
  'workspaces/replication',
  'session/handoff/workspaceReplication',
] as const;

function importedModuleSpecifiers(source: string): string[] {
  // TypeScript's own import preprocessor recognizes static imports, exports,
  // import-equals, dynamic imports, CommonJS require calls, interposed comments,
  // and escaped string-literal characters without binding a full Program for
  // every CLI source file. The rule is intentionally syntactic: production code
  // must not spell a forbidden module reference even through a shadowed helper.
  return ts.preProcessFile(source, true, true).importedFiles
    .map(({ fileName }) => fileName.replaceAll('\\', '/'));
}

function isRetiredWorkspaceEngineSpecifier(specifier: string): boolean {
  return /(?:^|\/)workspaces\/replication(?:\/|$)/u.test(specifier)
    || /(?:^|\/)session\/handoff\/workspaceReplication(?:\/|$)/u.test(specifier);
}

function importsRetiredWorkspaceEngine(source: string): boolean {
  return importedModuleSpecifiers(source).some(isRetiredWorkspaceEngineSpecifier);
}

function isTestkitBrokerClientSpecifier(specifier: string): boolean {
  return /(?:^|\/)workspaceSyncBrokerClient(?:\.testkit)?(?:\.js)?$/u.test(specifier);
}

function importsTestkitBrokerClient(source: string): boolean {
  return importedModuleSpecifiers(source).some(isTestkitBrokerClientSpecifier);
}

async function collectSourceFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'testkit' || entry.name === '__tests__' || entry.name.startsWith('.tmp.hstack-')) {
        return [];
      }
      return collectSourceFiles(entryPath);
    }
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) {
      return [];
    }
    // Tests may mention retired paths while asserting compatibility behavior;
    // production imports are the architecture boundary guarded here.
    if (/(?:\.testkit|\.test|\.spec|\.architecture)\.tsx?$/u.test(entry.name)) {
      return [];
    }
    return [entryPath];
  }));
  return files.flat();
}

async function collectAllFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });
  const files = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) return collectAllFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  }));
  return files.flat();
}

let productionSourcesPromise: Promise<ReadonlyArray<Readonly<{
  path: string;
  specifiers: readonly string[];
}>>> | undefined;

function loadProductionSources(): Promise<ReadonlyArray<Readonly<{
  path: string;
  specifiers: readonly string[];
}>>> {
  productionSourcesPromise ??= (async () => {
    const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
    const sourceFiles = await collectSourceFiles(sourceRoot);
    return Promise.all(sourceFiles.map(async (path) => ({
      path,
      specifiers: importedModuleSpecifiers(await readFile(path, 'utf8')),
    })));
  })();
  return productionSourcesPromise;
}

describe('workspace sync legacy surface architecture', () => {
  it('recognizes every TypeScript import form that could revive a retired workspace engine', () => {
    for (const source of [
      `import '@/workspaces/replication/engine';`,
      `import engine from '@/workspaces/replication/engine';`,
      `export { engine } from '@/workspaces/replication/engine';`,
      `import /* retain comments between tokens */ '@/workspaces/replication/engine';`,
      `export { engine } from /* retain comments between tokens */ '@/workspaces/replication/engine';`,
      `import '@/workspaces/\u0072eplication/engine';`,
      `void import('@/session/handoff/workspaceReplication/adapter');`,
      `void import(/* retain comments between tokens */ '@/session/handoff/workspaceReplication/adapter');`,
      `void import('@/session/handoff/workspace\u0052eplication/adapter');`,
      `require('@/workspaces/replication/engine');`,
      `import engine = require('@/workspaces/replication/engine');`,
    ]) {
      expect(importsRetiredWorkspaceEngine(source), source).toBe(true);
    }
  });

  it('ignores retired-path text that is not a TypeScript module reference', () => {
    for (const source of [
      `// import '@/workspaces/replication/engine';`,
      `const note = "require('@/workspaces/replication/engine')";`,
      `const template = \`import('@/session/handoff/workspaceReplication/adapter')\`;`,
    ]) {
      expect(importsRetiredWorkspaceEngine(source), source).toBe(false);
    }
  });

  it('recognizes production import forms for the test-only TypeScript broker client', () => {
    for (const source of [
      `import './transport/workspaceSyncBrokerClient.testkit';`,
      `import { WorkspaceSyncBrokerClient } from './transport/workspaceSyncBrokerClient.testkit';`,
      `export * from './transport/workspaceSyncBrokerClient.testkit.js';`,
      `export * from /* retain comments between tokens */ './transport/workspaceSyncBrokerClient.testkit.js';`,
      `void import('./transport/workspaceSyncBrokerClient.testkit');`,
      `void import(/* retain comments between tokens */ './transport/workspaceSyncBrokerClient.testkit');`,
      `require('./transport/workspaceSyncBrokerClient.testkit');`,
    ]) {
      expect(importsTestkitBrokerClient(source), source).toBe(true);
    }
  });

  it('ignores broker-client text that is not a TypeScript module reference', () => {
    for (const source of [
      `// import './transport/workspaceSyncBrokerClient.testkit';`,
      `const note = "require('./transport/workspaceSyncBrokerClient.testkit')";`,
    ]) {
      expect(importsTestkitBrokerClient(source), source).toBe(false);
    }
  });

  it('does not retain retired workspace replication source trees', async () => {
    const sourceRoot = new URL('../../', import.meta.url);
    for (const relativePath of RETIRED_SOURCE_DIRECTORIES) {
      const retiredRoot = fileURLToPath(new URL(`${relativePath}/`, sourceRoot));
      expect(await collectAllFiles(retiredRoot)).toEqual([]);
    }
  });

  it('keeps retired workspace replication and testkit broker imports out of production sources', async () => {
    const retiredViolations: string[] = [];
    const testkitViolations: string[] = [];
    for (const { path, specifiers } of await loadProductionSources()) {
      if (specifiers.some(isRetiredWorkspaceEngineSpecifier)) {
        retiredViolations.push(path);
      }
      if (specifiers.some(isTestkitBrokerClientSpecifier)) {
        testkitViolations.push(path);
      }
    }
    expect(retiredViolations).toEqual([]);
    expect(testkitViolations).toEqual([]);
  }, 30_000);
});
