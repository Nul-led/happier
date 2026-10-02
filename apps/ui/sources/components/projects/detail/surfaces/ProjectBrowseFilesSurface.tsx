import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import * as React from 'react';

import { resolveOpenDetailsFilePath } from '@/components/workspaces/files/resolveOpenDetailsFilePath';

import { WorkspaceRepositoryTreeBrowserView } from '@/components/projects/files/WorkspaceRepositoryTreeBrowserView';
import type { WorkspaceScopeBase } from '@/sync/domains/workspaces/workspaceScope';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import { buildProjectRouteHref } from '../projectRouteState';

export const ProjectBrowseFilesSurface = React.memo((props: Readonly<{
    scopeId: string;
    scope: WorkspaceScopeBase;
    workspaceRef: WorkspaceRefV1;
    activeWorktreeId?: string | null;
    onOpenFile: (fullPath: string) => void;
    onOpenFilePinned: (fullPath: string) => void;
}>) => {
    const pane = useAppPaneScope(props.scopeId);
    const fileHref = React.useCallback((path: string) => buildProjectRouteHref({
        workspaceRefId: props.workspaceRef.id, segment: 'details', activeRootPath: props.scope.rootPath,
        defaultRootPath: props.workspaceRef.rootPath, activeWorktreeId: props.activeWorktreeId,
        sourceSurface: 'browse', initialResource: { kind: 'file', path },
    }), [props.activeWorktreeId, props.scope.rootPath, props.workspaceRef.id, props.workspaceRef.rootPath]);
    const files = pane.scopeState?.right.tabState.files as { revealRequest?: Readonly<{ path: string }> } | undefined;
    // The row of the file open in Details stays selected while its tab is open (lab F1).
    const selectedPath = resolveOpenDetailsFilePath(pane.scopeState?.details);
    return (
        <WorkspaceRepositoryTreeBrowserView
            fileHref={fileHref}
            scope={props.scope}
            onOpenFile={props.onOpenFile}
            onOpenFilePinned={props.onOpenFilePinned}
            revealRequest={files?.revealRequest}
            selectedPath={selectedPath}
            density="panel"
        />
    );
});
