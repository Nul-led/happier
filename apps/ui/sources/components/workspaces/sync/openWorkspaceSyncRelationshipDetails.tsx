import * as React from 'react';

import type { CustomModalInjectedProps } from '@/modal';
import { Modal } from '@/modal';
import { t } from '@/text';
import type { WorkspaceSyncRelationshipSummary } from '@/sync/domains/sessionHandoff/workspaceSyncRelationshipModel';

import {
    readWorkspaceSyncConflictDetailsResource,
    WorkspaceSyncConflictDetailsView,
} from './WorkspaceSyncConflictDetailsView';
import { createWorkspaceSyncRelationshipDetailsTab } from './workspaceSyncRelationshipDetailsTab';
import { formatWorkspaceSyncRelationshipTitle } from '@/sync/domains/sessionHandoff/workspaceSyncPresentation';

type WorkspaceSyncRelationshipDetailsModalProps = CustomModalInjectedProps & Readonly<{
    summary: WorkspaceSyncRelationshipSummary;
    localWorkspaceRefId?: string | null;
}>;

function WorkspaceSyncRelationshipDetailsModal(props: WorkspaceSyncRelationshipDetailsModalProps) {
    const resource = React.useMemo(() => readWorkspaceSyncConflictDetailsResource(
        createWorkspaceSyncRelationshipDetailsTab(props.summary, props.localWorkspaceRefId).resource,
    ), [props.localWorkspaceRefId, props.summary]);

    return resource ? <WorkspaceSyncConflictDetailsView resource={resource} /> : null;
}

/**
 * Modal-only adapter for surfaces that do not own a details pane. The existing
 * workspace-sync resource builder, renderer, stores, and operations remain the
 * single relationship detail owner.
 */
export function openWorkspaceSyncRelationshipDetails(
    summary: WorkspaceSyncRelationshipSummary,
    localWorkspaceRefId?: string | null,
): void {
    Modal.show({
        component: WorkspaceSyncRelationshipDetailsModal,
        props: { summary, localWorkspaceRefId },
        accessibilityLabel: t('workspaceSync.title'),
        closeOnBackdrop: true,
        chrome: {
            kind: 'card',
            title: formatWorkspaceSyncRelationshipTitle({
                alphaLabel: summary.alpha.label,
                betaLabel: summary.beta.label,
                mode: summary.relationship.mode,
            }),
            subtitle: t('workspaceSync.title'),
            // The details view owns its responsive scroll surface. A second modal
            // scroller traps narrow/large-text content and can strand actions.
            bodyScroll: 'none',
            testID: 'workspace-sync-relationship-details-modal',
            dimensions: { size: 'md', width: 640, maxHeightRatio: 0.92 },
        },
    });
}
