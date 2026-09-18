import * as React from 'react';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { buildNewSessionLaunchRouteParams } from '@/components/sessions/new/navigation/newSessionRouteParams';
import { resolveNewSessionDraftRouteIdentity } from '@/components/sessions/new/navigation/newSessionDraftRouteIdentity';
import { useWorkspaceFilePaneNavigation } from '@/components/workspaces/files/useWorkspaceFilePaneNavigation';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import { t } from '@/text';
import { deferOnWeb } from '@/utils/platform/deferOnWeb';
import { useProjectRouteRouterRef } from './useProjectRouteRouterRef';
import { createProjectCommitDetailsTab, createProjectFileDetailsTab } from './projectDetailsTabBuilders';

export function useProjectSurfaceActions(params: Readonly<{
    scopeId: string;
    workspaceRef: WorkspaceRefV1;
    activeRootPath: string;
    onRevealInFilesTreeNavigate?: () => void;
    onOpenChangesNavigate?: () => void;
}>) {
    const pane = useAppPaneScope(params.scopeId);
    const routerRef = useProjectRouteRouterRef();

    const openFileInDetails = React.useCallback((fullPath: string) => {
        deferOnWeb(() => {
            pane.openDetailsTab(createProjectFileDetailsTab(fullPath));
        });
    }, [pane]);

    const openFileInDetailsPinned = React.useCallback((fullPath: string) => {
        deferOnWeb(() => {
            pane.openDetailsTab(createProjectFileDetailsTab(fullPath), { intent: 'pinned' });
        });
    }, [pane]);

    const openReviewAllChanges = React.useCallback(() => {
        deferOnWeb(() => {
            pane.openDetailsTab(
                {
                    key: 'scmReview:working',
                    kind: 'scmReview',
                    title: t('files.toolbar.review'),
                    resource: { kind: 'scmReview', scope: 'working' },
                },
                { intent: 'pinned' },
            );
        });
    }, [pane]);

    const openStashDetails = React.useCallback(() => {
        deferOnWeb(() => {
            pane.openDetailsTab(
                {
                    key: 'scmStash',
                    kind: 'scmStash',
                    title: t('files.stash.detailsTitle'),
                    resource: { kind: 'scmStash' },
                },
                { intent: 'pinned' },
            );
        });
    }, [pane]);

    const openCreateWorktreeFlow = React.useCallback(() => {
        const draftId = resolveNewSessionDraftRouteIdentity({ routeDraftId: undefined }).draftId;
        routerRef.current.push({
            pathname: '/new',
            params: buildNewSessionLaunchRouteParams({
                draftId,
                machineId: params.workspaceRef.machineId,
                directory: params.activeRootPath,
                worktree: 'new',
                targetServerId: params.workspaceRef.serverId,
            }),
        });
    }, [params.activeRootPath, params.workspaceRef.machineId, params.workspaceRef.serverId, routerRef]);

    const openCommitInDetails = React.useCallback((sha: string) => {
        const tab = createProjectCommitDetailsTab(sha);
        if (!tab) return;
        deferOnWeb(() => {
            pane.openDetailsTab(tab);
        });
    }, [pane]);

    const navigateFilesPane = React.useCallback((tabId: 'files' | 'git') => {
        if (tabId === 'files') params.onRevealInFilesTreeNavigate?.();
        else params.onOpenChangesNavigate?.();
    }, [params.onRevealInFilesTreeNavigate, params.onOpenChangesNavigate]);
    const { revealInFilesTree, openChanges } = useWorkspaceFilePaneNavigation(params.scopeId, navigateFilesPane);

    return {
        openFileInDetails,
        openFileInDetailsPinned,
        openReviewAllChanges,
        openStashDetails,
        openCreateWorktreeFlow,
        openCommitInDetails,
        revealInFilesTree,
        openChanges,
    };
}
