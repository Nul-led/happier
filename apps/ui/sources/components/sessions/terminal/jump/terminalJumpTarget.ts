/**
 * The session pane a Jump to a terminal is for (terminal lab B4). The scope id is the exact
 * Home-qualified pane scope, including a workspace instance prefix, so the Jump's Actions address
 * the same terminal workspace the strip shows.
 */
export type TerminalJumpTarget = Readonly<{
    scopeId: string;
}>;

export const TERMINAL_JUMP_ROUTE_PARAM = 'terminalScopeId';
