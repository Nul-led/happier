import type { ToolCall } from "@happier-dev/session-core/messages";

export function resolvePermissionRequestId(tool: Readonly<ToolCall>): string | null {
    const permissionId = typeof tool.permission?.id === 'string' ? tool.permission.id.trim() : '';
    if (permissionId.length > 0) {
        return permissionId;
    }

    const toolId = typeof tool.id === 'string' ? tool.id.trim() : '';
    return toolId.length > 0 ? toolId : null;
}
