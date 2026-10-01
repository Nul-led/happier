import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PUBLIC_TOOLCHAIN_SCAFFOLD_BINDINGS_V1 } from '@happier-dev/plugin-sdk/ui/build';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configuration, reloadConfiguration } from '@/configuration';
import type { DaemonPluginChangeService } from '@/plugins/daemon/changeService';
import { createDaemonPluginRuntimeOwner } from '@/plugins/daemon/runtimeOwner';
import {
  createPluginReloadController,
  type PluginReloadController,
} from '@/plugins/runtime/reload/controller';
import { createPluginStateStore } from '@/plugins/store/state.testkit';
import type { StablePluginConnectedAccountsOwner } from '@/plugins/runtime/invocation/services/connectedAccounts';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

import { handlePluginsCommand } from './plugins';

// The external Session-Agent author journey canary. It drives the actual
// canonical lifecycle an outside author runs — `plugins create --template
// session-agent`, `plugins dev install`
// (dependency materialization/refresh), `plugins test`, `plugins dev build`,
// the headless `plugins install . --dev` daemon change, and
// `plugins uninstall` — in a temp directory outside this repository, against
// current source.
//
// Boundary posture: only the CLI↔daemon transport is substituted, exactly like
// the rest of this command lane (for example the install-and-trust coverage in
// `plugins.test.ts`): the transport boundary carries the request to the real
// in-process daemon plugin runtime owner, so review, trust, generation
// materialization, and application all run through the canonical daemon
// owners. The prepublication Plugin SDK resolves through the running CLI's
// workspace materialization, dependency installation uses the Happier-managed
// package materializer against real registries, and typecheck/build/test run
// through the same managed toolchain owners the focused author commands use.
// This proves the documented source/package authoring closure plus the
// canonical install/trust/uninstall daemon change. A live Session turn is not
// runnable in this host lane: the loaded current-source browser/desktop/mobile
// corridors own that leg against a real daemon.
//
// Unlike the mocked-toolchain coverage in `plugins.test.ts`, this canary runs
// the real managed author toolchain: it materializes declared dependencies from
// real registries and compiles/bundles the scaffolded plugin, so it needs
// network access, the Happier-managed pnpm and JavaScript runtime the author
// commands themselves require, and minutes rather than seconds. It is therefore
// an opt-in real-integration row: `vitest.integration.config.ts` excludes this
// file unless `HAPPIER_RUN_SESSION_AGENT_CANARY=1`, exactly like the other
// real-dependency rows in that lane.

const daemonBoundary = vi.hoisted(() => ({
  ensureRunning: vi.fn(async () => undefined),
  requestChange: vi.fn(),
  decideChange: vi.fn(),
  readCatalog: vi.fn(),
}));

vi.mock('@/daemon/ensureDaemon', () => ({
  ensureDaemonRunningForSessionCommand: daemonBoundary.ensureRunning,
}));

vi.mock('@/daemon/controlClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/daemon/controlClient')>(),
  requestDaemonPluginChange: daemonBoundary.requestChange,
  decideDaemonPluginChange: daemonBoundary.decideChange,
  readDaemonPluginCatalog: daemonBoundary.readCatalog,
}));

let activePluginChangeService: DaemonPluginChangeService | null = null;
let activePluginReloadController: PluginReloadController | null = null;

function createInProcessPluginChangeService(): DaemonPluginChangeService {
  const connectedAccounts: StablePluginConnectedAccountsOwner = Object.freeze({
    getBinding: vi.fn(async () => null),
    requestSelection: vi.fn(async () => {
      throw new Error('Unexpected connected-account selection during the Session Agent canary');
    }),
    materialize: vi.fn(async () => {
      throw new Error('Unexpected connected-account materialization during the Session Agent canary');
    }),
    listAccounts: async () => {
      throw new Error('Connected Account listing is outside the Session Agent canary');
    },
    materializeListedAccount: async () => {
      throw new Error('Exact-listed Connected Account materialization is outside the Session Agent canary');
    },
    watch: vi.fn(() => Object.freeze({ dispose() {} })),
  });
  const reloadController = createPluginReloadController({
    happyHomeDir: configuration.happyHomeDir,
  });
  activePluginReloadController = reloadController;
  return createDaemonPluginRuntimeOwner({
    happyHomeDir: configuration.happyHomeDir,
    reloadController,
    staleCandidateCleanup: 'disabled',
    connectedAccounts,
  }).changeService;
}

type PluginsJsonEnvelope = Readonly<{
  ok: boolean;
  kind: string;
  data?: Readonly<{
    plugin?: { pluginId: string; title: string; version: string };
    pluginId?: string;
    desiredGeneration?: string;
    appliedGeneration?: string;
    scaffold?: { targetDir: string; packageJsonPath: string; sourceEntryPath: string };
    operation?: string;
    projectRoot?: string;
  }>;
  error?: { code: string; message?: string };
}>;

