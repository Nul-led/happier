import type { AgentState } from '@happier-dev/session-core/state';

export function getPermissionsInUiWhileLocal(capabilities: AgentState['capabilities'] | null | undefined): boolean {
    if (!capabilities) return false;
    return capabilities.permissionsInUiWhileLocal === true || capabilities.localPermissionBridgeInLocalMode === true;
}

