import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createPackageLayoutSandbox, writeCliBundledHostPackage } from '../__tests__/testkit/packageLayoutSandbox';
import { BUNDLED_AGENT_DEFINITIONS_BY_ID } from '../../../../packages/agents/src/generated/bundledAgentDefinitions';

describe('generator workspace lock policy', () => {

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
        `export { computeSourceDevSharedDepsSignature, inspectSourceDevSharedDepsForSourceDev, resolveBundledWorkspacePackageDir } from ${JSON.stringify(`${pathToFileURL(resolve(canonicalRoot, 'apps/cli/scripts/buildSharedDeps.mjs')).href}?fixture-currentness=1`)};`,
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
});
