import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { PluginManifestV2Schema } from '@happier-dev/protocol';

import { createPluginManifestV2Fixture } from '@/plugins/testkit/manifestV2Fixture';
import { PluginStateFileV1Schema } from '../state';
import {
  createLocalPathPluginDistributionIdentity,
  createNpmPluginDistributionIdentity,
  createPluginTrustRecord,
  type PluginDistributionIdentity,
} from '../install/trustIdentity';
import { readPluginRegistryCommitRecord } from './commitRecord';
import {
  createPluginRegistryStateStore,
  resolvePluginUpdatePolicyChangeRejection,
  type PluginRegistryRuntimeCandidate,
  type PluginRegistryRuntimeLifecycle,
} from './currentState';
import {
  prepareOwnedImmutablePluginGeneration,
  readInstallationStateRevision,
} from './generationStore';

const TEST_RUNTIME_LIFECYCLE: PluginRegistryRuntimeLifecycle = Object.freeze({
  prepare: async () => Object.freeze({
    abort: async () => undefined,
    adopt: async () => undefined,
  }),
});

type InstalledFixture = Readonly<{
  happyHomeDir: string;
  pluginId: string;
  store: ReturnType<typeof createPluginRegistryStateStore>;
  cleanup: () => Promise<void>;
}>;

async function installFixture(input: Readonly<{
  pluginId: string;
  distribution: 'npm' | 'localPath';
  updatePolicy: 'pinned' | 'allowed';
  preparedCandidates?: PluginRegistryRuntimeCandidate[];
}>): Promise<InstalledFixture> {
  const happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-update-policy-home-'));
  const pluginRoot = join(happyHomeDir, 'plugin');
  const manifestPath = join(pluginRoot, '.happier-plugin', 'plugin.json');
  await mkdir(join(pluginRoot, '.happier-plugin'), { recursive: true });
  await writeFile(join(pluginRoot, 'daemon.mjs'), 'export function activate() {}\n', 'utf8');
  const manifest = PluginManifestV2Schema.parse(createPluginManifestV2Fixture({
    id: input.pluginId,
    version: '1.0.0',
  }));
  await writeFile(
    manifestPath,
    JSON.stringify(manifest),
    'utf8',
  );

  const distribution: PluginDistributionIdentity = input.distribution === 'npm'
    ? createNpmPluginDistributionIdentity({
        registryOrigin: 'https://registry.npmjs.org',
        packageName: '@acme/update-policy-fixture',
      })
    : await createLocalPathPluginDistributionIdentity(pluginRoot);
  const trust = createPluginTrustRecord({ pluginId: input.pluginId, distribution, approvedAtMs: 1 });
  const catalogRecord = PluginStateFileV1Schema.parse({
    t: 'happier_plugin_state_v1',
    schemaVersion: 1,
    plugins: {
      [input.pluginId]: {
        source: {
          kind: input.distribution === 'npm' ? 'package' : 'path',
          locator: input.distribution === 'npm' ? '@acme/update-policy-fixture' : pluginRoot,
          trustPolicy: 'prompt',
          installPolicy: input.distribution === 'npm' ? 'copy' : 'link',
          resolvedPath: pluginRoot,
          manifestPath,
        },
        compatibility: { status: 'compatible', diagnostics: [] },
        install: {
          mode: input.distribution === 'npm' ? 'managed_install' : 'link',
          manifestVersion: '1.0.0',
          trust,
          updatePolicy: input.updatePolicy,
          optionalAccess: [],
        },
        state: { enabled: true },
      },
    },
  }).plugins[input.pluginId]!;

  const store = createPluginRegistryStateStore({
    happyHomeDir,
    runtimeLifecycle: input.preparedCandidates
      ? {
          prepare: async (candidate) => {
            input.preparedCandidates!.push(candidate);
            return TEST_RUNTIME_LIFECYCLE.prepare(candidate);
          },
        }
      : TEST_RUNTIME_LIFECYCLE,
  });
  const preparedGeneration = await prepareOwnedImmutablePluginGeneration({
    paths: store.paths,
    pluginId: input.pluginId,
    sourceRootPath: pluginRoot,
    manifestRelativePath: '.happier-plugin/plugin.json',
    distribution,
    updatePolicy: input.updatePolicy,
    createdAtMs: 1,
  });
  const committed = await store.install({
    pluginId: input.pluginId,
    catalogRecord,
    trust,
    updatePolicy: input.updatePolicy,
    optionalAccess: [],
    approvedAuthorityManifest: manifest,
    preparedGeneration,
  });
  await preparedGeneration.cleanup();
  if (committed.status !== 'committed') {
    throw new Error(`Update-policy fixture install did not commit (${committed.status})`);
  }

  return Object.freeze({
    happyHomeDir,
    pluginId: input.pluginId,
    store,
    cleanup: async () => await rm(happyHomeDir, { recursive: true, force: true }),
  });
}

