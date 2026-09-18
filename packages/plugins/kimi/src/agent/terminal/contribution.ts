import type { AgentTerminalSurface } from '@happier-dev/plugin-sdk/agents/runtime';

/**
 * The ordinary interactive `kimi` command is the terminal surface. `argv`
 * carries only the arguments the host appends after the Agent CLI executable it
 * already resolved (`args: [...executable.args, ...plan.argv]` in
 * `backendEngineSurfaceBindings`), so naming the executable here would run
 * `kimi kimi`.
 */
export const KIMI_TERMINAL_CONTRIBUTION: AgentTerminalSurface = Object.freeze({
  async resolveLaunch() {
    return {
      argv: [],
      process: { stdio: 'inherit' as const, windowsHide: true },
      presentation: {
        onLaunch: { target: 'local' as const, reason: 'kimi_terminal_launch' },
        onExit: { target: 'remote' as const, reason: 'kimi_terminal_exit' },
      },
    };
  },
});
