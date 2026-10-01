export type CodexRuntimeMode = 'terminal' | 'remote';

export function resolveCodexStartupRuntimeMode(params: Readonly<{
  explicitRuntimeMode?: CodexRuntimeMode;
  startedBy: 'daemon' | 'cli';
  hasTtyForTerminal: boolean;
  terminalRuntimeEnabled: boolean;
}>): CodexRuntimeMode {
  if (params.startedBy === 'daemon') {
    if (params.explicitRuntimeMode === 'terminal' && params.hasTtyForTerminal && params.terminalRuntimeEnabled) {
      return 'terminal';
    }
    return 'remote';
  }

  if (params.explicitRuntimeMode) {
    return params.explicitRuntimeMode;
  }

  if (params.terminalRuntimeEnabled && params.hasTtyForTerminal) {
    return 'terminal';
  }

  return 'remote';
}