async function readDurableInstallation(fixture: InstalledFixture) {
  const commit = await readPluginRegistryCommitRecord(fixture.store.paths);
  if (!commit) throw new Error('Expected a current plugin registry commit');
  const revision = await readInstallationStateRevision({
    paths: fixture.store.paths,
    reference: commit.installationState,
  });
  return revision.plugins[fixture.pluginId]!;
}

describe('createPluginRegistryStateStore.setUpdatePolicyWithResult', () => {
  it('atomically updates the runtime catalog and durable revision while preserving every unrelated installed fact', async () => {
    const preparedCandidates: PluginRegistryRuntimeCandidate[] = [];
    const fixture = await installFixture({
      pluginId: 'acme.policy-npm',
      distribution: 'npm',
      updatePolicy: 'pinned',
      preparedCandidates,
    });
    const before = await readDurableInstallation(fixture);
    const catalogBefore = (await fixture.store.read()).plugins[fixture.pluginId]!;

    const result = await fixture.store.setUpdatePolicyWithResult(
      fixture.pluginId,
      'allowed',
    );
    expect(result?.transaction.status).toBe('committed');
    expect(result?.catalog.plugins[fixture.pluginId]?.install.updatePolicy)
      .toBe('allowed');
    expect(preparedCandidates.at(-1)).toMatchObject({
      mutationKind: 'state',
      changedPluginIds: [],
      runningSessionDisposition: 'retainRunningSessions',
    });

    const after = await readDurableInstallation(fixture);
    expect(after.updatePolicy).toBe('allowed');
    // Every other durable installed fact is preserved verbatim.
    expect({ ...after, updatePolicy: before.updatePolicy }).toEqual(before);

    const catalogAfter = (await fixture.store.read()).plugins[fixture.pluginId]!;
    expect(catalogAfter).toEqual({
      ...catalogBefore,
      install: { ...catalogBefore.install, updatePolicy: 'allowed' },
    });
    // The generation reference this installation serves from is untouched.
    const commit = await readPluginRegistryCommitRecord(fixture.store.paths);
    expect(commit?.pluginOccurrenceIds[fixture.pluginId]).toBeDefined();

    await fixture.cleanup();
  });

  it('rejects bundled and untrusted records at the canonical policy owner', async () => {
    const fixture = await installFixture({
      pluginId: 'acme.policy-rejections',
      distribution: 'npm',
      updatePolicy: 'allowed',
    });
    const installed = (await fixture.store.read()).plugins[fixture.pluginId]!;

    expect(resolvePluginUpdatePolicyChangeRejection({
      ...installed,
      source: { ...installed.source, kind: 'bundled', locator: 'acme.policy-rejections' },
    }, 'pinned')).toMatchObject({ code: 'plugin_update_policy_unsupported' });
    expect(resolvePluginUpdatePolicyChangeRejection({
      ...installed,
      source: { ...installed.source, trustPolicy: 'untrusted' },
      install: { ...installed.install, trust: undefined },
    }, 'pinned')).toMatchObject({ code: 'plugin_update_trust_unavailable' });
    expect(resolvePluginUpdatePolicyChangeRejection(undefined, 'pinned'))
      .toMatchObject({ code: 'plugin_not_found' });

    await fixture.cleanup();
  });

  it('allows the real freeze policy on every trusted non-bundled distribution', async () => {
    const fixture = await installFixture({
      pluginId: 'acme.policy-path',
      distribution: 'localPath',
      updatePolicy: 'allowed',
    });

    await expect(fixture.store.setUpdatePolicyWithResult(fixture.pluginId, 'allowed'))
      .resolves.toBeNull();
    // Every trusted non-bundled source can be pinned and unpinned.
    await expect(fixture.store.setUpdatePolicyWithResult(fixture.pluginId, 'pinned'))
      .resolves.toMatchObject({ transaction: { status: 'committed' } });
    await expect(readDurableInstallation(fixture)).resolves.toMatchObject({ updatePolicy: 'pinned' });
    await expect(fixture.store.setUpdatePolicyWithResult(fixture.pluginId, 'allowed'))
      .resolves.toMatchObject({ transaction: { status: 'committed' } });

    await fixture.cleanup();
  });

  it('is idempotent for an already current policy and rejects an unknown plugin id', async () => {
    const fixture = await installFixture({
      pluginId: 'acme.policy-idempotent',
      distribution: 'npm',
      updatePolicy: 'pinned',
    });
    const commitBefore = await readPluginRegistryCommitRecord(fixture.store.paths);

    await expect(fixture.store.setUpdatePolicyWithResult(fixture.pluginId, 'pinned'))
      .resolves.toBeNull();
    const commitAfter = await readPluginRegistryCommitRecord(fixture.store.paths);
    expect(commitAfter?.revision).toBe(commitBefore?.revision);

    await expect(fixture.store.setUpdatePolicyWithResult('acme.absent', 'pinned'))
      .rejects.toThrow(/Unknown plugin id/i);

    await fixture.cleanup();
  });
});