async function runPluginsJsonCommand(args: readonly string[]): Promise<PluginsJsonEnvelope> {
  const output = captureConsoleJsonOutput<PluginsJsonEnvelope>();
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await handlePluginsCommand([...args, '--json']);
    // The shared JSON-output harness owner selects the exact command envelope
    // when ordinary in-process daemon runtime diagnostics share the stream,
    // and keeps failing loudly when no command envelope was emitted.
    try {
      return output.json();
    } catch (error) {
      throw new Error(`plugins command did not emit a JSON envelope: ${args.join(' ')}`, { cause: error });
    }
  } finally {
    output.restore();
    if (process.exitCode === 1) {
      // Restore the caller's exit code: a failed command reported through its
      // parsed envelope is an assertion failure below, not a process failure.
      process.exitCode = previousExitCode;
    }
  }
}

describe('external Session-Agent author journey canary', () => {
  // Scaffold scripts and the generated authoring skill name the invoker the
  // author actually invoked (`resolveInvokerName()`), so pin the documented
  // default lane for these assertions instead of inheriting the test runner's
  // argv. The isolated temp home keeps the in-process daemon runtime owner and
  // its install registry out of the developer's real Happier home.
  let invokerNameScope: ReturnType<typeof createEnvKeyScope> | null = null;
  let homeDirScope: ReturnType<typeof createEnvKeyScope> | null = null;
  let tempHomeDir: string | null = null;

  beforeEach(async () => {
    invokerNameScope = createEnvKeyScope(['HAPPIER_CLI_INVOKER_NAME']);
    invokerNameScope.patch({ HAPPIER_CLI_INVOKER_NAME: 'happier' });
    tempHomeDir = await mkdtemp(join(tmpdir(), 'happier-session-agent-canary-home-'));
    homeDirScope = createEnvKeyScope(['HAPPIER_HOME_DIR']);
    homeDirScope.patch({ HAPPIER_HOME_DIR: tempHomeDir });
    reloadConfiguration();
    activePluginChangeService = null;
    activePluginReloadController = null;
    daemonBoundary.ensureRunning.mockClear();
    daemonBoundary.requestChange.mockReset();
    daemonBoundary.decideChange.mockReset();
    daemonBoundary.readCatalog.mockReset();
    daemonBoundary.readCatalog.mockResolvedValue({ kind: 'unavailable', code: 'daemon_unavailable' });
    daemonBoundary.requestChange.mockImplementation(async (request) => {
      activePluginChangeService ??= createInProcessPluginChangeService();
      return await activePluginChangeService.requestPluginChange(request);
    });
    daemonBoundary.decideChange.mockImplementation(async (decision) => {
      if (!activePluginChangeService) throw new Error('Plugin change decision arrived before its request');
      return await activePluginChangeService.decidePluginChange(decision);
    });
  });

  afterEach(async () => {
    invokerNameScope?.restore();
    invokerNameScope = null;
    homeDirScope?.restore();
    homeDirScope = null;
    await activePluginChangeService?.shutdown();
    await activePluginReloadController?.shutdown();
    activePluginChangeService = null;
    activePluginReloadController = null;
    if (tempHomeDir) {
      await rm(tempHomeDir, { recursive: true, force: true });
      tempHomeDir = null;
    }
    reloadConfiguration();
  });

  it('creates the Session Agent template and installs, tests, builds, trusts, and uninstalls it in a temp directory', { timeout: 1_500_000 }, async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'happier-session-agent-canary-'));
    const targetDir = join(parentDir, 'my-session-agent');
    try {
      // 1. Canonical scaffold/create.
      const created = await runPluginsJsonCommand([
        'create',
        targetDir,
        '--id',
        'examples.session-agent',
        '--name',
        'Deterministic Session Agent',
        '--template',
        'session-agent',
      ]);
      expect(
        created,
        created.error ? `${created.error.code}: ${created.error.message ?? ''}` : undefined,
      ).toMatchObject({ ok: true, kind: 'plugins_create' });
      expect(created.data?.plugin).toEqual({
        pluginId: 'examples.session-agent',
        title: 'Deterministic Session Agent',
        version: '0.1.0',
      });
      expect(created.data?.scaffold?.sourceEntryPath).toBe(join(targetDir, 'src', 'index.ts'));

      // Self-contained project facts: real dependency declarations from the
      // public toolchain packet, no workspace/file aliases, no private
      // first-party packages, and the canonical command vocabulary.
      const packageJson = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      expect(packageJson.dependencies?.['@happier-dev/plugin-sdk'])
        .toBe(PUBLIC_TOOLCHAIN_SCAFFOLD_BINDINGS_V1.dependencies['@happier-dev/plugin-sdk']);
      expect({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      }).not.toHaveProperty('@happier-dev/protocol');
      expect({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      }).not.toHaveProperty('@happier-dev/agents');
      for (const specifier of Object.values({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
        expect(specifier, 'generated dependencies must resolve from registries, not the monorepo')
          .not.toMatch(/^(?:file|link|workspace):/u);
      }
      expect(packageJson.scripts?.build).toBe('happier plugins dev build .');
      expect(packageJson.scripts?.test).toBe('happier plugins test .');

      // The generated authoring skill ships the real author-root dependency
      // refresh exception from its canonical template owner.
      const generatedSkill = await readFile(
        join(targetDir, '.agents', 'skills', 'happier-plugin-authoring', 'SKILL.md'),
        'utf8',
      );
      expect(generatedSkill).toContain('Exception — dependency refresh');
      expect(generatedSkill).toContain('do not run `happier plugins dev install .` first');
      expect(generatedSkill).toContain('run `happier plugins dev install .` once to refresh the tree');

      // 2. The template emits the same public authoring shape as the
      //    maintained reference: one package entry, one import-safe runner
      //    leaf, and a matching generated test with no stale generic Action.
      const scaffoldedSources = await Promise.all([
        readFile(join(targetDir, 'src', 'index.ts'), 'utf8'),
        readFile(join(targetDir, 'src', 'agent', 'sessionAgent.ts'), 'utf8'),
        readFile(join(targetDir, 'test', 'index.test.mjs'), 'utf8'),
      ]);
      for (const source of scaffoldedSources) {
        expect(source, 'the generated template must import public SDK entrypoints only').not.toMatch(
          /@happier-dev\/(?:protocol|agents)\b|plugin-sdk\/internal\b|from ['"]@\/|import\(['"]@\//u,
        );
      }
      expect(scaffoldedSources[2]).not.toContain('save-note');
      expect(scaffoldedSources[2]).toContain('sessionRunnerFactory');

      // 3. Dependency install/refresh through the canonical author toolchain
      //    owner (prepublication SDK materialization plus managed install).
      const installed = await runPluginsJsonCommand(['dev', 'install', targetDir]);
      expect(
        installed,
        installed.error ? `${installed.error.code}: ${JSON.stringify(installed.error)}` : undefined,
      ).toMatchObject({ ok: true, kind: 'plugins_dev_install' });
      expect((await stat(join(
        targetDir,
        'node_modules',
        '@happier-dev',
        'plugin-sdk',
        'package.json',
      ))).isFile()).toBe(true);

      // 4. The managed test lane: compile, bundle the daemon entry, and run
      //    the copied example suite — which itself asserts the compiled
      //    manifest's one Session Agent and runner locator.
      const tested = await runPluginsJsonCommand(['test', targetDir]);
      expect(
        tested,
        tested.error ? `${tested.error.code}: ${JSON.stringify(tested.error)}` : undefined,
      ).toMatchObject({ ok: true, kind: 'plugins_test', data: { operation: 'test' } });
      expect((await stat(join(targetDir, 'dist', 'index.js'))).isFile()).toBe(true);

      // 5. The canonical full build lane.
      const built = await runPluginsJsonCommand(['dev', 'build', targetDir]);
      expect(
        built,
        built.error ? `${built.error.code}: ${JSON.stringify(built.error)}` : undefined,
      ).toMatchObject({ ok: true, kind: 'plugins_dev_build', data: { operation: 'build' } });

      // 6. The documented headless first install: the explicit `--dev` command
      //    is the exact-source code-trust action, served by the real in-process
      //    daemon runtime owner.
      //    A committed result with a current applied generation is the
      //    activation fact this host lane can reach; a real Session turn stays
      //    with the loaded current-source corridors.
      const trustedInstall = await runPluginsJsonCommand([
        'install',
        targetDir,
        '--dev',
      ]);
      expect(
        trustedInstall,
        trustedInstall.error
          ? `${trustedInstall.error.code}: ${trustedInstall.error.message ?? ''}`
          : undefined,
      ).toMatchObject({ ok: true, kind: 'plugins_install' });
      expect(trustedInstall.data?.pluginId).toBe('examples.session-agent');
      expect(typeof trustedInstall.data?.appliedGeneration).toBe('string');
      expect(trustedInstall.data?.appliedGeneration).toBe(trustedInstall.data?.desiredGeneration);
      const installedState = await createPluginStateStore({
        happyHomeDir: configuration.happyHomeDir,
      }).read();
      expect(installedState.plugins['examples.session-agent']?.install.trust?.state).toBe('trusted');

      // 7. The ordinary uninstall command. It intentionally preserves plugin
      //    data, exactly as the example README documents.
      const uninstalled = await runPluginsJsonCommand(['uninstall', 'examples.session-agent']);
      expect(
        uninstalled,
        uninstalled.error ? `${uninstalled.error.code}: ${uninstalled.error.message ?? ''}` : undefined,
      ).toMatchObject({ ok: true, kind: 'plugins_uninstall' });
      const uninstalledState = await createPluginStateStore({
        happyHomeDir: configuration.happyHomeDir,
      }).read();
      expect(uninstalledState.plugins['examples.session-agent']).toBeUndefined();
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });
});
