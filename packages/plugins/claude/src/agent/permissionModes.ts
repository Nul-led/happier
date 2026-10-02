/** Claude's native permission vocabulary, shared by execution and catalog presentation. */
export const CLAUDE_NATIVE_PERMISSION_MODES = Object.freeze({
    default: 'default',
    acceptEdits: 'acceptEdits',
    bypassPermissions: 'bypassPermissions',
    plan: 'plan',
    dontAsk: 'dontAsk',
    auto: 'auto',
    yolo: 'bypassPermissions',
    'safe-yolo': 'auto',
    'read-only': 'dontAsk',
} as const);

export type ClaudeProviderPermissionMode = (typeof CLAUDE_NATIVE_PERMISSION_MODES)[keyof typeof CLAUDE_NATIVE_PERMISSION_MODES];
