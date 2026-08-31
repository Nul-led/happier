#!/usr/bin/env node
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execYarn } from '../../../scripts/workspaces/execYarnCommand.mjs';
import { resolveArtifactName } from './build-node-addon.mjs';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = resolve(packageDir, '../../apps/server');
const cliDir = resolve(packageDir, '../../apps/cli');

export function createHomeIrohRealIntegrationPlan({
  platform = process.platform,
  arch = process.arch,
  packageDir: selectedPackageDir = packageDir,
  serverDir: selectedServerDir = serverDir,
  cliDir: selectedCliDir = cliDir,
} = {}) {
  const platformPath = platform === 'win32' ? win32 : posix;
  const addonPath = platformPath.join(
    selectedPackageDir,
    'native',
    resolveArtifactName(platform, arch, { testRelayFixture: true }),
  );
  return {
    build: {
      args: ['-s', 'build:native:test-relay'],
      cwd: selectedPackageDir,
    },
    tests: {
      server: {
        args: [
          '-s',
          'vitest:local',
          'run',
          '--isolate',
          '-c',
          'vitest.integration.config.ts',
          'sources/app/iroh/homeIrohEndpoint.real.integration.test.ts',
        ],
        cwd: selectedServerDir,
        env: {
          HAPPIER_IROH_REQUIRE_NODE_ADDON: '1',
          HAPPIER_TEST_IROH_NODE_ADDON_PATH: addonPath,
        },
      },
      machine: {
        args: [
          '-s',
          'vitest:local',
          'run',
          '--isolate',
          '-c',
          'vitest.integration.config.ts',
          'src/daemon/peer/iroh/workspaceMachineCarrierLane08.real.integration.test.ts',
        ],
        cwd: selectedCliDir,
        env: {
          HAPPIER_RUN_HOME_IROH_REAL_INTEGRATION: '1',
          HAPPIER_TEST_IROH_NODE_ADDON_PATH: addonPath,
        },
      },
    },
  };
}

export function runHomeIrohRealIntegration({
  execYarnImpl = execYarn,
  env = process.env,
  makeTempDirImpl = mkdtempSync,
  copyFileImpl = copyFileSync,
  removeDirImpl = rmSync,
} = {}) {
  const plan = createHomeIrohRealIntegrationPlan();
  execYarnImpl(plan.build.args, {
    cwd: plan.build.cwd,
    env,
    stdio: 'inherit',
  });
  // Remote workspace synchronization deliberately excludes ignored native
  // build output. Preserve the just-built addon outside that mirror before a
  // later child invocations can trigger another synchronization cycle.
  const stableDir = makeTempDirImpl(join(tmpdir(), 'happier-iroh-home-test-'));
  try {
    const stableAddonPath = join(stableDir, 'addon.node');
    copyFileImpl(plan.tests.server.env.HAPPIER_TEST_IROH_NODE_ADDON_PATH, stableAddonPath);
    for (const testPlan of Object.values(plan.tests)) {
      execYarnImpl(testPlan.args, {
        cwd: testPlan.cwd,
        env: {
          ...env,
          ...testPlan.env,
          HAPPIER_TEST_IROH_NODE_ADDON_PATH: stableAddonPath,
        },
        stdio: 'inherit',
      });
    }
  } finally {
    removeDirImpl(stableDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runHomeIrohRealIntegration();
}
