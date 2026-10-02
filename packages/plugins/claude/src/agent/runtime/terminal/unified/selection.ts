import type { RuntimeDescriptorV1, TerminalHostKind } from '@happier-dev/plugin-sdk/agents/runtime';
import { PluginError } from '@happier-dev/plugin-sdk';

export const CLAUDE_UNIFIED_TERMINAL_FEATURE_ID = 'agents.claude.unifiedTerminal';
export const CLAUDE_UNIFIED_TERMINAL_SETTING_KEY = 'claudeUnifiedTerminalEnabled';

type ClaudeUnifiedTerminalSelectionContext = Readonly<{
  features: Readonly<{ isEnabled(featureId: string): boolean }>;
  settings: Readonly<{ get(key: string): Promise<unknown> }>;
}>;

/**
 * The feature decision is the admission boundary; the account setting is read only after that
 * boundary admits the capability. Missing, malformed, or unavailable settings fail closed.
 * `settingOverride` exists only for the retained V1 carrier, whose launch metadata already carries
 * the canonical setting snapshot. Native AgentRuntime callers must use the settings service.
 */
export async function isClaudeUnifiedTerminalSelected(params: Readonly<{
  context: ClaudeUnifiedTerminalSelectionContext;
  runtimeDescriptorV1?: RuntimeDescriptorV1;
  settingOverride?: boolean | null;
}>): Promise<boolean> {
  const captured = readClaudeTerminalRuntimeSelection(params.runtimeDescriptorV1);
  const featureEnabled = params.context.features.isEnabled(CLAUDE_UNIFIED_TERMINAL_FEATURE_ID);
  if (captured) {
    if (captured.mode === 'unifiedTerminal' && !featureEnabled) {
      throw new PluginError({
        code: 'claude_unified_terminal_unavailable', retryable: false,
        message: 'The selected Claude unified terminal capability is unavailable.',
      });
    }
    return captured.mode === 'unifiedTerminal';
  }
  if (!featureEnabled) return false;
  if (typeof params.settingOverride === 'boolean') return params.settingOverride;
  try {
    return await params.context.settings.get(CLAUDE_UNIFIED_TERMINAL_SETTING_KEY) === true;
  } catch {
    return false;
  }
}

/** The selected Claude owner writes this intent; the opener and native host consume it. */
export function readClaudeTerminalRuntimeSelection(descriptor: RuntimeDescriptorV1 | undefined): Readonly<{
  mode: 'agentSdk' | 'unifiedTerminal';
  host?: TerminalHostKind;
}> | null {
  if (descriptor?.v !== 1 || descriptor.agentId !== 'claude') return null;
  const mode = descriptor.agent.backendMode;
  if (mode !== 'agentSdk' && mode !== 'unifiedTerminal') return null;
  const host = descriptor.agent.terminalHostKind;
  return {
    mode,
    ...(host === 'herdr' || host === 'tmux' || host === 'zellij' || host === 'windows_console' ? { host } : {}),
  };
}
