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
            alphaLabel: summary.alpha.label,
            betaLabel: summary.beta.label,
            localSide: localWorkspaceRefId === summary.alpha.workspaceRefId
                ? 'alpha'
                : localWorkspaceRefId === summary.beta.workspaceRefId
                    ? 'beta'
                    : null,
        },
    };
}
