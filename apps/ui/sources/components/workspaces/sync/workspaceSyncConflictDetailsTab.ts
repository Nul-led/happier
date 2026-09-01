import type { DetailsTab } from '@/components/appShell/panes/details/workspace/detailsWorkspaceTypes';
import type { WorkspaceSyncRelationshipSummary } from '@/sync/domains/sessionHandoff/workspaceSyncRelationshipModel';
import { resolveWorkspaceSyncStatusScope } from '@/sync/domains/sessionHandoff/useWorkspaceSyncRelationshipSummaries';
import { t } from '@/text';

export function createWorkspaceSyncConflictDetailsTab(
    summary: WorkspaceSyncRelationshipSummary,
    localWorkspaceRefId?: string | null,
): DetailsTab {
    const scope = resolveWorkspaceSyncStatusScope(summary);
    return {
        key: `workspace-sync-conflicts:${summary.relationshipId}`,
        kind: 'workspaceSyncConflicts',
        title: t('workspaceSync.conflictsTitle'),
        resource: {
            kind: 'workspaceSyncConflicts',
            relationshipId: summary.relationshipId,
            controllerMachineId: scope.controllerMachineId,
            serverId: scope.serverId,
            mode: summary.relationship.mode,
            enabled: summary.relationship.enabled,
            alpha: {
                label: summary.alpha.label,
                machineId: summary.alpha.workspaceRef?.machineId ?? null,
                machineName: summary.alpha.machineName,
                rootPath: summary.alpha.workspaceRef?.rootPath ?? null,
            },
            beta: {
                label: summary.beta.label,
                machineId: summary.beta.workspaceRef?.machineId ?? null,
                machineName: summary.beta.machineName,
                rootPath: summary.beta.workspaceRef?.rootPath ?? null,
            },
            localSide: localWorkspaceRefId === summary.alpha.workspaceRefId
                ? 'alpha'
                : localWorkspaceRefId === summary.beta.workspaceRefId
                    ? 'beta'
                    : null,
        },
    };
}
