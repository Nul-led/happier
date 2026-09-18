import type { AgentTerminalSurface } from '@happier-dev/plugin-sdk/agents/runtime';

/**
 * FX has no terminal-only flags: the ordinary interactive `fx` command is the
 * whole surface. `argv` carries only the arguments appended after the
 * host-resolved Agent CLI executable, so naming the executable here would run
 * `fx fx`.
 */
export const FX_TERMINAL_CONTRIBUTION: AgentTerminalSurface = Object.freeze({
  async resolveLaunch() {
    return {
      argv: [],
      process: { stdio: 'inherit' as const, windowsHide: true },
      presentation: {
        onLaunch: { target: 'local' as const, reason: 'fx_terminal_launch' },
        onExit: { target: 'remote' as const, reason: 'fx_terminal_exit' },
      },
    };
  },
});
