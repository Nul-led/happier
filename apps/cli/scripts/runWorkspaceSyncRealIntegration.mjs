#!/usr/bin/env node
import { accessSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execYarn } from '../../../scripts/workspaces/execYarnCommand.mjs';
import { resolveArtifactName } from '../../../packages/iroh-native/scripts/build-node-addon.mjs';

const cliDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultIrohNativeDirectory = resolve(cliDirectory, '../../packages/iroh-native');
export const requiredWorkspaceSyncRealBinaryEnvironment = Object.freeze([
  'HAPPIER_MUTAGEN_LIVE_MANAGER_BIN',
  'HAPPIER_MUTAGEN_LIVE_AGENT_BIN',
  'HAPPIER_MUTAGEN_BROKER_CLIENT_TEST_BIN',
  'HAPPIER_PROCESS_CUSTODY_LIVE_BIN',
]);

export function createWorkspaceSyncRealIntegrationPlan({
  env = process.env,
  cwd = cliDirectory,
  platform = process.platform,
  arch = process.arch,
  irohNativeDirectory = defaultIrohNativeDirectory,
} = {}) {
  const missing = requiredWorkspaceSyncRealBinaryEnvironment.filter((name) => !String(env[name] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`workspace-sync real-lane blocked preflight: required ${requiredWorkspaceSyncRealBinaryEnvironment.join(', ')}; missing ${missing.join(', ')}`);
  }
  const platformPath = platform === 'win32' ? win32 : posix;
  const addonPath = platformPath.join(
    irohNativeDirectory,
    'native',
    resolveArtifactName(platform, arch, { testRelayFixture: true }),
  );
  const mutagenTestEnvironment = {
    ...env,
    HAPPIER_RUN_MUTAGEN_REAL_INTEGRATION: '1',
  };
  const createTestPlan = (specPath, testEnv = mutagenTestEnvironment) => ({
    args: [
      '-s',
      'vitest:local',
      'run',
      '--isolate',
      '-c',
      'vitest.integration.config.ts',
      specPath,
    ],
    cwd,
    env: testEnv,
  });
  return {
    binaryInputs: requiredWorkspaceSyncRealBinaryEnvironment.map((name) => ({
      name,
      path: resolve(String(env[name])),
    })),
    binaryPaths: requiredWorkspaceSyncRealBinaryEnvironment.map((name) => resolve(String(env[name]))),
    addonPath,
    build: {
      args: ['-s', 'build:native:test-relay'],
      cwd: irohNativeDirectory,
    },
    tests: [
      createTestPlan('src/workspaces/sync/transport/workspaceSyncBroker.go.real.integration.test.ts'),
      createTestPlan('src/daemon/startup/createDaemonWorkspaceSyncRuntime.real.integration.test.ts'),
      createTestPlan(
        'src/daemon/peer/iroh/workspaceMachineCarrierMutagen.real.integration.test.ts',
        {
          ...mutagenTestEnvironment,
          HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION: '1',
        },
      ),
    ],
  };
}

export function runWorkspaceSyncRealIntegration({
  env = process.env,
  accessSyncImpl = accessSync,
  execYarnImpl = execYarn,
  makeTempDirImpl = mkdtempSync,
  copyFileImpl = copyFileSync,
  removeDirImpl = rmSync,
} = {}) {
  const plan = createWorkspaceSyncRealIntegrationPlan({ env });
  for (const binary of plan.binaryInputs) {
    try {
      accessSyncImpl(binary.path);
    } catch {
      throw new Error(
        `workspace-sync real-lane blocked preflight: ${binary.name} points to an unavailable binary at ${binary.path}`,
      );
    }
  }
  execYarnImpl(plan.build.args, {
    cwd: plan.build.cwd,
    env,
    stdio: 'inherit',
  });
  try {
    accessSyncImpl(plan.addonPath);
  } catch {
    throw new Error(
      `workspace-sync real-lane blocked preflight: the source-built Iroh relay fixture is unavailable at ${plan.addonPath}`,
    );
  }

  // The canonical remote workspace mirror excludes ignored native build
  // output. Preserve the selected source-built addon outside the mirror
  // before either child test can trigger another synchronization boundary.
  // Darwin's per-user temp prefix is long enough to collide after Unix-socket
  // path truncation. `/tmp` is the platform's canonical short alias and keeps
  // the broker endpoint distinct for each mkdtemp-owned fixture directory.
  const tempRoot = process.platform === 'darwin' ? '/tmp' : tmpdir();
  const stableDirectory = makeTempDirImpl(join(tempRoot, 'happier-workspace-sync-real-'));
  try {
    const stableAddonPath = join(stableDirectory, 'addon.node');
    copyFileImpl(plan.addonPath, stableAddonPath);
    for (const testPlan of plan.tests) {
      execYarnImpl(testPlan.args, {
        cwd: testPlan.cwd,
        env: {
          ...testPlan.env,
          // Mutagen's local broker uses Unix-domain sockets. Keep all fixture
          // roots below the already-bounded runner directory so macOS's long
          // per-user temp prefix cannot exceed the socket path limit.
          TMPDIR: tempRoot,
          TMP: tempRoot,
          TEMP: tempRoot,
          HAPPIER_TEST_IROH_NODE_ADDON_PATH: stableAddonPath,
        },
        stdio: 'inherit',
      });
    }
  } finally {
    removeDirImpl(stableDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    runWorkspaceSyncRealIntegration();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[workspace-sync:real] ${message}\n`);
    process.exitCode = 1;
  }
}
