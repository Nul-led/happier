import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { INTERNAL_CLAUDE_EVENT_TYPES } from '../../../../packages/plugins/claude/src/agent/transcripts/internalEventTypes';
import * as piDefinition from '../../../../packages/plugins/pi/src/agent/definition';
import * as codexDefinition from '../../../../packages/plugins/codex/src/agent/definition';
import * as claudeDefinition from '../../../../packages/plugins/claude/src/agent/definition';

import {
  collectBundledPluginUiTranslations,
  reconcileBundledPluginInstalledRuntime,
  readExternalSessionSourceDeclaration,
  renderRetainedCliBundledPluginImplementationEntriesTs,
  resolveGeneratorPackagedRuntimePreparation,
  selectCanonicalRuntimeWorkspacePackageRoots,
  publishBundledPluginSemanticProjection,
  readInheritedBundledPluginFailures,
} from './generateBundledPluginEntries.ts';
import { renderBundledAgentDefinitionsTs } from './bundledPlugins/agentFacts.ts';
import { renderBundledVoiceRuntimeEntriesTs } from './bundledPlugins/voice.ts';
import { readBundledAgentNativeHomeEnvironmentKeys } from '../../../stack/scripts/utils/env/scrub_env.mjs';
import { readAgentNativeHomeEnvironmentKeys } from '../../src/plugins/authoring/agentNativeHomeEnvironmentKeys';
import { renderGeneratedExternalSessionSourcesTs } from './bundledPlugins/protocol.ts';
import { ingestPluginManifestV2 } from '@happier-dev/protocol/plugins/manifest';
import { parseGeneratorCliArgs } from './bundledPlugins/options.ts';
import { withWorkspaceBundleLock } from '../../../../packages/cli-common/workspaceBundleLock.mjs';
import { readBundledPluginPublicationFailures, writeBundledPluginPublicationFailures } from '../../../../scripts/workspaces/bundledPluginPublicationFailure.mjs';
import { requiresBundledPackagedRuntime } from './bundledPackagedRuntimeEligibility.ts';
import {
  createPackageLayoutSandbox,
  writeBundledPluginSourceInputs,
  writeCliBundledHostPackage,
  writeWorkspacePackageFixture,
} from '../__tests__/testkit/packageLayoutSandbox';
import { prepareBundledWorkspaceDependenciesForCli } from '../buildSharedDeps.mjs';
import { ensureWorkspacePackagesBuiltByName } from '../../../../scripts/workspaces/ensureWorkspacePackagesBuilt.mjs';
import {
  BUNDLED_AGENT_DEFINITIONS_BY_ID,
} from '../../../../packages/agents/src/generated/bundledAgentDefinitions';

const generatorSource = readFileSync(new URL('./generateBundledPluginEntries.ts', import.meta.url), 'utf8');
const registryRendererSource = readFileSync(new URL('./bundledPlugins/registry.ts', import.meta.url), 'utf8');
const voiceRendererSource = readFileSync(new URL('./bundledPlugins/voice.ts', import.meta.url), 'utf8');

