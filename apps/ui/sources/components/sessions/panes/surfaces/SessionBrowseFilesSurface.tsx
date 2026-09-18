import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import * as React from 'react';

import { SessionRepositoryTreeBrowserView } from '@/components/sessions/files/views/SessionRepositoryTreeBrowserView';

export const SessionBrowseFilesSurface = React.memo((props: Readonly<{
    scopeId: string;
    sessionId: string;
    serverId?: string | null;
    onOpenFile: (fullPath: string) => void;
    onOpenFilePinned: (fullPath: string) => void;
}>) => {
    const pane = useAppPaneScope(props.scopeId);
    const files = pane.scopeState?.right.tabState.files as { revealRequest?: Readonly<{ path: string }> } | undefined;
    return (
        <SessionRepositoryTreeBrowserView
            sessionId={props.sessionId}
            serverId={props.serverId}
            onOpenFile={props.onOpenFile}
            onOpenFilePinned={props.onOpenFilePinned}
            revealRequest={files?.revealRequest}
            density="panel"
        />
    );
});
