import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { planDaemonServiceInstall, type DaemonServiceTargetMode } from './plan';

/**
 * Test-only: writes Linux user background-service definitions exactly as `service install` plans
 * them, so discovery reads real unit files rather than a mocked inventory.
 */
export function writeInstalledLinuxDaemonService(params: Readonly<{
  userHomeDir: string;
  happierHomeDir: string;
  targetMode: DaemonServiceTargetMode;
  /** The pinned server id; ignored for a default-following service. */
  serverId?: string;
  serverUrl?: string;
}>): string {
  const serverUrl = params.serverUrl ?? 'https://relay.example.test';
  const plan = planDaemonServiceInstall({
    platform: 'linux',
    mode: 'user',
    channel: 'stable',
    targetMode: params.targetMode,
    instanceId: params.serverId ?? 'default',
    activeServerId: params.targetMode === 'pinned' ? params.serverId ?? null : null,
    userHomeDir: params.userHomeDir,
    happierHomeDir: params.happierHomeDir,
    serverUrl,
    webappUrl: serverUrl,
    publicServerUrl: serverUrl,
    nodePath: '/usr/local/bin/node',
    entryPath: '/opt/happier/dist/index.mjs',
  });
  const [file] = plan.files;
  if (!file) throw new Error('The service plan wrote no definition');
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, file.content, 'utf-8');
  return file.path;
}
