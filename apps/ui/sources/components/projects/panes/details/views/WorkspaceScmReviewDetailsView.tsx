import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { ReviewCommentsSessionSurface } from '@/components/reviews/ReviewCommentsSessionSurface';
import { buildWorkspaceChangedFilesData } from '@/hooks/workspaces/scm/buildWorkspaceChangedFilesData';
import { useWorkspaceScmSnapshotController } from '@/hooks/workspaces/scm/useWorkspaceScmSnapshotController';
import { NotSourceControlRepositoryState } from '@/components/workspaces/scm/states/NotSourceControlRepositoryState';
import { SourceControlUnavailableState } from '@/components/workspaces/scm/states/SourceControlUnavailableState';
import { useSetting, useWorkspaceReviewCommentsDrafts, useWorkspaceScmCommitSelectionPatches, useWorkspaceScmCommitSelectionPaths } from '@/sync/domains/state/storage';
import { ChangedFilesReview } from '@/components/workspaces/scm/review/ChangedFilesReview';
import { fetchWorkspaceUnifiedDiffForPath } from '@/scm/diff/fetchWorkspaceUnifiedDiffForPath';
import type { ScmReviewUnifiedDiffFetcher } from '@/components/workspaces/scm/review/scmReviewDiffFetcher';
import { useWorkspaceReviewCommentDraftHandlers } from '@/components/workspaces/files/details/workspaceFileDetails/useWorkspaceReviewCommentDraftHandlers';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { PaneLoadingFallback } from '@/components/ui/panels/PaneLoadingFallback';
import { createPluginPermissionGrantActions } from '@/sync/domains/plugins/permissions/actions';
import { usePluginPermissionGrants } from '@/sync/domains/plugins/permissions/usePluginPermissionGrants';
import { createFrontDoorUiActionExecutor } from '@/sync/ops/actions/frontDoorRuntimeActionExecutor';
import {
    selectPluginPermissionPendingRequests,
} from '@/sync/domains/plugins/permissions/store';
import {
    REVIEW_COMMENTS_DIRECT_WRITE_PERMISSION_CAPABILITY,
    pluginPermissionGrantScopeKey,
    type PluginPermissionGrantListInput,
    type PluginPermissionGrantTargetScope,
} from '@/sync/domains/plugins/permissions/types';
import type { ScmFileStatus } from '@/scm/scmStatusFiles';
import { SCM_COMMIT_STRATEGIES, type ScmCommitStrategy } from '@/scm/settings/commitStrategy';
import { buildCommitSelectionPathHints, isFileSelectedForCommit } from '@/scm/operations/commitSelectionHints';
import { isDirectoryLikeScmFileStatus } from '@/scm/isDirectoryLikeScmFileStatus';
import { WorkspaceScmCommitSelectionToggleButton } from '@/components/projects/scm/WorkspaceScmCommitSelectionToggleButton';
import { activeReviewFileKeyForWorkspace } from '@/components/workspaces/scm/review/activeReviewFile';
import { useLayoutPresentationActive } from '@/components/ui/presentation/PluginSurfaceFocusEligibility';

/** A project's Review is a Details tab too: the shared Review header and its file list first. */
const WORKSPACE_REVIEW_DETAILS_HEADER = Object.freeze({});

export type WorkspaceScmReviewDetailsViewProps = Readonly<{
    scopeId: string;
    workspaceRefId: string;
    workspaceCacheKey: string;
    machineId: string;
    rootPath: string;
    serverId: string;
    onOpenFile?: (path: string) => void;
    onOpenFilePinned?: (path: string) => void;
}>;

