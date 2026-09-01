import type { DetailsTab } from '@/components/appShell/panes/details/workspace/detailsWorkspaceTypes';
import type { WorkspaceSyncRelationshipSummary } from '@/sync/domains/sessionHandoff/workspaceSyncRelationshipModel';
import { formatWorkspaceSyncRelationshipTitle } from '@/sync/domains/sessionHandoff/workspaceSyncPresentation';

import { createWorkspaceSyncConflictDetailsTab } from './workspaceSyncConflictDetailsTab';

/**
 * General relationship destination backed by the existing workspace-sync
 * details resource, renderer, and tab identity. A routine row gets a
 * mode-aware title without creating a parallel pane for the same relationship.
 */
export function createWorkspaceSyncRelationshipDetailsTab(
    summary: WorkspaceSyncRelationshipSummary,
    localWorkspaceRefId?: string | null,
): DetailsTab {
    return {
        ...createWorkspaceSyncConflictDetailsTab(summary, localWorkspaceRefId),
        title: formatWorkspaceSyncRelationshipTitle({
            alphaLabel: summary.alpha.label,
            betaLabel: summary.beta.label,
            mode: summary.relationship.mode,
        }),
    };
}
