import type { DaemonSpawnHooks } from '@/daemon/spawnHooks';
import { resolveOpenCodeCliLaunchSpec } from '@/backends/opencode/utils/resolveOpenCodeCliCommand';
import { resolveOpenCodeBackendModeFromEnv } from '@/backends/opencode/backendMode';

export const opencodeDaemonSpawnHooks: DaemonSpawnHooks = {
  resolveTerminalPresentation: ({ host, processEnv }) => {
    if (resolveOpenCodeBackendModeFromEnv(processEnv) === 'acp') return { kind: 'none' };
    return { kind: 'runner', startingMode: host === 'tmux' ? 'remote' : 'local' };
  },
  validateSpawn: async () => {
    try {
      resolveOpenCodeCliLaunchSpec();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
