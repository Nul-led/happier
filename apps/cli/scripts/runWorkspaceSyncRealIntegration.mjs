#!/usr/bin/env node
import { accessSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execYarn } from '../../../scripts/workspaces/execYarnCommand.mjs';

const cliDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredBinaryEnvironment = Object.freeze([
  'HAPPIER_MUTAGEN_LIVE_MANAGER_BIN',
  'HAPPIER_MUTAGEN_LIVE_AGENT_BIN',
  'HAPPIER_PROCESS_CUSTODY_LIVE_BIN',
]);

export function createWorkspaceSyncRealIntegrationPlan({
  env = process.env,
  cwd = cliDirectory,
} = {}) {
  const missing = requiredBinaryEnvironment.filter((name) => !String(env[name] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`source-built workspace-sync lane requires ${requiredBinaryEnvironment.join(', ')}; missing ${missing.join(', ')}`);
  }
  return {
    binaryPaths: requiredBinaryEnvironment.map((name) => resolve(String(env[name]))),
    args: [
      '-s',
      'vitest:local',
      'run',
      '--isolate',
      '-c',
      'vitest.integration.config.ts',
      'src/daemon/startup/createDaemonWorkspaceSyncRuntime.real.integration.test.ts',
    ],
    cwd,
    env: { ...env, HAPPIER_RUN_MUTAGEN_REAL_INTEGRATION: '1' },
  };
}

export function runWorkspaceSyncRealIntegration({
  env = process.env,
  accessSyncImpl = accessSync,
  execYarnImpl = execYarn,
} = {}) {
  const plan = createWorkspaceSyncRealIntegrationPlan({ env });
  for (const binaryPath of plan.binaryPaths) accessSyncImpl(binaryPath);
  execYarnImpl(plan.args, { cwd: plan.cwd, env: plan.env, stdio: 'inherit' });
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
