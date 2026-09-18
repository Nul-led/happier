import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import * as React from 'react';

import { WorkspaceRepositoryTreeBrowserView } from '@/components/projects/files/WorkspaceRepositoryTreeBrowserView';
import type { WorkspaceScopeBase } from '@/sync/domains/workspaces/workspaceScope';

export const ProjectBrowseFilesSurface = React.memo((props: Readonly<{
    scopeId: string;
    scope: WorkspaceScopeBase;
    onOpenFile: (fullPath: string) => void;
    onOpenFilePinned: (fullPath: string) => void;
}>) => {
    const pane = useAppPaneScope(props.scopeId);
    const files = pane.scopeState?.right.tabState.files as { revealRequest?: Readonly<{ path: string }> } | undefined;
    return (
        <WorkspaceRepositoryTreeBrowserView
            scope={props.scope}
            onOpenFile={props.onOpenFile}
            onOpenFilePinned={props.onOpenFilePinned}
            revealRequest={files?.revealRequest}
            density="panel"
        />
    );
});
