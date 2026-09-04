import { WorkspaceSyncRuntimeEventV1Schema } from '@happier-dev/protocol';

import { invalidateWorkspaceSyncConflicts } from './workspaceSyncConflictStore';
import { applyWorkspaceSyncStatusEvent, type WorkspaceSyncStatusScope } from './workspaceSyncStatusStore';

export function applyWorkspaceSyncRuntimeEvent(input: Readonly<{
    serverId: string | null;
    machineId: string;
    event: unknown;
}>): void {
    const parsed = WorkspaceSyncRuntimeEventV1Schema.safeParse(input.event);
    if (!parsed.success || parsed.data.status.controllerMachineId !== input.machineId) return;
    const scope: WorkspaceSyncStatusScope = {
        serverId: input.serverId,
        controllerMachineId: input.machineId,
        relationshipId: parsed.data.status.relationshipId,
    };
    applyWorkspaceSyncStatusEvent(scope, parsed.data.status);
    invalidateWorkspaceSyncConflicts(scope);
}
