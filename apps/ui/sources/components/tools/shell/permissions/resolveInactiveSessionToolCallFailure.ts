import type { ToolCall } from "@happier-dev/session-core/messages";
import type { TranscriptPermissionDisabledReason } from '@/utils/sessions/deriveTranscriptInteraction';

export function resolveInactiveSessionToolCallFailure(params: Readonly<{
    tool: ToolCall;
    permissionDisabledReason?: TranscriptPermissionDisabledReason;
}>): ToolCall {
    if (params.permissionDisabledReason !== 'inactive') return params.tool;

    const permission = params.tool.permission;
    if (!permission || permission.status !== 'pending') return params.tool;
    if (params.tool.state !== 'running') return params.tool;

    return {
        ...params.tool,
        state: 'error',
        permission: {
            ...permission,
            status: 'canceled',
        },
    };
}
