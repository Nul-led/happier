import { useSessionFilePaneNavigation } from '@/components/sessions/panes/useSessionFileDetailsOpener';
import type { ReviewCommentAnchor, ReviewCommentSource } from '@/sync/domains/input/reviewComments/reviewCommentTypes';
import {
    WorkspaceFileDetailsView,
    type WorkspaceFileOpenableContentViewerHost,
} from '@/components/workspaces/files/details/WorkspaceFileDetailsView';

import { useWorkspaceScopeForSession } from '@/sync/domains/session/resolveWorkspaceScopeForSession';

export type SessionFileDeepLinkAnchor = Readonly<{
    source: ReviewCommentSource;
    anchor: ReviewCommentAnchor;
}>;

export type SessionFileDetailsViewProps = Readonly<{
    sessionId: string;
    serverId?: string | null;
    scopeId: string;
    filePath: string;
    deepLinkAnchor?: SessionFileDeepLinkAnchor | null;
    presentation?: 'screen' | 'panel';
    onStartEditingFile?: () => void;
    openableContentViewer?: WorkspaceFileOpenableContentViewerHost;
}>;

export function SessionFileDetailsView(props: SessionFileDetailsViewProps) {
    const sessionId = props.sessionId;
    const scope = useWorkspaceScopeForSession(sessionId, props.serverId);
    const navigation = useSessionFilePaneNavigation({ scopeId: props.scopeId, sessionId, serverId: scope?.serverId ?? props.serverId });

    return (
        <WorkspaceFileDetailsView
            onRevealInFilesTree={navigation.revealInFilesTree}
            onOpenChanges={navigation.openChanges}
            scopeId={props.scopeId}
            scope={scope}
            filePath={props.filePath}
            deepLinkAnchor={props.deepLinkAnchor ?? null}
            presentation={props.presentation}
            sessionIdForAugmentation={sessionId}
            onStartEditingFile={props.onStartEditingFile}
            openableContentViewer={props.openableContentViewer}
        />
    );
}