export const WorkspaceScmReviewDetailsView = React.memo((props: WorkspaceScmReviewDetailsViewProps) => {
    const { theme } = useUnistyles();
    const scmReviewMaxFilesSetting = useSetting('scmReviewMaxFiles');
    const scmReviewMaxChangedLinesSetting = useSetting('scmReviewMaxChangedLines');
    const scmCommitStrategySetting = useSetting('scmCommitStrategy');
    const scmCommitStrategy: ScmCommitStrategy = React.useMemo(() => {
        if (typeof scmCommitStrategySetting !== 'string') return 'atomic';
        return SCM_COMMIT_STRATEGIES.includes(scmCommitStrategySetting as ScmCommitStrategy)
            ? (scmCommitStrategySetting as ScmCommitStrategy)
            : 'atomic';
    }, [scmCommitStrategySetting]);
    const scope = React.useMemo(() => ({
        serverId: props.serverId,
        machineId: props.machineId,
        rootPath: props.rootPath,
    }), [props.machineId, props.rootPath, props.serverId]);
    const presented = useLayoutPresentationActive();
    const activeReviewFileKey = activeReviewFileKeyForWorkspace(scope);
    const activeReviewFile = React.useMemo(
        () => ({ key: activeReviewFileKey, presented }),
        [activeReviewFileKey, presented],
    );
    const reviewCommentsEnabled = useFeatureEnabled('files.reviewComments') === true;
    const scmWriteEnabled = useFeatureEnabled('scm.writeOperations') === true;
    const reviewCommentDrafts = useWorkspaceReviewCommentsDrafts(scope);
    const reviewDraftHandlers = useWorkspaceReviewCommentDraftHandlers(scope);
    const frontDoorActionExecutor = React.useMemo(() => createFrontDoorUiActionExecutor(), []);
    const pluginPermissionGrantActions = React.useMemo(
        () => createPluginPermissionGrantActions({ execute: frontDoorActionExecutor }),
        [frontDoorActionExecutor],
    );
    const { snapshot, loading, error, refresh } = useWorkspaceScmSnapshotController(scope);
    const commitSelectionPaths = useWorkspaceScmCommitSelectionPaths(scope);
    const commitSelectionPatches = useWorkspaceScmCommitSelectionPatches(scope);
    const directWriteGrantScope = React.useMemo<PluginPermissionGrantTargetScope>(() => ({
        kind: 'project',
        projectId: props.workspaceRefId,
    }), [props.workspaceRefId]);
    const pluginPermissionGrantListInput = React.useMemo<PluginPermissionGrantListInput>(() => ({
        capability: REVIEW_COMMENTS_DIRECT_WRITE_PERMISSION_CAPABILITY,
        targetScope: directWriteGrantScope,
    }), [directWriteGrantScope]);
    const pluginPermissionGrants = usePluginPermissionGrants({
        actions: pluginPermissionGrantActions,
        enabled: reviewCommentsEnabled,
        listInput: pluginPermissionGrantListInput,
    });
    const directWriteGrants = pluginPermissionGrants.state.grantIds
        .map((id) => pluginPermissionGrants.state.grantsById[id])
        .filter((grant): grant is NonNullable<typeof grant> => (
            Boolean(grant)
            && grant?.capability === REVIEW_COMMENTS_DIRECT_WRITE_PERMISSION_CAPABILITY
            && pluginPermissionGrantScopeKey(grant.targetScope) === pluginPermissionGrantScopeKey(directWriteGrantScope)
        ));
    const pendingDirectWriteGrantRequests = selectPluginPermissionPendingRequests(pluginPermissionGrants.state, {
        capability: REVIEW_COMMENTS_DIRECT_WRITE_PERMISSION_CAPABILITY,
        targetScope: directWriteGrantScope,
    });

    const maxFiles = React.useMemo(() => {
        const raw = typeof scmReviewMaxFilesSetting === 'number' && Number.isFinite(scmReviewMaxFilesSetting)
            ? scmReviewMaxFilesSetting
            : 25;
        return Math.max(1, Math.floor(raw));
    }, [scmReviewMaxFilesSetting]);
    const maxChangedLines = React.useMemo(() => {
        const raw = typeof scmReviewMaxChangedLinesSetting === 'number' && Number.isFinite(scmReviewMaxChangedLinesSetting)
            ? scmReviewMaxChangedLinesSetting
            : 2000;
        return Math.max(1, Math.floor(raw));
    }, [scmReviewMaxChangedLinesSetting]);
    const changedFiles = React.useMemo(() => buildWorkspaceChangedFilesData({ scmSnapshot: snapshot }), [snapshot]);
    const fetchUnifiedDiffForPath = React.useCallback<ScmReviewUnifiedDiffFetcher>(async (input) => {
        return await fetchWorkspaceUnifiedDiffForPath({
            scope,
            ...input,
        });
    }, [scope]);
    const atomicSelectionPathSet = React.useMemo(() => new Set(buildCommitSelectionPathHints({
        commitSelectionPaths,
        commitSelectionPatches,
    })), [commitSelectionPatches, commitSelectionPaths]);
    const renderReviewFileActions = React.useMemo(() => {
        if (!scmWriteEnabled) return undefined;
        return (file: ScmFileStatus) => {
            if (isDirectoryLikeScmFileStatus(file)) return null;
            const selectedForCommit = isFileSelectedForCommit({
                commitStrategy: scmCommitStrategy,
                file,
                atomicSelectionPaths: atomicSelectionPathSet,
            });
            const capability = selectedForCommit
                ? snapshot?.capabilities?.writeExclude
                : snapshot?.capabilities?.writeInclude;
            const actionSupported = scmCommitStrategy === 'atomic'
                ? snapshot?.capabilities?.writeCommit === true
                : capability === true;
            if (!actionSupported) return null;
            return (
                <WorkspaceScmCommitSelectionToggleButton
                    scope={scope}
                    snapshot={snapshot ?? null}
                    scmWriteEnabled={scmWriteEnabled}
                    commitStrategy={scmCommitStrategy}
                    file={file}
                    selectedForCommit={selectedForCommit}
                    onAfterToggle={refresh}
                />
            );
        };
    }, [
        atomicSelectionPathSet,
        refresh,
        scmCommitStrategy,
        scmWriteEnabled,
        scope,
        snapshot,
    ]);

    if (loading && !snapshot) {
        return <PaneLoadingFallback />;
    }

    if (error) {
        return (
            <SourceControlUnavailableState
                details={error.message}
                errorCode={error.errorCode}
                onRetry={() => {
                    void refresh();
                }}
            />
        );
    }

    if (snapshot?.repo.isRepo === false) {
        return <NotSourceControlRepositoryState />;
    }

    return (
        <View style={{ flex: 1, minHeight: 0, minWidth: 0, backgroundColor: theme.colors.surface.base }}>
            {reviewCommentsEnabled ? (
                <ReviewCommentsSessionSurface
                    workspaceId={props.workspaceRefId}
                    workspace={{ machineId: props.machineId, path: props.rootPath }}
                    execute={frontDoorActionExecutor}
                    directWriteGrants={directWriteGrants}
                    pendingDirectWriteGrantRequests={pendingDirectWriteGrantRequests}
                    onGrantDirectWrite={pluginPermissionGrants.grant}
                    onCancelDirectWriteGrant={pluginPermissionGrants.dismissRequest}
                    onRevokeDirectWrite={pluginPermissionGrants.revoke}
                    permissionGrantStatus={pluginPermissionGrants.state.status}
                    permissionGrantError={pluginPermissionGrants.state.error}
                    onRefreshPermissionGrants={() => { void pluginPermissionGrants.refresh(); }}
                    defaultPanelOpen={false}
                    testID="workspace-review-comments"
                />
            ) : null}
            <ChangedFilesReview
                activeReviewFile={activeReviewFile}
                detailsHeader={WORKSPACE_REVIEW_DETAILS_HEADER}
                theme={theme}
                sessionId={props.scopeId}
                snapshot={snapshot ?? null}
                changedFilesViewMode="repository"

                allRepositoryChangedFiles={changedFiles.allRepositoryChangedFiles}
                turnAttributedFiles={[]}
                turnRepositoryOnlyFiles={[]}
                sessionAttributedFiles={[]}
                repositoryOnlyFiles={changedFiles.allRepositoryChangedFiles}

                maxFiles={maxFiles}
                maxChangedLines={maxChangedLines}
                onFilePress={(file) => props.onOpenFile?.(file.fullPath)}
                onFilePressPinned={(file) => props.onOpenFilePinned?.(file.fullPath)}
                renderFileActions={renderReviewFileActions}
                rowDensity="compact"
                reviewCommentsEnabled={reviewCommentsEnabled}
                reviewCommentDrafts={reviewCommentDrafts}
                onUpsertReviewCommentDraft={reviewDraftHandlers.onUpsertReviewCommentDraft}
                onDeleteReviewCommentDraft={reviewDraftHandlers.onDeleteReviewCommentDraft}
                onReviewCommentError={reviewDraftHandlers.onReviewCommentError}
                workspaceScope={scope}
                fetchUnifiedDiffForPath={fetchUnifiedDiffForPath}
            />
        </View>
    );
});
