import { buildHappyCliSubprocessLaunchSpec, type HappyCliSubprocessLaunchOptions } from '@/utils/spawnHappyCLI';
import type { CatalogAgentId } from '@/agent/catalog/ids';
import { createAllowedEnvKeySet, isAllowedEnvKey } from '@/utils/env/envKeyAllowlist';
import { buildScopedProcessEnv } from '@/utils/processEnv/buildScopedProcessEnv';
import { finalizeSessionChildEnvironment } from '@/session/runtime/control/finalizeSessionChildEnvironment';
import { selectTrustedSessionControlEnvironment } from '@/session/runtime/control/sessionControlEnvironment';
import { resolveStackProcessKindOverrideForSessionSpawn } from '@/daemon/spawn/resolveStackProcessKindOverrideForSessionSpawn';
import { buildCgroupSelfMigratingHappyCliLaunchSpec } from '../linux/buildCgroupSelfMigratingHappyCliLaunchSpec';

type TmuxSpawnAgentId = CatalogAgentId | 'acp-catalog';

export function buildTmuxWindowEnv(
  daemonEnv: NodeJS.ProcessEnv,
  extraEnv: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
  unsetEnvKeys?: readonly string[],
  enableCgroupSelfMigration = String(daemonEnv.HAPPIER_DAEMON_STARTUP_SOURCE ?? '').trim() === 'background-service',
): Record<string, string> {
  const essentialKeys = [
    'PATH',
    'HOME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'TMPDIR',
    'TSX_TSCONFIG_PATH',
    'USER',
    'LOGNAME',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
  ] as const;

  const allowedKeys = createAllowedEnvKeySet(essentialKeys, platform);
  const filteredDaemonEnv = Object.fromEntries(
    Object.entries(daemonEnv)
      .filter(([key, value]) => (
        isAllowedEnvKey(key, allowedKeys, platform)
        && typeof value === 'string'
        && value.length > 0
      )),
  ) as Record<string, string>;

  const merged = buildScopedProcessEnv({
    baseEnv: filteredDaemonEnv,
    explicitEnv: extraEnv,
    unsetEnvKeys,
  });
  const stackProcessKindOverride = resolveStackProcessKindOverrideForSessionSpawn(daemonEnv);
  return finalizeSessionChildEnvironment({
    environment: merged,
    canonicalSessionControlEnvironment: selectTrustedSessionControlEnvironment(extraEnv),
    enableCgroupSelfMigration,
    stackProcessKind:
      stackProcessKindOverride.HAPPIER_STACK_PROCESS_KIND === 'session' ? 'session' : null,
  }) as Record<string, string>;
}

export async function buildTmuxSpawnConfig(params: {
  agent: TmuxSpawnAgentId;
  directory: string;
  extraEnv: Record<string, string>;
  tmuxCommandEnv?: Record<string, string>;
  unsetEnvKeys?: readonly string[];
  extraArgs?: string[];
  launchOptions?: HappyCliSubprocessLaunchOptions;
}): Promise<{
  commandTokens: string[];
  tmuxEnv: Record<string, string>;
  tmuxCommandEnv: Record<string, string>;
  directory: string;
  unsetEnvKeys: readonly string[];
}> {
  const args = [
    params.agent,
    '--happy-starting-mode',
    'remote',
    '--started-by',
    'daemon',
    ...(params.extraArgs ?? []),
  ];

  const launchSpec = buildHappyCliSubprocessLaunchSpec(args, params.launchOptions);
  const initialTmuxEnv = buildTmuxWindowEnv(
    process.env,
    { ...params.extraEnv, ...(launchSpec.env ?? {}) },
    process.platform,
    params.unsetEnvKeys,
  );
  const scopedLaunchSpec = process.platform === 'linux'
    ? await buildCgroupSelfMigratingHappyCliLaunchSpec({ launchSpec, environment: initialTmuxEnv })
    : null;
  const effectiveLaunchSpec = scopedLaunchSpec ?? launchSpec;
  const commandTokens = [effectiveLaunchSpec.filePath, ...effectiveLaunchSpec.args];
  const ownsCgroupScope = scopedLaunchSpec?.env?.HAPPIER_DAEMON_SPAWN_SELF_MIGRATE_CGROUP === '';
  const unsetEnvKeys = ownsCgroupScope
    ? [...new Set([...(params.unsetEnvKeys ?? []), 'HAPPIER_DAEMON_SPAWN_SELF_MIGRATE_CGROUP'])]
    : params.unsetEnvKeys ?? [];
  const tmuxEnv = buildTmuxWindowEnv(
    process.env,
    { ...params.extraEnv, ...(effectiveLaunchSpec.env ?? {}) },
    process.platform,
    unsetEnvKeys,
    ownsCgroupScope ? false : undefined,
  );

  const tmuxCommandEnv: Record<string, string> = { ...(params.tmuxCommandEnv ?? {}) };
  const tmuxTmpDir = tmuxCommandEnv.TMUX_TMPDIR;
  if (typeof tmuxTmpDir !== 'string' || tmuxTmpDir.length === 0) {
    delete tmuxCommandEnv.TMUX_TMPDIR;
  }

  return {
    commandTokens,
    tmuxEnv,
    tmuxCommandEnv,
    directory: params.directory,
    unsetEnvKeys,
  };
}
