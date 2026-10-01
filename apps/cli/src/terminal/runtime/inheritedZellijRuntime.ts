import type { TerminalRuntimeFlags } from './terminalRuntimeFlags';

export function resolveInheritedZellijRuntime(params: Readonly<{
  terminalRuntime: TerminalRuntimeFlags | null;
  env: NodeJS.ProcessEnv;
}>): TerminalRuntimeFlags | null {
  if (params.terminalRuntime?.mode && params.terminalRuntime.mode !== 'zellij') {
    return params.terminalRuntime;
  }
  const sessionName = params.env.ZELLIJ_SESSION_NAME?.trim();
  const paneId = params.env.ZELLIJ_PANE_ID?.trim();
  if (params.env.ZELLIJ !== '0' || !sessionName || !paneId) return params.terminalRuntime;
  return {
    ...params.terminalRuntime,
    mode: 'zellij',
    requested: 'zellij',
    zellijSessionName: sessionName,
    zellijPaneId: paneId,
    ...(params.env.ZELLIJ_SOCKET_DIR?.trim() ? { zellijSocketDir: params.env.ZELLIJ_SOCKET_DIR.trim() } : {}),
    ...(params.env.HAPPIER_TERMINAL_ATTACHMENT_ID?.trim()
      ? { attachmentId: params.env.HAPPIER_TERMINAL_ATTACHMENT_ID.trim() }
      : {}),
  };
}
