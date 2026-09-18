import type { AgentTerminalSurface } from '@happier-dev/plugin-sdk/agents/runtime';

/**
 * Devin's interactive terminal is the bare `devin` command. The launch plan is
 * arguments only: the host resolves the declared Devin CLI executable and
 * appends these, so naming the binary here would launch it twice.
 */
export const DEVIN_TERMINAL_SURFACE: AgentTerminalSurface = Object.freeze({
  resolveLaunch() {
    return {
      argv: [],
      process: { stdio: 'inherit' as const, windowsHide: true },
      presentation: {
        onLaunch: { target: 'local' as const, reason: 'devin_terminal_launch' },
        onExit: { target: 'remote' as const, reason: 'devin_terminal_exit' },
      },
    };
  },
});
