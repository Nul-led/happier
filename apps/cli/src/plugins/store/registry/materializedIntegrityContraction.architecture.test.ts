import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RETIRED_MATERIALIZED_INTEGRITY_TERMS = Object.freeze([
  'PredecessorAlgorithmQualifiedDigestSchema',
  'PredecessorImmutablePluginGenerationRecordSchema',
  'PredecessorPluginRegistryCommitRecordSchema',
  'buildDaemonEntryFingerprint',
  'createManagedServiceIdentityFingerprint',
  'createOpenRequestFingerprint',
  'generationRecordDigest',
  'generationFingerprint',
  'grantDigest',
  'installedUiArtifactDigest',
  'moduleDigest',
  'openRequestFingerprint',
  'packageDigest',
  'predecessorJsonDigest',
  'predecessorSha256',
  'RunnerAgentExecutionGrantV1',
  'agentRuntimeDaemonServiceGrantDigest',
  'runtimeBindingDigest',
  'runtimeDigest',
  'runnerManagedServiceSupervisionGrantIdentity',
  'RETIRED_BUNDLED_IMMUTABLE_GENERATION_IDS_BY_IDENTITY',
  'sameBundledSourceArtifactIntegrity',
  'supervisionGrantIdentity',
  'verifyGenerationRootFiles',
  'verifyPredecessorPersistedGeneration',
]);

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));

/**
 * The unpublished V1 registry reconciliation subsystem is retired. Its pinned
 * producer wrote no record in any retained store, so no predecessor bytes
 * remain to convert and no exemption from the retired-term contraction
 * survives.
 */
const RETIRED_UNPUBLISHED_RECONCILIATION_PATHS = Object.freeze([
  'apps/cli/src/plugins/store/registry/unpublishedV1Reconciliation.ts',
  'apps/cli/scripts/reconcileUnpublishedPluginRegistryV1.ts',
  'apps/cli/scripts/__tests__/reconcileUnpublishedPluginRegistryV1.test.ts',
]);

const PRODUCTION_ROOTS = Object.freeze([
  join(REPOSITORY_ROOT, 'apps/cli/src/plugins'),
  join(REPOSITORY_ROOT, 'apps/cli/src/daemon'),
  join(REPOSITORY_ROOT, 'apps/cli/src/agent/runtime'),
  join(REPOSITORY_ROOT, 'apps/cli/src/session'),
  join(REPOSITORY_ROOT, 'packages/plugins'),
  join(REPOSITORY_ROOT, 'packages/agents/src'),
  join(REPOSITORY_ROOT, 'packages/protocol/src'),
]);
const IGNORED_SOURCE_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'package-dist',
  'coverage',
  '.happier',
  '.happier-plugin',
]);

async function readProductionSources(root: string): Promise<ReadonlyArray<Readonly<{
  relativePath: string;
  source: string;
}>>> {
  const sources: Array<Readonly<{ relativePath: string; source: string }>> = [];

  async function visit(directory: string): Promise<void> {
    await Promise.all((await readdir(directory, { withFileTypes: true })).map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_SOURCE_DIRECTORIES.has(entry.name) || entry.name.startsWith('.tmp.')) return;
        await visit(path);
        return;
      }
      if (
        !entry.isFile()
        || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx'))
        || entry.name.endsWith('.test.ts')
        || entry.name.endsWith('.test.tsx')
        || entry.name.endsWith('.spec.ts')
        || entry.name.endsWith('.spec.tsx')
      ) return;
      sources.push(Object.freeze({
        relativePath: relative(REPOSITORY_ROOT, path),
        source: await readFile(path, 'utf8'),
      }));
    }));
  }

  await visit(root);
  return sources;
}

let productionSourcesPromise: Promise<ReadonlyArray<Readonly<{
  relativePath: string;
  source: string;
}>>> | undefined;

function readAllProductionSources(): Promise<ReadonlyArray<Readonly<{
  relativePath: string;
  source: string;
}>>> {
  productionSourcesPromise ??= Promise.all(PRODUCTION_ROOTS.map(readProductionSources))
    .then((sources) => sources.flat());
  return productionSourcesPromise;
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await stat(join(REPOSITORY_ROOT, relativePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return false;
    throw error;
  }
}

describe('plugin generation materialized-integrity contraction', () => {
  it('removes retired custom content hashes from production readers', async () => {
    const productionSources = await readAllProductionSources();

    for (const { relativePath, source } of productionSources) {
      for (const term of RETIRED_MATERIALIZED_INTEGRITY_TERMS) {
        if (!source.includes(term)) continue;
        expect.fail(`${relativePath} retains ${term}`);
      }
    }
  });

  it('retires the unpublished V1 reconciliation subsystem entirely', async () => {
    const retained = (await Promise.all(RETIRED_UNPUBLISHED_RECONCILIATION_PATHS.map(
      async (relativePath) => (await pathExists(relativePath) ? relativePath : null),
    ))).filter((relativePath): relativePath is string => relativePath !== null);
    expect(retained).toEqual([]);

    const references = (await readAllProductionSources())
      .filter(({ source }) => source.includes('unpublishedV1Reconciliation'))
      .map(({ relativePath }) => relativePath);
    expect(references).toEqual([]);
  });

  it('removes bundled immutable-generation artifact authority from runtime and build generation', async () => {
    const productionSources = await readAllProductionSources();
    const runtimeIntegrityReaders = productionSources.filter(({ source }) => (
      source.includes('BUNDLED_FIRST_PARTY_SOURCE_ARTIFACT_INTEGRITIES')
    ));
    expect(runtimeIntegrityReaders).toEqual([]);

    const generatorSource = await readFile(
      join(
        REPOSITORY_ROOT,
        'apps/cli/scripts/build-owned/generateBundledPluginEntries.ts',
      ),
      'utf8',
    );
    expect(generatorSource).not.toContain(
      'assignBundledImmutableArtifactGenerationIds',
    );
    expect(generatorSource).not.toContain('sourceArtifactIntegrity');
    expect(generatorSource).not.toContain(
      'generatedBundledPluginArtifacts',
    );
  });
});