describe('generated output ownership', () => {
  it.each([
    [piDefinition, 'PI_CODING_AGENT_DIR'],
    [codexDefinition, 'CODEX_HOME'],
    [claudeDefinition, 'CLAUDE_CONFIG_DIR'],
  ] as const)('exposes native-home declarations from static Agent source before runtime publication (%s)', (definition, key) => {
    const exports: Readonly<Record<string, unknown>> = definition;
    expect(readAgentNativeHomeEnvironmentKeys(exports.AGENT_STATE_SHARING_DESCRIPTOR)).toEqual([key]);
  });
  it('re-evaluates prior UI publication failures instead of inheriting stale build exclusions', () => {
    const { repoRoot, happyCliDir, cleanup } = createPackageLayoutSandbox('happier-ui-recovery-');
    try {
      const failurePath = join(happyCliDir, '.project/tmp/bundled-plugin-publication/failures.json');
      mkdirSync(join(failurePath, '..'), { recursive: true });
      writeFileSync(failurePath, JSON.stringify([{
        packageName: '@happier-dev/plugins-inspector', pluginId: 'happier.inspector',
        diagnostic: { code: 'plugin_ui_artifact_invalid', message: 'previous UI build failed' },
      }]));
      expect(readInheritedBundledPluginFailures(false, repoRoot)).toEqual([]);
    } finally { cleanup(); }
  });
  it('publishes an empty native-home list for source without state-sharing declarations', () => {
    const output = renderBundledAgentDefinitionsTs({
      agentIds: [], agentDefinitionsById: {}, nativeHomeEnvironmentKeys: [],
    });
    expect(output).toContain('BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS: readonly string[] = Object.freeze([])');
  });
  it('projects the released output reader declaration from the Claude private classifier', () => {
    expect(BUNDLED_AGENT_DEFINITIONS_BY_ID.claude?.releasedOutputTranscriptRecordReader?.nonTranscriptRecordTypes)
      .toEqual([...INTERNAL_CLAUDE_EVENT_TYPES]);
  });
  it('leaves the app-preseed byte registry to the apps/ui prebuild owner', () => {
    expect(generatorSource).not.toContain('generatedBundledPluginUiArtifacts');
    expect(generatorSource).not.toContain('collectBundledPluginUiAppArtifactSources');
    expect(generatorSource).not.toContain('renderBundledPluginUiAppArtifactInventoryTs');
  });

  it('carries native-home keys in the existing Agent facts projection as JSON-readable data', () => {
    const output = renderBundledAgentDefinitionsTs({
      agentIds: [],
      agentDefinitionsById: {},
      nativeHomeEnvironmentKeys: ['CUSTOM_AGENT_ROOT', 'ANOTHER_AGENT_ROOT'],
    });
    const keys = output.match(/BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS[^=]*= Object\.freeze\((\[[\s\S]*?\])\);/u)?.[1];
    expect(keys).toBeDefined();
    expect(JSON.parse(keys!)).toEqual(['CUSTOM_AGENT_ROOT', 'ANOTHER_AGENT_ROOT']);
  });

  it('round-trips static native-home declarations to Stack and rejects missing projection authority', () => {
    const root = mkdtempSync(join(tmpdir(), 'happier-native-home-projection-'));
    const path = join(root, 'facts.ts');
    try {
      expect(() => readBundledAgentNativeHomeEnvironmentKeys(path)).toThrow(/native-home projection/u);
      writeFileSync(path, renderBundledAgentDefinitionsTs({
        agentIds: [], agentDefinitionsById: {},
        nativeHomeEnvironmentKeys: readAgentNativeHomeEnvironmentKeys({
          nativeHome: { environmentKey: 'CUSTOM_AGENT_ROOT' },
          config: { entries: [{ mode: 'env_redirect', envVar: 'CUSTOM_AGENT_ROOT' }] },
          state: { entries: [{ mode: 'env_redirect', envVar: 'CUSTOM_AGENT_STATE' }] },
        }),
      }));
      expect(readBundledAgentNativeHomeEnvironmentKeys(path)).toEqual(['CUSTOM_AGENT_ROOT', 'CUSTOM_AGENT_STATE']);
      writeFileSync(path, 'export const BUNDLED_AGENT_NATIVE_HOME_ENVIRONMENT_KEYS = Object.freeze(null);');
      expect(() => readBundledAgentNativeHomeEnvironmentKeys(path)).toThrow(/native-home projection/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('packaged runtime eligibility', () => {
  const declarativeOnlyOwner = {
    hasDaemonEntrypoint: false,
    hasResources: false,
    requiresSessionRunnerFactory: false,
    hasManagedProviderRuntime: false,
    hasConnectedAccountDescriptors: false,
  } as const;

  it.each([
    'hasDaemonEntrypoint',
    'hasResources',
    'requiresSessionRunnerFactory',
    'hasManagedProviderRuntime',
    'hasConnectedAccountDescriptors',
  ] as const)('requires packaged bytes for the independent %s owner', (owner) => {
    expect(requiresBundledPackagedRuntime({
      ...declarativeOnlyOwner,
      [owner]: true,
    })).toBe(true);
  });

  it('does not require packaged bytes for a declarative-only owner', () => {
    expect(requiresBundledPackagedRuntime(declarativeOnlyOwner)).toBe(false);
  });
});

function sourceBetween(startMarker: string, endMarker: string, source = generatorSource): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Missing generator source range ${startMarker}…${endMarker}`);
  }
  return source.slice(start, end);
}

describe('generator workspace lock policy', () => {
  it('keeps API governance in the SDK check and prepack lanes', () => {
    const synchronization = sourceBetween(
      'async function synchronizeGeneratorAuthoringRuntimeClosure(',
      'type PluginAuthorRuntimeModules =',
    );
    expect(synchronization).not.toContain('api-governance:prepared');
    expect(synchronization).toContain(
      "await sync(false, GENERATOR_BUILD_PREP_STAMP_PATH, ['plugin-sdk']);",
    );
    expect(generatorSource).not.toContain('publishPluginSdkApiGovernanceOutputs');
  });

  it('keeps check-mode generated compiler-input preparation read-only', () => {
    const synchronization = sourceBetween(
      'async function synchronizeGeneratorAuthoringRuntimeClosure(',
      'type PluginAuthorRuntimeModules =',
    );

    expect(synchronization).toContain(
      'generatedCompilerInputMode: preparationPolicy.generatedCompilerInputMode,',
    );
    expect(synchronization).not.toContain("generatedCompilerInputMode: 'write',");
  });

  it('carries the publication lease into packaged-runtime workspace preparation', () => {
    const synchronization = sourceBetween(
      'async function prepareSelectedBundledPluginWorkspaceOutputs(',
      'type PluginAuthorRuntimeModules =',
    );

    // A caller's authenticated inherited lease remains usable. The generator
    // no longer acquires a containing lease around this package preparation.
    expect(synchronization).toContain(
      `env: createWorkspaceChildBuildEnv({
      env: process.env,
      heldLockValue: input.inheritedLockValue,
    }),`,
    );
  });

  it('prepares the authoring runtime for scoped workspace publication too', () => {
    const mainSource = sourceBetween(
      'export async function main(',
      "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)",
    );

    expect(mainSource).toContain('if (!options.aggregateOnly) {');
    expect(mainSource).not.toContain(
      'options.workspaceNames.length === 0 && !options.aggregateOnly',
    );
    expect(mainSource).toContain(
      'await synchronizeGeneratorAuthoringRuntimeClosure(',
    );
    expect(mainSource.indexOf('await loadPluginAuthorRuntimeForScope(authorRuntimeLoadScope);'))
      .toBeGreaterThan(mainSource.indexOf('await withGeneratorPublicationLock('));
  });

  it('keeps source-synchronized projections read-only during target-owned publication', () => {
    const projectionPublisher = sourceBetween(
      'async function publishBundledPluginSemanticProjection(',
      'function collectBundledAgentContributionIdentities(',
    );
    const targetedPublisher = sourceBetween(
      'if (options.workspaceNames.length > 0) {',
      '// Discover and validate every package before mutating host membership.',
    );
    const packagedRuntimePublisher = sourceBetween(
      'async function prepareBundledPluginPackageArtifacts(',
      'const BUNDLED_PLUGIN_WORKSPACE_PACKAGE_PREFIX',
    );
    const mainSource = sourceBetween(
      'export async function main(',
      "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)",
    );

    expect(projectionPublisher).toContain('...(!options.targetOwnedOnly');
    expect(projectionPublisher).toContain('? [{ outPath: cliManifestOutPath, out: cliManifestOut }]');
    expect(targetedPublisher).toContain('? [{ outPath: cliOutPath, out: cliOut }]');
    expect(packagedRuntimePublisher).toContain(
      "params.mode === 'check' || params.targetOwnedOnly === true",
    );
    expect(mainSource).toContain('targetOwnedOnly: options.targetOwnedOnly,');
    expect(generatorSource).toContain('const mode: Mode = input.options.mode;');
    expect(generatorSource).not.toContain(
      "const mode: Mode = input.options.targetOwnedOnly ? 'check' : input.options.mode;",
    );
  });

  it('publishes generated compiler inputs under the canonical lock without the authoring closure', () => {
    // `--compiler-inputs` is the pre-build choke point `buildSharedDeps.mjs`
    // runs before `agents`/`cli-common`/`plugin-sdk` compile. Preparing the
    // authoring runtime closure here would compile the very packages this mode
    // exists to unblock. The existing publication lock is still required around
    // its read/compare/write transaction, and the inherited lease makes the
    // nested full-publication call safely reentrant.
    const mainSource = sourceBetween(
      'export async function main(',
      "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)",
    );

    expect(mainSource).toContain('if (options.compilerInputsOnly) {');
    expect(mainSource.indexOf('if (options.compilerInputsOnly) {'))
      .toBeLessThan(mainSource.indexOf('await synchronizeGeneratorAuthoringRuntimeClosure('));

    const dispatch = mainSource.slice(
      mainSource.indexOf('if (options.compilerInputsOnly) {'),
      mainSource.indexOf('const authorRuntimeLoadScope ='),
    );
    expect(dispatch).toContain('await withGeneratorPublicationLock(');
    expect(dispatch).toContain(
      'async (context) => await publishGeneratedCompilerInputs(options, context),',
    );
    expect(dispatch).toContain('inheritedLockValue,');
    expect(dispatch).toContain('return;');
    expect(dispatch).not.toContain('await synchronizeGeneratorAuthoringRuntimeClosure(');
    expect(dispatch).not.toContain('await withGeneratorWorkspaceLock(');
  });

  it('uses the prepared publication owner for dependency loading and commit', () => {
    const publicationLock = sourceBetween(
      'async function withGeneratorPublicationLock<T>(',
      'export async function main(',
    );
    const mainSource = sourceBetween(
      'export async function main(',
      "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)",
    );

    expect(publicationLock).toContain('return await withPreparedGeneratorPublication({');
    expect(publicationLock).toContain('prepare,');
    expect(publicationLock).toContain('heldLockValue,');
    expect(publicationLock).not.toContain('loadGeneratorWorkspaceDependencies');
    expect(mainSource).toContain('await withGeneratorPublicationLock(');
    expect(mainSource).toContain('const dependencies = await loadGeneratorWorkspaceDependencies();');
    expect(mainSource).toContain('inheritedLockValue,');
  });

  it('publishes runtime-consumed Agent facts in a private child before parent runtime loading', () => {
    const privatePhase = sourceBetween(
      'async function runRuntimeConsumedAgentFactsPrivatePhase(',
      'async function collectBundledPluginPackages(',
    );
    const mainSource = sourceBetween(
      'export async function main(',
      "if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)",
    );
    const directEntry = generatorSource.slice(
      generatorSource.indexOf("if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)"),
    );

    expect(generatorSource).not.toContain('beforeRuntimeStaging');
    expect(privatePhase).toContain('await collectBundledPluginSourcePackages({');
    expect(privatePhase.indexOf('throwBundledPluginPackageFailures('))
      .toBeLessThan(privatePhase.indexOf('publishCoherentProjectionOutputs('));
    expect(privatePhase.indexOf('collectBundledAgentDefinitionProjection('))
      .toBeLessThan(privatePhase.indexOf('publishCoherentProjectionOutputs('));
    expect(mainSource).toContain('await publishGeneratedCompilerInputs(options, publicationLease);');
    expect(mainSource).not.toContain('await runCanonicalPluginSdkGeneratedCompilerInputs({');
    expect(mainSource.indexOf('await publishGeneratedCompilerInputs(options, publicationLease);'))
      .toBeLessThan(mainSource.indexOf('await runRuntimeConsumedAgentFactsPrivateChild(argv, inheritedLockValue);'));
    expect(mainSource).toContain('await runRuntimeConsumedAgentFactsPrivateChild(argv, inheritedLockValue);');
    expect(privatePhase).not.toContain('await synchronizeGeneratorAuthoringRuntimeClosure(');
    expect(mainSource).not.toContain('inheritedLockValue: publicationLease.heldLockValue');
    expect(directEntry).toContain('async () => await synchronizeGeneratorAuthoringRuntimeClosure(');
    expect(directEntry).toContain('PRIVATE_RUNTIME_CONSUMED_AGENT_FACTS_PHASE_ENV');
    expect(directEntry.indexOf('delete process.env[PRIVATE_RUNTIME_CONSUMED_AGENT_FACTS_PHASE_ENV];'))
      .toBeLessThan(directEntry.indexOf('runRuntimeConsumedAgentFactsPrivatePhase('));
    expect(directEntry).toContain('runRuntimeConsumedAgentFactsPrivatePhase(');
  });

  it('converges real single-file and code-split runtimes in one writer before a fresh all-scope check', async () => {
    const canonicalRoot = fileURLToPath(new URL('../../../..', import.meta.url));
    const generatorPath = fileURLToPath(new URL('./generateBundledPluginEntries.ts', import.meta.url));
    const { repoRoot, happyCliDir, cleanup } = createPackageLayoutSandbox(
      'happier-bundled-phase-convergence-',
    );
    try {
      mkdirSync(resolve(repoRoot, 'scripts/workspaces'), { recursive: true });
      cpSync(
        resolve(canonicalRoot, 'scripts/workspaces/workspaceBundleLock.mjs'),
        resolve(repoRoot, 'scripts/workspaces/workspaceBundleLock.mjs'),
      );
      writeCliBundledHostPackage({
        happyCliDir,
        bundledDependencies: [
          '@happier-dev/agents',
          '@happier-dev/cli-common',
          '@happier-dev/plugin-sdk',
          '@happier-dev/protocol',
          '@happier-dev/release-runtime',
          '@happier-dev/plugins-antigravity',
          '@happier-dev/plugins-claude',
          '@happier-dev/plugins-codex',
          '@happier-dev/plugins-ohmypi',
          '@happier-dev/plugins-opencode',
          '@happier-dev/plugins-pi',
        ],
        dependencies: {
          '@happier-dev/plugins-antigravity': '0.0.0',
          '@happier-dev/plugins-claude': '0.0.0',
          '@happier-dev/plugins-codex': '0.0.0',
          '@happier-dev/plugins-ohmypi': '0.0.0',
          '@happier-dev/plugins-opencode': '0.0.0',
          '@happier-dev/plugins-pi': '0.0.0',
        },
      });
      const fixtureCliPackageJsonPath = resolve(happyCliDir, 'package.json');
      const fixtureCliPackageJson = JSON.parse(
        readFileSync(fixtureCliPackageJsonPath, 'utf8'),
      ) as Record<string, unknown>;
      writeFileSync(
        fixtureCliPackageJsonPath,
        `${JSON.stringify({ ...fixtureCliPackageJson, type: 'module' }, null, 2)}\n`,
      );
      for (const workspacePath of [
        'packages/agents',
        'packages/cli-common',
        'packages/plugin-sdk',
        'packages/protocol',
        'packages/release-runtime',
        'packages/plugins/antigravity',
        'packages/plugins/claude',
        'packages/plugins/codex',
        'packages/plugins/ohmypi',
        'packages/plugins/opencode',
        'packages/plugins/pi',
      ]) {
        cpSync(
          resolve(canonicalRoot, workspacePath),
          resolve(repoRoot, workspacePath),
          {
            recursive: true,
            filter: (candidate) => {
              const segments = candidate.split(/[\\/]/u);
              return !segments.includes('node_modules')
                && !segments.at(-1)?.startsWith('.tmp.');
            },
          },
        );
      }
      const fixtureWorkspaceNames = [
        'agents',
        'cli-common',
        'plugin-sdk',
        'protocol',
        'release-runtime',
      ] as const;
      for (const packageName of fixtureWorkspaceNames) {
        const dependencyRoot = packageName === 'plugin-sdk'
          ? resolve(canonicalRoot, 'packages/plugin-sdk/node_modules')
          : resolve(
            canonicalRoot,
            'packages/plugin-sdk/node_modules/@happier-dev',
            packageName,
            'node_modules',
          );
        symlinkSync(
          dependencyRoot,
          resolve(repoRoot, 'packages', packageName, 'node_modules'),
          'dir',
        );
      }
      for (const pluginId of ['antigravity', 'claude', 'codex', 'ohmypi', 'opencode', 'pi']) {
        const fixtureWorkspaceScope = resolve(
          repoRoot,
          'packages/plugins',
          pluginId,
          'node_modules/@happier-dev',
        );
        mkdirSync(fixtureWorkspaceScope, { recursive: true });
        for (const packageName of fixtureWorkspaceNames) {
          symlinkSync(
            resolve(repoRoot, 'packages', packageName),
            resolve(fixtureWorkspaceScope, packageName),
            'dir',
          );
        }
      }
      symlinkSync(
        resolve(canonicalRoot, 'node_modules/ws'),
        resolve(repoRoot, 'packages/plugins/codex/node_modules/ws'),
        'dir',
      );
      rmSync(
        resolve(repoRoot, 'packages/protocol/src/connect/connectedServiceBindings.ts'),
      );
      symlinkSync(
        resolve(canonicalRoot, 'apps/cli/node_modules'),
        resolve(repoRoot, 'apps/cli/node_modules'),
        'dir',
      );
      const fixtureNodeModules = resolve(repoRoot, 'node_modules');
      const canonicalCliNodeModules = resolve(canonicalRoot, 'apps/cli/node_modules');
      mkdirSync(fixtureNodeModules);
      for (const entry of readdirSync(canonicalCliNodeModules)) {
        if (entry === '@types') continue;
        symlinkSync(
          resolve(canonicalCliNodeModules, entry),
          resolve(fixtureNodeModules, entry),
          'dir',
        );
      }
      const fixtureTypeModules = resolve(fixtureNodeModules, '@types');
      mkdirSync(fixtureTypeModules);
      for (const typeModulesRoot of [
        resolve(canonicalCliNodeModules, '@types'),
        resolve(canonicalRoot, 'node_modules/@types'),
      ]) {
        if (!existsSync(typeModulesRoot)) continue;
        for (const entry of readdirSync(typeModulesRoot)) {
          const target = resolve(fixtureTypeModules, entry);
          if (!existsSync(target)) symlinkSync(resolve(typeModulesRoot, entry), target, 'dir');
        }
      }
      symlinkSync(
        resolve(canonicalRoot, 'node_modules/tsx'),
        resolve(fixtureNodeModules, 'tsx'),
        'dir',
      );
      symlinkSync(
        resolve(canonicalRoot, 'node_modules/typescript'),
        resolve(fixtureNodeModules, 'typescript'),
        'dir',
      );

      const generatedAgentFactsPath = resolve(
        repoRoot,
        'packages/agents/src/generated/bundledAgentDefinitions.ts',
      );
      const predecessorAgentDefinitions = JSON.stringify({
        antigravity: BUNDLED_AGENT_DEFINITIONS_BY_ID.antigravity,
        claude: BUNDLED_AGENT_DEFINITIONS_BY_ID.claude,
        codex: BUNDLED_AGENT_DEFINITIONS_BY_ID.codex,
        ohMyPi: BUNDLED_AGENT_DEFINITIONS_BY_ID.ohMyPi,
        opencode: BUNDLED_AGENT_DEFINITIONS_BY_ID.opencode,
        pi: BUNDLED_AGENT_DEFINITIONS_BY_ID.pi,
      }, null, 2)
        .replaceAll('"delivery": "native_mcp"', '"delivery": "unsupported"')
        .replaceAll('"support": "experimental"', '"support": "unsupported"');
      writeFileSync(
        generatedAgentFactsPath,
        [
          "export const BUNDLED_AGENT_DEFINITION_IDS = Object.freeze(['claude', 'codex', 'opencode', 'antigravity', 'pi', 'ohMyPi']);",
          `export const BUNDLED_AGENT_DEFINITIONS_BY_ID = Object.freeze(${predecessorAgentDefinitions});`,
          '',
        ].join('\n'),
      );
      writeFileSync(resolve(repoRoot, 'packages/plugins/antigravity/src/index.ts'), [
        "export * from './activate.js';",
        "export * from './agent/index.js';",
        "export * from './manifest.js';",
        "export { PLUGIN_MANIFEST as manifest } from './manifest.js';",
        "import { getAgentCatalogDefinition } from '@happier-dev/agents/definitions';",
        "export const FIXTURE_AGENT_FACT = getAgentCatalogDefinition('antigravity')?.core.tools;",
        '',
      ].join('\n'));
      writeFileSync(resolve(repoRoot, 'packages/plugins/codex/src/index.ts'), [
        "export * from './activate.js';",
        "export * from './agent/index.js';",
        "export * from './manifest.js';",
        "export { PLUGIN_MANIFEST as manifest } from './manifest.js';",
        'export async function loadFixtureAgentFact() {',
        "  const definitions = await import('@happier-dev/agents/definitions');",
        "  return definitions.getAgentCatalogDefinition('codex')?.core.tools;",
        '}',
        '',
      ].join('\n'));

      const buildSharedStubPath = resolve(repoRoot, 'buildSharedDeps.stub.mjs');
      const agentIdsFixturePath = resolve(repoRoot, 'agent-ids.fixture.mjs');
      const loaderPath = resolve(repoRoot, 'generator-loader.mjs');
      const registerPath = resolve(repoRoot, 'generator-register.mjs');
      const lockStubPath = resolve(repoRoot, 'generator-lock.stub.mjs');
      writeFileSync(buildSharedStubPath, [
        `export { computeSourceDevSharedDepsSignature, inspectSourceDevSharedDepsForSourceDev } from ${JSON.stringify(`${pathToFileURL(resolve(canonicalRoot, 'apps/cli/scripts/buildSharedDeps.mjs')).href}?fixture-currentness=1`)};`,
        "import { resolve } from 'node:path';",
        "import { pathToFileURL } from 'node:url';",
        "const isPrivateAgentFactsPhase = process.env.HAPPIER_PRIVATE_BUNDLED_RUNTIME_CONSUMED_AGENT_FACTS_PHASE === '1';",
        'let privateActionMapPrepared = false;',
        'export async function prepareBundledWorkspaceDependenciesForCli() { return { workspaceNames: [] }; }',
        'export function resolveCliBundledWorkspacePackageNames() { return []; }',
        'export async function syncSharedDepsForSourceDev(options) {',
        '  if (!isPrivateAgentFactsPhase || privateActionMapPrepared) return;',
        `  const generatorUrl = pathToFileURL(resolve(${JSON.stringify(repoRoot)}, 'packages/plugin-sdk/scripts/generateActionTypeMap.mjs')).href;`,
        '  const { runActionTypeMapWithWorkspaceLock } = await import(generatorUrl);',
        "  await runActionTypeMapWithWorkspaceLock({ mode: options.generatedCompilerInputMode === 'check' ? '--check' : '--write', env: process.env });",
        '  privateActionMapPrepared = true;',
        '}',
        '',
      ].join('\n'));
      writeFileSync(agentIdsFixturePath, [
        "export const AGENT_IDS = Object.freeze(['claude', 'codex', 'opencode', 'antigravity', 'pi', 'ohMyPi']);",
        'export const BUNDLED_AGENT_CONTRIBUTION_IDENTITIES = Object.freeze({',
        "  claude: Object.freeze({ pluginId: 'happier.agent.claude', localId: 'claude' }),",
        "  codex: Object.freeze({ pluginId: 'happier.agent.codex', localId: 'codex' }),",
        "  opencode: Object.freeze({ pluginId: 'happier.agent.opencode', localId: 'opencode' }),",
        "  antigravity: Object.freeze({ pluginId: 'happier.agent.antigravity', localId: 'antigravity' }),",
        "  pi: Object.freeze({ pluginId: 'happier.agent.pi', localId: 'pi' }),",
        "  ohMyPi: Object.freeze({ pluginId: 'happier.agent.ohmypi', localId: 'ohmypi' }),",
        '});',
        'export function isBundledAgentId(value) { return AGENT_IDS.includes(value); }',
        '',
      ].join('\n'));
      writeFileSync(
        resolve(repoRoot, 'packages/agents/dist/generated/agentIds.js'),
        readFileSync(agentIdsFixturePath),
      );
      writeFileSync(
        resolve(repoRoot, 'packages/agents/dist/generated/bundledAgentDefinitions.js'),
        "export * from '../../src/generated/bundledAgentDefinitions.ts';\n",
      );
      const actionTypeMapPath = resolve(
        repoRoot,
        'packages/plugin-sdk/src/actions/actionTypeMap.generated.ts',
      );
      writeFileSync(actionTypeMapPath, '// deliberately stale Action map fixture\n');
      writeFileSync(loaderPath, [
        "import { existsSync } from 'node:fs';",
        "import { resolve as resolvePath } from 'node:path';",
        "import { pathToFileURL as toFileUrl } from 'node:url';",
        `const cliSourceRoot = ${JSON.stringify(resolve(canonicalRoot, 'apps/cli/src'))};`,
        `const wsUrl = ${JSON.stringify(pathToFileURL(resolve(canonicalRoot, 'packages/plugin-sdk/node_modules/ws/index.js')).href)};`,
        `const buildSharedUrl = ${JSON.stringify(pathToFileURL(resolve(canonicalRoot, 'apps/cli/scripts/buildSharedDeps.mjs')).href)};`,
        `const stubUrl = ${JSON.stringify(pathToFileURL(buildSharedStubPath).href)};`,
        `const lockUrl = ${JSON.stringify(pathToFileURL(resolve(canonicalRoot, 'packages/cli-common/workspaceBundleLock.mjs')).href)};`,
        `const lockStubUrl = ${JSON.stringify(pathToFileURL(lockStubPath).href)};`,
        `const agentIdsUrl = ${JSON.stringify(pathToFileURL(resolve(canonicalRoot, 'packages/agents/dist/generated/agentIds.js')).href)};`,
        `const agentIdsFixtureUrl = ${JSON.stringify(pathToFileURL(agentIdsFixturePath).href)};`,
        'export async function resolve(specifier, context, nextResolve) {',
        "  if (specifier === 'ws') return { url: wsUrl, shortCircuit: true };",
        "  if (specifier.startsWith('@/')) {",
        "    const base = resolvePath(cliSourceRoot, specifier.slice(2));",
        "    const target = [`${base}.ts`, resolvePath(base, 'index.ts')].find(existsSync);",
        "    if (target) return { url: toFileUrl(target).href, shortCircuit: true };",
        '  }',
        '  const resolved = await nextResolve(specifier, context);',
        '  if (resolved.url === buildSharedUrl) return { url: stubUrl, shortCircuit: true };',
        '  if (resolved.url === lockUrl) return { url: lockStubUrl, shortCircuit: true };',
        '  if (resolved.url === agentIdsUrl) return { url: agentIdsFixtureUrl, shortCircuit: true };',
        '  return resolved;',
        '}',
        '',
      ].join('\n'));
      writeFileSync(lockStubPath, [
        `export * from ${JSON.stringify(`${pathToFileURL(resolve(canonicalRoot, 'packages/cli-common/workspaceBundleLock.mjs')).href}?fixture-real=1`)};`,
        `export function resolveWorkspaceBundleLockPath() { return ${JSON.stringify(resolve(repoRoot, '.project/tmp/cli-dist-build.lock'))}; }`,
        '',
      ].join('\n'));
      writeFileSync(registerPath, [
        "import { register } from 'node:module';",
        `register(${JSON.stringify(pathToFileURL(loaderPath).href)}, import.meta.url);`,
        '',
      ].join('\n'));

      const runGenerator = async (mode: 'write' | 'check'): Promise<void> => {
        await new Promise<void>((resolvePromise, reject) => {
          execFile(process.execPath, [
            '--experimental-strip-types',
            '--import',
            registerPath,
            generatorPath,
            '--root',
            repoRoot,
            '--mode',
            mode,
          ], {
            cwd: repoRoot,
            env: process.env,
            encoding: 'utf8',
          }, (error, stdout, stderr) => {
            if (error) {
              reject(new Error([
                `Bundled plugin generator ${mode} fixture process failed: ${error.message}`,
                stdout,
                stderr,
              ].filter((part) => part.length > 0).join('\n'), { cause: error }));
              return;
            }
            resolvePromise();
          });
        });
      };

      await runGenerator('write');
      expect(readFileSync(actionTypeMapPath, 'utf8')).toContain(
        '// This file is generated by scripts/generateActionTypeMap.mjs.',
      );
      const readOwnedRuntime = (pluginId: string): Readonly<{
        outputs: readonly string[];
        bytes: readonly string[];
      }> => {
        const packageRoot = resolve(repoRoot, 'packages/plugins', pluginId);
        const marker = JSON.parse(readFileSync(
          resolve(packageRoot, '.happier-plugin/.happier-daemon-outputs.json'),
          'utf8',
        )) as { outputs: string[] };
        return {
          outputs: marker.outputs,
          bytes: marker.outputs.map((relativePath) => readFileSync(
            resolve(packageRoot, ...relativePath.split('/')),
            'utf8',
          )),
        };
      };
      const antigravityRuntime = readOwnedRuntime('antigravity');
      expect(antigravityRuntime.outputs).toEqual(['.happier-plugin/daemon.js']);
      expect(antigravityRuntime.bytes.join('\n')).toContain('native_mcp');
      for (const bytes of antigravityRuntime.bytes) {
        expect(bytes).not.toContain('"delivery":"unsupported"');
      }

      const codexRuntime = readOwnedRuntime('codex');
      expect(codexRuntime.outputs).toContain('.happier-plugin/daemon.js');
      expect(codexRuntime.outputs).toContain('.happier-plugin/agent/runtime/engine.js');
      expect(codexRuntime.outputs.some((output) => (
        /^\.happier-plugin\/\.happier-chunks\/chunk-[A-Z0-9]{8}\.js$/u.test(output)
      ))).toBe(true);
      expect(codexRuntime.bytes.join('\n')).toContain('native_mcp');
      for (const bytes of codexRuntime.bytes) {
        expect(bytes).not.toContain('"delivery":"unsupported"');
      }

      // This is a second process invoking the real generator's all-scope check,
      // not an assertion-only surrogate for the drift owner.
      await runGenerator('check');
    } finally {
      cleanup();
    }
  }, 300_000);

  it('loads compiler-input dependencies through bounded owner subpaths', () => {
    // This path runs before the shared workspace build and must stay cheap and
    // terminating on a cold source-dev filesystem. The package root barrels
    // pull in the complete Agent/Protocol runtime and may retain live handles.
    const loader = sourceBetween(
      'async function loadGeneratedCompilerInputDependencies()',
      'async function synchronizeGeneratorAuthoringRuntimeClosure(',
    );

    expect(loader).toContain("importCanonicalWorkspaceModule(");
    expect(loader).toContain("'@happier-dev/agents'");
    expect(loader).toContain("'agent-ids'");
    expect(loader).not.toContain("importCanonicalWorkspaceModule('@happier-dev/protocol'");
    expect(loader).not.toContain("importCanonicalWorkspaceModule('@happier-dev/agents'),");

    const publication = sourceBetween(
      'async function publishGeneratedCompilerInputs(',
      'function collectReleasedFlatSessionMetadataRuntimeDescriptorReaderContributions(',
    );
    expect(publication).not.toContain('readSerializedBundledPluginPackages');
  });

  it('loads the full generator dependency slice without package root barrels', () => {
    const loader = sourceBetween(
      'async function loadGeneratorWorkspaceDependencies()',
      '/**\n * Loads only the Agents runtime',
    );

    expect(loader).toContain("importCanonicalWorkspaceModule('@happier-dev/agents', 'manifest')");
    expect(loader).toContain("importCanonicalWorkspaceModule('@happier-dev/agents', 'definitions')");
    expect(loader).toContain("importCanonicalWorkspaceModule('@happier-dev/protocol', 'plugins/manifest')");
    expect(loader).not.toContain("importCanonicalWorkspaceModule('@happier-dev/protocol', 'plugins/ui')");
    expect(loader).not.toContain("importCanonicalWorkspaceModule('@happier-dev/agents'),");
    expect(loader).not.toContain("importCanonicalWorkspaceModule('@happier-dev/protocol'),");
  });
});

describe('bundled plugin installed runtime publication', () => {
  it('replaces only marker-owned runtime outputs for declarative-only plugins', async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'happier-declarative-runtime-reconcile-'));
    const runtimeRoot = join(packageRoot, '.happier-plugin');
    try {
      mkdirSync(join(packageRoot, 'assets'), { recursive: true });
      mkdirSync(join(runtimeRoot, '.happier-chunks'), { recursive: true });
      mkdirSync(join(runtimeRoot, 'agent/runtime'), { recursive: true });
      writeFileSync(join(packageRoot, 'assets/brand.png'), 'static package asset\n');
      writeFileSync(join(runtimeRoot, 'author-notes.txt'), 'author-owned runtime notes\n');
      writeFileSync(join(runtimeRoot, 'plugin.json'), '{"id":"happier.agent.declarative"}\n');
      writeFileSync(join(runtimeRoot, 'daemon.js'), 'stale daemon\n');
      writeFileSync(join(runtimeRoot, '.happier-chunks/retired.js'), 'retired chunk\n');
      writeFileSync(join(runtimeRoot, 'agent/runtime/factory.js'), 'retired runner\n');
      writeFileSync(join(runtimeRoot, '.happier-daemon-outputs.json'), JSON.stringify({
        version: 1,
        outputs: [
          '.happier-plugin/daemon.js',
          '.happier-plugin/.happier-chunks/retired.js',
          '.happier-plugin/agent/runtime/factory.js',
        ],
      }));

      const expectedFiles = new Map([
        ['.happier-plugin/plugin.json', Buffer.from('{"id":"happier.agent.declarative"}\n')],
        ['.happier-plugin/daemon.js', Buffer.from('current daemon\n')],
      ]);
      await expect(async () => await reconcileBundledPluginInstalledRuntime({
        packageRoot,
        pluginPackageId: 'declarative',
        daemonRelativePath: '.happier-plugin/daemon.js',
        expectedFiles,
        mode: 'check',
      })).rejects.toThrow(/generated runtime/u);

      await reconcileBundledPluginInstalledRuntime({
        packageRoot,
        pluginPackageId: 'declarative',
        daemonRelativePath: '.happier-plugin/daemon.js',
        expectedFiles,
        mode: 'write',
      });

      expect(readFileSync(join(runtimeRoot, 'daemon.js'), 'utf8')).toBe('current daemon\n');
      expect(existsSync(join(runtimeRoot, 'agent/runtime/factory.js'))).toBe(false);
      expect(existsSync(join(runtimeRoot, '.happier-chunks/retired.js'))).toBe(false);
      expect(readFileSync(join(runtimeRoot, 'plugin.json'), 'utf8'))
        .toBe('{"id":"happier.agent.declarative"}\n');
      expect(readFileSync(join(packageRoot, 'assets/brand.png'), 'utf8'))
        .toBe('static package asset\n');
      expect(readFileSync(join(runtimeRoot, 'author-notes.txt'), 'utf8'))
        .toBe('author-owned runtime notes\n');

      await expect(reconcileBundledPluginInstalledRuntime({
        packageRoot,
        pluginPackageId: 'declarative',
        daemonRelativePath: '.happier-plugin/daemon.js',
        expectedFiles,
        mode: 'check',
      })).resolves.toBeUndefined();
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps the current daemon, runner, and chunks while removing marker-owned retired siblings', async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'happier-runtime-three-location-reconcile-'));
    const runtimeRoot = join(packageRoot, '.happier-plugin');
    try {
      mkdirSync(join(runtimeRoot, '.happier-chunks'), { recursive: true });
      mkdirSync(join(runtimeRoot, 'agent/runtime'), { recursive: true });
      writeFileSync(join(runtimeRoot, 'daemon.js'), 'old daemon\n');
      writeFileSync(join(runtimeRoot, '.happier-chunks/old.js'), 'old chunk\n');
      writeFileSync(join(runtimeRoot, 'agent/runtime/factory.js'), 'old runner\n');
      writeFileSync(join(runtimeRoot, '.happier-daemon-outputs.json'), JSON.stringify({
        version: 1,
        outputs: [
          '.happier-plugin/daemon.js',
          '.happier-plugin/.happier-chunks/old.js',
          '.happier-plugin/agent/runtime/factory.js',
        ],
      }));

      await reconcileBundledPluginInstalledRuntime({
        packageRoot,
        pluginPackageId: 'codex',
        daemonRelativePath: '.happier-plugin/daemon.js',
        expectedFiles: new Map([
          ['.happier-plugin/plugin.json', Buffer.from('{"id":"happier.agent.codex"}\n')],
          ['.happier-plugin/daemon.js', Buffer.from('new daemon\n')],
          ['.happier-plugin/.happier-chunks/current.js', Buffer.from('new chunk\n')],
          ['.happier-plugin/agent/runtime/engine.js', Buffer.from('new runner\n')],
        ]),
        mode: 'write',
      });

      expect(readFileSync(join(runtimeRoot, 'daemon.js'), 'utf8')).toBe('new daemon\n');
      expect(readFileSync(join(runtimeRoot, '.happier-chunks/current.js'), 'utf8')).toBe('new chunk\n');
      expect(readFileSync(join(runtimeRoot, 'agent/runtime/engine.js'), 'utf8')).toBe('new runner\n');
      expect(existsSync(join(runtimeRoot, '.happier-chunks/old.js'))).toBe(false);
      expect(existsSync(join(runtimeRoot, 'agent/runtime/factory.js'))).toBe(false);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it('contracts only the exact unmarked runner leaves emitted for retired bundled runtimes', async () => {
    for (const pluginPackageId of ['antigravity', 'devin', 'kimi']) {
      const packageRoot = mkdtempSync(join(tmpdir(), `happier-retired-${pluginPackageId}-runtime-`));
      const runtimeRoot = join(packageRoot, '.happier-plugin');
      try {
        mkdirSync(join(runtimeRoot, 'agent/runtime'), { recursive: true });
        writeFileSync(join(runtimeRoot, 'plugin.json'), `{"id":"happier.agent.${pluginPackageId}"}\n`);
        writeFileSync(join(runtimeRoot, 'daemon.js'), 'current daemon\n');
        writeFileSync(join(runtimeRoot, 'agent/runtime/factory.js'), 'retired generated runner\n');
        writeFileSync(join(runtimeRoot, 'agent/runtime/author.js'), 'author-owned neighbor\n');
        writeFileSync(join(runtimeRoot, '.happier-daemon-outputs.json'), JSON.stringify({
          version: 1,
          outputs: ['.happier-plugin/daemon.js'],
        }));
        const expectedFiles = new Map([
          [
            '.happier-plugin/plugin.json',
            Buffer.from(`{"id":"happier.agent.${pluginPackageId}"}\n`),
          ],
          ['.happier-plugin/daemon.js', Buffer.from('current daemon\n')],
        ]);

        await expect(reconcileBundledPluginInstalledRuntime({
          packageRoot,
          pluginPackageId,
          daemonRelativePath: '.happier-plugin/daemon.js',
          expectedFiles,
          mode: 'check',
        })).rejects.toThrow(/retired generated runtime output/u);

        await reconcileBundledPluginInstalledRuntime({
          packageRoot,
          pluginPackageId,
          daemonRelativePath: '.happier-plugin/daemon.js',
          expectedFiles,
          mode: 'write',
        });

        expect(existsSync(join(runtimeRoot, 'agent/runtime/factory.js'))).toBe(false);
        expect(readFileSync(join(runtimeRoot, 'agent/runtime/author.js'), 'utf8'))
          .toBe('author-owned neighbor\n');
        await expect(reconcileBundledPluginInstalledRuntime({
          packageRoot,
          pluginPackageId,
          daemonRelativePath: '.happier-plugin/daemon.js',
          expectedFiles,
          mode: 'check',
        })).resolves.toBeUndefined();
      } finally {
        rmSync(packageRoot, { recursive: true, force: true });
      }
    }

    const packageRoot = mkdtempSync(join(tmpdir(), 'happier-author-owned-runner-runtime-'));
    const runtimeRoot = join(packageRoot, '.happier-plugin');
    try {
      mkdirSync(join(runtimeRoot, 'agent/runtime'), { recursive: true });
      writeFileSync(join(runtimeRoot, 'agent/runtime/factory.js'), 'author-owned runner\n');
      await reconcileBundledPluginInstalledRuntime({
        packageRoot,
        pluginPackageId: 'another-plugin',
        daemonRelativePath: '.happier-plugin/daemon.js',
        expectedFiles: new Map([
          ['.happier-plugin/plugin.json', Buffer.from('{"id":"happier.agent.other"}\n')],
          ['.happier-plugin/daemon.js', Buffer.from('current daemon\n')],
        ]),
        mode: 'write',
      });
      expect(readFileSync(join(runtimeRoot, 'agent/runtime/factory.js'), 'utf8'))
        .toBe('author-owned runner\n');
      await expect(reconcileBundledPluginInstalledRuntime({
        packageRoot,
        pluginPackageId: 'another-plugin',
        daemonRelativePath: '.happier-plugin/daemon.js',
        expectedFiles: new Map([
          ['.happier-plugin/plugin.json', Buffer.from('{"id":"happier.agent.other"}\n')],
          ['.happier-plugin/daemon.js', Buffer.from('current daemon\n')],
        ]),
        mode: 'check',
      })).resolves.toBeUndefined();
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it('contracts only the twelve proven unmarked predecessor chunks and preserves neighbors', async () => {
    const retiredChunksByPlugin = Object.freeze({
      auggie: 'chunk-VOUQT3FH.js',
      claude: 'chunk-N7PGJW44.js',
      codex: 'chunk-SHXPQNCY.js',
      copilot: 'chunk-K3Q3IMHF.js',
      cursor: 'chunk-GFYILV73.js',
      gemini: 'chunk-ZOTE3VST.js',
      grok: 'chunk-GMQD56SV.js',
      kilo: 'chunk-2FXVNKQ4.js',
      ohmypi: 'chunk-GRJXWIAP.js',
      opencode: 'chunk-HC5PJSTB.js',
      pi: 'chunk-GG7JGBJB.js',
      qwen: 'chunk-QU3FEF3D.js',
    });

    for (const [pluginPackageId, retiredChunk] of Object.entries(retiredChunksByPlugin)) {
      const packageRoot = mkdtempSync(join(tmpdir(), `happier-retired-${pluginPackageId}-chunk-`));
      const runtimeRoot = join(packageRoot, '.happier-plugin');
      try {
        mkdirSync(join(runtimeRoot, '.happier-chunks'), { recursive: true });
        writeFileSync(join(runtimeRoot, '.happier-chunks', retiredChunk), 'retired generated chunk\n');
        writeFileSync(join(runtimeRoot, '.happier-chunks', 'author-neighbor.js'), 'author-owned neighbor\n');
        writeFileSync(join(runtimeRoot, '.happier-chunks', 'current.js'), 'current generated chunk\n');
        writeFileSync(join(runtimeRoot, 'plugin.json'), `{"id":"happier.agent.${pluginPackageId}"}\n`);
        writeFileSync(join(runtimeRoot, 'daemon.js'), 'current daemon\n');
        writeFileSync(join(runtimeRoot, '.happier-daemon-outputs.json'), JSON.stringify({
          version: 1,
          outputs: [
            '.happier-plugin/daemon.js',
            '.happier-plugin/.happier-chunks/current.js',
          ],
        }));
        const expectedFiles = new Map([
          ['.happier-plugin/plugin.json', Buffer.from(`{"id":"happier.agent.${pluginPackageId}"}\n`)],
          ['.happier-plugin/daemon.js', Buffer.from('current daemon\n')],
          ['.happier-plugin/.happier-chunks/current.js', Buffer.from('current generated chunk\n')],
        ]);

        await expect(reconcileBundledPluginInstalledRuntime({
          packageRoot,
          pluginPackageId,
          daemonRelativePath: '.happier-plugin/daemon.js',
          expectedFiles,
          mode: 'check',
        })).rejects.toThrow(/retired generated runtime output/u);

        await reconcileBundledPluginInstalledRuntime({
          packageRoot,
          pluginPackageId,
          daemonRelativePath: '.happier-plugin/daemon.js',
          expectedFiles,
          mode: 'write',
        });

        expect(existsSync(join(runtimeRoot, '.happier-chunks', retiredChunk))).toBe(false);
        expect(readFileSync(join(runtimeRoot, '.happier-chunks', 'current.js'), 'utf8'))
          .toBe('current generated chunk\n');
        expect(readFileSync(join(runtimeRoot, '.happier-chunks', 'author-neighbor.js'), 'utf8'))
          .toBe('author-owned neighbor\n');
      } finally {
        rmSync(packageRoot, { recursive: true, force: true });
      }
    }

    expect(Object.keys(retiredChunksByPlugin)).toHaveLength(12);

    const unrelatedRoot = mkdtempSync(join(tmpdir(), 'happier-unrelated-unmarked-chunk-'));
    try {
      const runtimeRoot = join(unrelatedRoot, '.happier-plugin');
      mkdirSync(join(runtimeRoot, '.happier-chunks'), { recursive: true });
      writeFileSync(join(runtimeRoot, 'plugin.json'), '{"id":"happier.utility.other"}\n');
      writeFileSync(join(runtimeRoot, 'daemon.js'), 'current daemon\n');
      writeFileSync(join(runtimeRoot, '.happier-chunks/chunk-VOUQT3FH.js'), 'author-owned same-name chunk\n');
      writeFileSync(join(runtimeRoot, '.happier-daemon-outputs.json'), JSON.stringify({
        version: 1,
        outputs: ['.happier-plugin/daemon.js'],
      }));
      await reconcileBundledPluginInstalledRuntime({
        packageRoot: unrelatedRoot,
        pluginPackageId: 'other',
        daemonRelativePath: '.happier-plugin/daemon.js',
        expectedFiles: new Map([
          ['.happier-plugin/plugin.json', Buffer.from('{"id":"happier.utility.other"}\n')],
          ['.happier-plugin/daemon.js', Buffer.from('current daemon\n')],
        ]),
        mode: 'write',
      });
      expect(readFileSync(join(runtimeRoot, '.happier-chunks/chunk-VOUQT3FH.js'), 'utf8'))
        .toBe('author-owned same-name chunk\n');
    } finally {
      rmSync(unrelatedRoot, { recursive: true, force: true });
    }
  });

  it('does not resolve source staging through ignored plugin package outputs', () => {
    expect(selectCanonicalRuntimeWorkspacePackageRoots([
      {
        packageName: '@happier-dev/plugin-sdk',
        srcDir: '/repo/packages/plugin-sdk',
      },
      {
        packageName: '@happier-dev/plugins-codex',
        srcDir: '/repo/packages/plugins/codex',
      },
      {
        packageName: '@happier-dev/plugins-kimi',
        srcDir: '/repo/apps/cli/node_modules/@happier-dev/plugins-kimi',
      },
    ])).toEqual({
      '@happier-dev/plugin-sdk': '/repo/packages/plugin-sdk',
    });
  });

  it.each(['selected projection', 'full publication'] as const)(
    'prepares only the packaged-runtime roots consumed by %s, once across its phases',
    async (operation) => {
      const { repoRoot, happyCliDir, cleanup } = createPackageLayoutSandbox('happier-generator-preparation-');
      try {
        for (const appName of ['ui', 'server']) {
          mkdirSync(join(repoRoot, 'apps', appName), { recursive: true });
          writeFileSync(join(repoRoot, 'apps', appName, 'package.json'), JSON.stringify({ name: `@fixture/${appName}` }));
        }
        writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
          private: true, workspaces: ['apps/*', 'packages/*', 'packages/plugins/*'],
        }));
        const pluginIds = operation === 'selected projection' ? ['selected', 'broken'] : ['selected', 'other'];
        writeCliBundledHostPackage({
          happyCliDir,
          bundledDependencies: pluginIds.map((id) => `@happier-dev/plugins-${id}`),
        });
        for (const id of ['protocol', ...pluginIds]) {
          const isPlugin = id !== 'protocol';
          writeWorkspacePackageFixture({
            repoRoot,
            workspacePath: isPlugin ? `packages/plugins/${id}` : `packages/${id}`,
            packageName: `@happier-dev/${isPlugin ? 'plugins-' : ''}${id}`,
            manifestOverrides: {
              scripts: { build: 'fixture compiler' },
              ...(isPlugin ? { dependencies: { '@happier-dev/protocol': 'workspace:*' } } : {}),
            },
            files: { 'src/index.ts': `export const value = '${id}';\n`, 'tsconfig.json': '{}\n' },
          });
          if (isPlugin) writeBundledPluginSourceInputs({ repoRoot, pluginId: id, writePackageJson: false });
        }
        const preparedPlugins = new Set<string>();
        const prepare = async (options: Parameters<typeof resolveGeneratorPackagedRuntimePreparation>[1]) => {
          const preparation = resolveGeneratorPackagedRuntimePreparation(
            ['protocol', ...pluginIds.map((id) => `plugins-${id}`)],
            options,
          );
          return await prepareBundledWorkspaceDependenciesForCli({
            repoRoot,
            ...preparation,
            quiet: true,
            // Only the compiler process is replaced; dependency discovery,
            // currentness, locks, staging, validation, and publication are real.
            ensureWorkspacePackagesBuiltByNameImpl: (...[root, names, buildOptions]: Parameters<typeof ensureWorkspacePackagesBuiltByName>) => (
              ensureWorkspacePackagesBuiltByName(root, names, {
                ...buildOptions,
                workspaceBuildBoundary: {
                  async prepareEnv(_packageDir, env) { return { ...env }; },
                  async runPackageBuild(packageDir, { env }) {
                    const { name } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
                    if (name === '@happier-dev/plugins-broken') throw new Error('unrelated plugin cannot compile');
                    if (name.startsWith('@happier-dev/plugins-')) {
                      if (preparedPlugins.has(name)) throw new Error('packaged-runtime root forced twice in one publication');
                      preparedPlugins.add(name);
                      expect(readFileSync(join(repoRoot, 'packages/protocol/dist/index.js'), 'utf8'))
                        .toContain("value = 'protocol'");
                    }
                    const outputDir = env.HAPPIER_WORKSPACE_DIST_OUTPUT_DIR!;
                    writeFileSync(join(outputDir, 'index.js'), readFileSync(join(packageDir, 'src/index.ts')));
                    writeFileSync(join(outputDir, 'index.d.ts'), 'export declare const value: string;\n');
                  },
                },
              })
            ),
          });
        };
        if (operation === 'full publication') {
          await prepare({ preparePackagedRuntimes: false });
          expect(preparedPlugins.size).toBe(0);
          await prepare({});
          expect([...preparedPlugins].sort()).toEqual([
            '@happier-dev/plugins-other', '@happier-dev/plugins-selected',
          ]);
        } else {
          await prepare({ workspaceNames: ['plugins-selected'] });
          expect([...preparedPlugins]).toEqual(['@happier-dev/plugins-selected']);
        }
        expect(readFileSync(join(repoRoot, 'packages/plugins/selected/dist/index.js'), 'utf8'))
          .toContain("value = 'selected'");
      } finally {
        cleanup();
      }
    },
  );
});

describe('bundled plugin UI translation aggregation', () => {
  const sharedTriageTranslation = Object.freeze({
    contributes: {
      ui: {
        translations: [{
          locale: 'en',
          messages: {
            'plugins.triage.sourceSettings.connectAccount': 'Connect account',
          },
        }],
      },
    },
  });

  it('coalesces byte-identical shared translations independently of package order', () => {
    const posthog = {
      pluginPackageId: 'posthog',
      manifest: sharedTriageTranslation,
    };
    const azureDevOps = {
      pluginPackageId: 'scm-azure-devops',
      manifest: sharedTriageTranslation,
    };

    expect(collectBundledPluginUiTranslations([posthog, azureDevOps])).toEqual({
      en: {
        'plugins.triage.sourceSettings.connectAccount': 'Connect account',
      },
    });
    expect(collectBundledPluginUiTranslations([azureDevOps, posthog])).toEqual(
      collectBundledPluginUiTranslations([posthog, azureDevOps]),
    );
  });

  it('rejects conflicting translations with the locale, key, and both package owners', () => {
    expect(() => collectBundledPluginUiTranslations([
      {
        pluginPackageId: 'posthog',
        manifest: sharedTriageTranslation,
      },
      {
        pluginPackageId: 'scm-azure-devops',
        manifest: {
          contributes: {
            ui: {
              translations: [{
                locale: 'en',
                messages: {
                  'plugins.triage.sourceSettings.connectAccount': 'Link account',
                },
              }],
            },
          },
        },
      },
    ])).toThrow(
      "Conflicting bundled UI translation 'en:plugins.triage.sourceSettings.connectAccount' from posthog and scm-azure-devops",
    );
  });
});

describe('CLI bundled plugin registry projection', () => {
  it('does not publish a duplicate packaged-byte currentness authority', () => {
    expect(generatorSource).not.toContain('assignBundledImmutableArtifactGenerationIds');
    expect(generatorSource).not.toContain('renderCliBundledPluginArtifactRecordsTs');
    expect(generatorSource).not.toContain('generatedBundledPluginArtifacts.ts');
    expect(generatorSource).not.toContain('function sameBundledSourceArtifactIntegrity(');
  });

  it('emits the contribution-identity owner subpath instead of the Protocol root barrel', () => {
    const registrationRenderer = sourceBetween(
      'function renderCliBundledAgentRegistrationBindingsTs(',
      'function renderCliBundledPluginEntriesTs(',
      registryRendererSource,
    );

    expect(registrationRenderer).toContain(
      "@happier-dev/protocol/plugins/contribution-identity",
    );
    expect(registrationRenderer).not.toContain(
      "from '@happier-dev/protocol';",
    );
  });

  it('keeps generated manifest locators data-only without target semantic sidecars', () => {
    const registryRenderer = sourceBetween(
      'function renderCliBundledPluginManifestEntriesTs(',
      'function renderCliBundledAgentRegistrationBindingsTs(',
      registryRendererSource,
    );

    expect(registryRenderer).not.toContain('targeted-contributions');
    expect(registryRenderer).not.toContain('semanticPointRefs');
    expect(registryRenderer).not.toContain('@happier-dev/plugin-sdk');
  });

  it('does not emit a committed source-byte integrity ledger', () => {
    expect(generatorSource).not.toContain('BUNDLED_FIRST_PARTY_SOURCE_ARTIFACT_INTEGRITIES');
    expect(generatorSource).not.toContain('generatedBundledPluginSourceIntegrities.json');
    expect(generatorSource).not.toContain('renderBundledPluginSourceIntegritiesJson');
  });

  it('publishes serialized manifest locators through the aggregate final-artifact owner', () => {
    const aggregatePublisher = sourceBetween(
      'async function publishBundledPluginSemanticProjection(',
      'function collectBundledAgentContributionIdentities(',
    );

    expect(aggregatePublisher).toContain('renderCliBundledPluginManifestEntriesTs({ pluginPackages })');
    expect(aggregatePublisher).toContain('generatedBundledPluginManifests.ts');
    expect(aggregatePublisher).toContain('cliManifestOutPath');
  });

  it('keeps tracked projections independent of transient publication admission', () => {
    const aggregatePublisher = sourceBetween(
      'async function publishBundledPluginSemanticProjection(',
      'function collectBundledAgentContributionIdentities(',
    );
    const fullPublisher = sourceBetween(
      'async function generateBundledPluginEntries(',
      'async function withGeneratorPublicationLock<T>(',
    );
    expect(aggregatePublisher).not.toContain('if (failures.length > 0) return failures;');
    expect(fullPublisher).not.toContain('if (failures.length > 0) return failures;');
  });

  it('advances healthy serialized locators while retaining failed optional membership', async () => {
    const { repoRoot, happyCliDir, cleanup } = createPackageLayoutSandbox('happier-aggregate-failure-');
    try {
      const manifest = (id: string, displayName: string) => ({
        schemaVersion: 2, id: `happier.${id}`, version: '0.0.0', displayName,
        engines: { happier: '^0.0.0' }, runtime: { apiVersion: 1 },
        hostAccess: { required: [], optional: [] }, contributes: {},
      });
      for (const id of ['healthy', 'inspector']) {
        const packageDir = writeWorkspacePackageFixture({
          repoRoot, workspacePath: `packages/plugins/${id}`, packageName: `@happier-dev/plugins-${id}`,
        });
        writeBundledPluginSourceInputs({ repoRoot, pluginId: id, writePackageJson: false });
        mkdirSync(join(packageDir, '.happier-plugin'), { recursive: true });
        writeFileSync(join(packageDir, '.happier-plugin', 'plugin.json'), JSON.stringify(manifest(id, id)));
      }
      writeCliBundledHostPackage({ happyCliDir, bundledDependencies: ['@happier-dev/plugins-healthy', '@happier-dev/plugins-inspector'] });
      const failurePath = join(happyCliDir, '.project', 'tmp', 'bundled-plugin-publication', 'failures.json');
      mkdirSync(join(failurePath, '..'), { recursive: true });
      writeFileSync(failurePath, JSON.stringify([{
        packageName: '@happier-dev/plugins-inspector', pluginId: 'happier.inspector',
        diagnostic: { code: 'plugin_ui_artifact_invalid', message: 'optional UI bytes missing' },
      }]));
      writeFileSync(join(repoRoot, 'packages/plugins/healthy/.happier-plugin/plugin.json'), JSON.stringify(manifest('healthy', 'Healthy changed')));
      await withWorkspaceBundleLock(async (lease) => await publishBundledPluginSemanticProjection(
        parseGeneratorCliArgs(['--mode', 'write', '--root', repoRoot, '--aggregate']),
        { protocol: { ingestPluginManifestV2 } },
        lease,
        [],
        readBundledPluginPublicationFailures(repoRoot),
      ), { lockPath: join(repoRoot, 'publication.lock') });
      const output = readFileSync(join(happyCliDir, 'src/plugins/projection/registry/sources/generatedBundledPluginManifests.ts'), 'utf8');
      expect(output).toContain('Healthy changed');
      expect(output).toContain('happier.inspector');
      expect(output).not.toContain('optional UI bytes missing');
      expect(output).not.toContain('BUNDLED_FIRST_PARTY_PLUGIN_FAILURES');
      expect(JSON.parse(readFileSync(failurePath, 'utf8'))).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it('aggregate publication preserves unrelated source failures while recording the current failed scope', async () => {
    const { repoRoot, cleanup } = createPackageLayoutSandbox('happier-aggregate-scope-');
    const failure = (id: string) => ({
      packageName: `@happier-dev/plugins-${id}`, pluginId: `happier.${id}`,
      diagnostic: { code: 'plugin_manifest_invalid' as const, message: `${id} source failed` },
    });
    try {
      for (const id of ['a', 'b']) {
        const packageDir = writeWorkspacePackageFixture({
          repoRoot, workspacePath: `packages/plugins/${id}`, packageName: `@happier-dev/plugins-${id}`,
        });
        writeBundledPluginSourceInputs({ repoRoot, pluginId: id, writePackageJson: false });
        mkdirSync(join(packageDir, '.happier-plugin'), { recursive: true });
        writeFileSync(join(packageDir, '.happier-plugin/plugin.json'), JSON.stringify({
          schemaVersion: 2, id: `happier.${id}`, version: '0.0.0', displayName: id,
          engines: { happier: '^0.0.0' }, runtime: { apiVersion: 1 },
          hostAccess: { required: [], optional: [] }, contributes: {},
        }));
      }
      writeBundledPluginPublicationFailures(repoRoot, [failure('a')]);
      await withWorkspaceBundleLock(async (lease) => await publishBundledPluginSemanticProjection(
        parseGeneratorCliArgs(['--mode', 'write', '--root', repoRoot, '--aggregate']),
        { protocol: { ingestPluginManifestV2 } }, lease, [], [failure('b')],
      ), { lockPath: join(repoRoot, 'publication.lock') });
      expect(readBundledPluginPublicationFailures(repoRoot)).toEqual([failure('a'), failure('b')]);
    } finally { cleanup(); }
  });

  it('migrates the legacy combined CLI registry during a scoped publication', () => {
    const scopedPublisher = sourceBetween(
      'if (options.workspaceNames.length > 0) {',
      '// Discover and validate every package before mutating host membership.',
    );

    expect(scopedPublisher).toContain('renderRetainedCliBundledPluginImplementationEntriesTs');
    expect(scopedPublisher).toContain('{ outPath: cliOutPath, out: cliOut }');
  });

  it('keeps retained Agent registration identities data-only', () => {
    const outputPath = join(mkdtempSync(join(tmpdir(), 'happier-cli-registry-')), 'generated.ts');
    writeFileSync(outputPath, [
      "import { createAgentRuntimeCatalogEntryHooks } from '../agentCatalogEntryHooks';",
      "import { PI_AGENT_RUNTIME_CONTRIBUTION } from '@happier-dev/plugins-pi/agent/contributions/catalog';",
      "import type { PluginContributionIdentityV1 } from '@happier-dev/protocol/plugins/contribution-identity';",
      "import type { PluginSourceSpecV1 } from '@happier-dev/protocol/plugins/source-spec';",
      'export type BundledFirstPartyAgentRegistrationBinding = Readonly<{ identity: PluginContributionIdentityV1; }>;',
      'export const BUNDLED_FIRST_PARTY_PLUGIN_PACKAGE_NAMES = Object.freeze(["old"]);',
      'export const BUNDLED_FIRST_PARTY_PLUGIN_LOCATORS = Object.freeze([{ pluginId: "old" }]);',
      'export const BUNDLED_FIRST_PARTY_AGENT_REGISTRATION_BINDINGS = Object.freeze([{',
      '  identity: createPluginContributionIdentity({ pluginId: "happier.agent.pi", localId: "pi" }),',
      '  implementationOwnerId: "pi",',
      "  registrationFamily: 'agents',",
      '  implementation: createAgentRuntimeCatalogEntryHooks({ contribution: PI_AGENT_RUNTIME_CONTRIBUTION }),',
      '}]);',
      '',
    ].join('\n'));

    const executableRenderer = sourceBetween(
      'function renderCliBundledPluginEntriesTs(',
      'function renderCliPromptAssetPluginDescriptorsTs(',
      registryRendererSource,
    );
    const output = renderRetainedCliBundledPluginImplementationEntriesTs(outputPath);

    expect(executableRenderer).not.toContain('./generatedBundledPluginManifests');
    expect(output).not.toContain('./generatedBundledPluginManifests');
    expect(output).toContain('BUNDLED_FIRST_PARTY_AGENT_REGISTRATION_BINDINGS: readonly BundledFirstPartyAgentRegistrationBinding[] = Object.freeze');
    expect(executableRenderer).not.toContain("pluginPackage.pluginPackageId === 'pi'");
    expect(executableRenderer).not.toContain('runtimeContributions');
    expect(output).not.toContain('implementation: createAgentRuntimeCatalogEntryHooks');
    expect(output).not.toContain('PI_AGENT_RUNTIME_CONTRIBUTION');
    expect(output).not.toContain('@happier-dev/plugins-pi');
    expect(output).not.toMatch(/plugins-(?:grok|kilo|ohmypi)\/agent\/contributions/u);
    expect(output).not.toContain('BUNDLED_FIRST_PARTY_PLUGIN_PACKAGE_NAMES = Object.freeze');
    expect(output).not.toContain('BUNDLED_FIRST_PARTY_PLUGIN_LOCATORS = Object.freeze');
    expect(output).not.toContain('PluginSourceSpecV1');
  });
});

describe('readExternalSessionSourceDeclaration', () => {
  it('projects every public external-session source-instance kind without narrowing', () => {
    const declaration = readExternalSessionSourceDeclaration({
      sourceKind: 'externalPluginSource',
      schema: {
        fields: [
          { kind: 'literal', name: 'kind', value: 'externalPluginSource' },
          { kind: 'string', name: 'location', min: 1 },
        ],
      },
      key: {
        segments: [
          { kind: 'literal', value: 'externalPluginSource' },
          { kind: 'field', field: 'location' },
        ],
      },
      instances: [
        { kind: 'default', constants: { location: 'fallback' } },
        {
          kind: 'connectedServiceProfiles',
          serviceId: 'openai',
          constants: { location: 'connected' },
          fields: { serviceId: 'serviceId', profileId: 'profileId' },
        },
        {
          kind: 'agentSetting',
          settingId: 'endpoint',
          byServerIdSettingId: 'endpointByServer',
          field: 'location',
          normalization: 'httpOrigin',
          constants: { location: 'managed' },
        },
        {
          kind: 'agentSettingOverride',
          settingId: 'configuredDirectory',
          byServerIdSettingId: 'configuredDirectoryByServer',
          field: 'location',
          normalization: 'configuredPath',
          constants: { location: 'configured' },
        },
      ],
    }, 'externalPluginSource', 'external-plugin');

    expect(declaration).toMatchObject({
      agentId: 'external-plugin',
      sourceKind: 'externalPluginSource',
      schema: {
        fields: [
          { kind: 'literal', name: 'kind', value: 'externalPluginSource' },
          { kind: 'string', name: 'location', min: 1 },
        ],
      },
      key: {
        segments: [
          { kind: 'literal', value: 'externalPluginSource' },
          { kind: 'field', field: 'location' },
        ],
      },
      instances: [
        { kind: 'default', constants: { location: 'fallback' } },
        {
          kind: 'connectedServiceProfiles',
          serviceId: 'openai',
          constants: { location: 'connected' },
          fields: { serviceId: 'serviceId', profileId: 'profileId' },
        },
        {
          kind: 'agentSetting',
          settingId: 'endpoint',
          byServerIdSettingId: 'endpointByServer',
          field: 'location',
          normalization: 'httpOrigin',
          constants: { location: 'managed' },
        },
        {
          kind: 'agentSettingOverride',
          settingId: 'configuredDirectory',
          byServerIdSettingId: 'configuredDirectoryByServer',
          field: 'location',
          normalization: 'configuredPath',
          constants: { location: 'configured' },
        },
      ],
    });

    const projection = renderGeneratedExternalSessionSourcesTs([{
      agentId: 'external-plugin',
      declaration,
    }]);
    expect(projection).toContain('"kind": "agentSettingOverride"');
    expect(projection).toContain('"normalization": "configuredPath"');
  });

  it('projects an endpoint override without narrowing it to a configured path', () => {
    // Whether a configured source REPLACES the paired default is independent of
    // how its raw setting value is normalized. Narrowing the override kind to
    // `configuredPath` here made this projector a second, stricter owner of the
    // protocol declaration schema, so a declared server endpoint could not be an
    // override at all and every such Agent kept materializing its managed
    // default beside the server its operator named.
    const declaration = readExternalSessionSourceDeclaration({
      sourceKind: 'externalPluginServer',
      schema: {
        fields: [
          { kind: 'literal', name: 'kind', value: 'externalPluginServer' },
          { kind: 'unknown', name: 'baseUrl', optional: true },
        ],
      },
      key: {
        segments: [
          { kind: 'literal', value: 'externalPluginServer' },
          { kind: 'field', field: 'baseUrl' },
        ],
      },
      instances: [
        { kind: 'default', constants: {} },
        {
          kind: 'agentSettingOverride',
          settingId: 'serverBaseUrl',
          byServerIdSettingId: 'serverBaseUrlByServer',
          field: 'baseUrl',
          normalization: 'httpOrigin',
          constants: {},
        },
      ],
    }, 'externalPluginServer', 'external-plugin');

    expect(declaration.instances).toEqual([
      { kind: 'default', constants: {} },
      {
        kind: 'agentSettingOverride',
        settingId: 'serverBaseUrl',
        byServerIdSettingId: 'serverBaseUrlByServer',
        field: 'baseUrl',
        normalization: 'httpOrigin',
        constants: {},
      },
    ]);
  });
});

describe('bundled Voice UI declaration projection', () => {
  it('shares runtime bytes for equal platform membership and distinguishes a platform subset', () => {
    const ingestion = ingestPluginManifestV2({
      schemaVersion: 2, id: 'happier.agent.codex', version: '0.0.0', displayName: 'Codex',
      engines: { happier: '^0.0.0' }, runtime: { apiVersion: 1 },
    });
    if (!ingestion.ok) throw new Error(JSON.stringify(ingestion.diagnostics));
    const shared = {
      pluginPackageId: 'codex',
      packageName: '@happier-dev/plugins-codex',
      packageVersion: '0.0.0',
      pluginId: 'happier.agent.codex',
      manifest: ingestion.manifest,
      hasConversationProvider: true,
      conversationClient: { artifactId: 'voice-runtime-web', exportName: 'activate' },
      conversationPlatforms: ['web', 'ios', 'android'],
    } satisfies Parameters<typeof renderBundledVoiceRuntimeEntriesTs>[0][number];
    const sources = [shared];
    const web = renderBundledVoiceRuntimeEntriesTs(sources, 'web');
    expect(renderBundledVoiceRuntimeEntriesTs(sources, 'ios')).toBe(web);
    expect(renderBundledVoiceRuntimeEntriesTs(sources, 'android')).toBe(web);
    const webOnly = [{ ...shared, conversationPlatforms: ['web'] as const }];
    expect(renderBundledVoiceRuntimeEntriesTs(webOnly, 'ios')).not.toContain('CODEX_BUNDLED_VOICE_ACTIVATE');
    expect(renderBundledVoiceRuntimeEntriesTs(webOnly, 'web')).toContain('CODEX_BUNDLED_VOICE_ACTIVATE');
  });
  it('projects manifest JSON without a plugin manifest-module import and retains only executable UI imports', () => {
    const manifestProjection = sourceBetween(
      'function renderBundledVoiceManifestProjectionConstant(',
      'function renderBundledVoiceEntriesTs(',
      voiceRendererSource,
    );
    const metadataRenderer = sourceBetween(
      'function renderBundledVoiceEntriesTs(',
      'function renderBundledVoiceRuntimeEntriesTs(',
      voiceRendererSource,
    );
    const runtimeRenderer = voiceRendererSource.slice(voiceRendererSource.indexOf('function renderBundledVoiceRuntimeEntriesTs('));

    expect(manifestProjection).toContain('Object.freeze(');
    expect(manifestProjection).toContain('renderJsonLiteral(source.manifest');
    expect(metadataRenderer).not.toContain('${source.packageName}/manifest');
    expect(metadataRenderer).toContain('renderBundledVoiceManifestProjectionConstant(source)');
    expect(metadataRenderer).toContain('VOICE_PROVIDER_PRESENTATIONS');
    expect(metadataRenderer).not.toContain('activate as');
    expect(runtimeRenderer).not.toContain('${source.packageName}/manifest');
    expect(runtimeRenderer).toContain('renderBundledVoiceManifestProjectionConstant(source)');
    expect(runtimeRenderer).toContain(
      '${source.conversationClient.exportName} as ${prefix}_BUNDLED_VOICE_ACTIVATE',
    );
  });

  it('reads committed manifest bytes through the canonical Protocol parser and reports invalid artifacts', () => {
    const manifestReader = sourceBetween(
      'function readCommittedBundledPluginManifest(',
      'async function synchronizeSerializedPluginManifest(',
    );
    const manifestNormalizer = sourceBetween(
      'function normalizePluginManifest(',
      'async function loadPluginManifest(',
    );

    expect(manifestReader).toContain('readFileSync(manifestPath)');
    expect(manifestReader).toContain('normalizePluginManifest(readFileSync(manifestPath), manifestPath, parser)');
    expect(manifestReader).toContain('Invalid bundled plugin manifest artifact');
    expect(manifestNormalizer).toContain('parser.ingestPluginManifestV2(rawManifest)');
  });

  it('reads every bundled plugin manifest through one isolated-module loader', () => {
    const manifestLoader = sourceBetween(
      'async function loadPluginManifest(',
      'function readCommittedBundledPluginManifest(',
    );

    expect(manifestLoader).toContain('await importTypescriptModule(manifestPath)');
    // A second, package-specific manifest reader is a split-brain owner: voice
    // packages are authored exactly like every other first-party plugin.
    expect(manifestLoader).not.toContain('isBundledFirstPartyVoicePackageId(pluginPackageId)');
    expect(generatorSource).not.toContain('readStaticVoiceManifest');
  });
});
