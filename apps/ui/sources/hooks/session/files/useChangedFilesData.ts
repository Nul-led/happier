import * as React from 'react';
import {
    combineChangedFilesAttribution,
    type CheckpointOverlapObservation,
    type FileChangeEvidence,
    type RepositoryCheckpointTurnMetadata,
    type SessionChangeAttribution,
    type SessionChangeSet,
    type SessionChangeSetFile,
    type TurnChangeSet,
    type WorkspaceTouchedFileEvidence,
} from '@happier-dev/protocol';

import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import type { SessionAttributedFile } from '@/scm/scmAttribution';
import { snapshotToScmStatusFiles, type ScmFileStatus, type ScmStatusFiles } from '@/scm/scmStatusFiles';
import { deriveSessionWorkingTreeProjection } from '@/sync/domains/session/changes/derivation/deriveSessionWorkingTreeProjection';

import { buildAllRepositoryChangedFiles } from '@/components/sessions/files/filesUtils';

type UseChangedFilesDataInput = {
    sessionId: string;
    scmSnapshot: ScmWorkingSnapshot | null;
    /** Workspace-wide touched paths; a low-confidence fallback, never Session authorship proof. */
    workspaceTouchedPaths: readonly string[];
    searchQuery: string;
    showAllRepositoryFiles: boolean;
    latestTurnChangeSet?: SessionChangeSet | null;
    latestTurnEvidence?: TurnChangeSet | null;
    sessionChangeSet?: SessionChangeSet | null;
    /**
     * Optional performance knob for repository-only surfaces (e.g. SCM sidebar commit list)
     * that never need session attribution. When false, skip attribution work entirely.
     *
     * Defaults to true to preserve existing behavior.
     */
    computeAttribution?: boolean;
};

export type UseChangedFilesDataResult = {
    sessionAttribution: SessionChangeAttribution;
    sessionCheckpointOverlap: CheckpointOverlapObservation;
    showTurnViewToggle: boolean;
    showTurnAgentReportedViewToggle: boolean;
    showTurnCheckpointViewToggle: boolean;
    turnCheckpointMetadata: RepositoryCheckpointTurnMetadata | null;
    showSessionViewToggle: boolean;
    scmStatusFiles: ScmStatusFiles | null;
    changedFilesCount: number;
    shouldShowAllFiles: boolean;
    allRepositoryChangedFiles: ScmFileStatus[];
    turnAttributedFiles: SessionAttributedFile[];
    turnAgentReportedFiles: SessionAttributedFile[];
    turnCheckpointFiles: SessionAttributedFile[];
    turnRepositoryOnlyFiles: ScmFileStatus[];
    sessionAttributedFiles: SessionAttributedFile[];
    repositoryOnlyFiles: ScmFileStatus[];
};

type ScopedProjectionResult = Readonly<{
    attributedFiles: SessionAttributedFile[];
    repositoryOnlyFiles: ScmFileStatus[];
}>;

const EMPTY_SCOPE_RESULT = (allRepositoryChangedFiles: ScmFileStatus[]): ScopedProjectionResult => ({
    attributedFiles: [],
    repositoryOnlyFiles: allRepositoryChangedFiles,
});

function mapEvidenceChangeKindToStatus(kind: FileChangeEvidence['changeKind']): ScmFileStatus['status'] {
    if (kind === 'added') return 'added';
    if (kind === 'deleted') return 'deleted';
    if (kind === 'renamed') return 'renamed';
    if (kind === 'copied') return 'copied';
    return 'modified';
}

function countUnifiedDiffStats(diff: string | null | undefined): Pick<ScmFileStatus, 'linesAdded' | 'linesRemoved'> {
    if (!diff) return { linesAdded: 0, linesRemoved: 0 };
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('+')) {
            linesAdded += 1;
            continue;
        }
        if (line.startsWith('-')) {
            linesRemoved += 1;
        }
    }
    return { linesAdded, linesRemoved };
}

function buildEvidenceFileStatus(file: SessionChangeSetFile): ScmFileStatus {
    const fullPath = file.filePath;
    const segments = fullPath.split('/');
    const fileName = segments[segments.length - 1] || fullPath;
    const filePath = segments.slice(0, -1).join('/');
    const stats = countUnifiedDiffStats(file.unifiedDiff);
    return {
        fileName,
        filePath,
        fullPath,
        status: mapEvidenceChangeKindToStatus(file.changeKind),
        isIncluded: false,
        linesAdded: file.stats?.addedLines ?? stats.linesAdded,
        linesRemoved: file.stats?.removedLines ?? stats.linesRemoved,
        oldPath: file.previousFilePath ?? undefined,
        isBinary: file.binary,
    };
}

function mapScmStatusToChangeKind(file: ScmFileStatus): WorkspaceTouchedFileEvidence['changeKind'] {
    if (file.status === 'added' || file.status === 'untracked') return 'added';
    if (file.status === 'deleted' || file.status === 'renamed' || file.status === 'copied') return file.status;
    return 'modified';
}

function adaptWorkspaceTouchedFiles(
    allRepositoryChangedFiles: readonly ScmFileStatus[],
    workspaceTouchedPaths: readonly string[],
): WorkspaceTouchedFileEvidence[] {
    const touchedPaths = new Set(workspaceTouchedPaths);
    return allRepositoryChangedFiles
        .filter((file) => touchedPaths.has(file.fullPath))
        .map((file) => ({
            filePath: file.fullPath,
            changeKind: mapScmStatusToChangeKind(file),
            ...(file.isBinary === undefined ? {} : { binary: file.isBinary }),
        }));
}

function buildAttributedScope(params: Readonly<{
    allRepositoryChangedFiles: readonly ScmFileStatus[];
    projection: NonNullable<ReturnType<typeof deriveSessionWorkingTreeProjection>>;
    includeUnmatchedEvidence?: boolean;
    changeSet: SessionChangeSet | null;
}>): ScopedProjectionResult {
    const evidenceByPath = new Map<string, FileChangeEvidence[]>();
    for (const turn of params.changeSet?.turns ?? []) {
        for (const evidence of turn.files) {
            const entries = evidenceByPath.get(evidence.filePath);
            if (entries) entries.push(evidence);
            else evidenceByPath.set(evidence.filePath, [evidence]);
        }
    }
    for (const file of params.changeSet?.files ?? []) {
        if (!evidenceByPath.has(file.filePath)) evidenceByPath.set(file.filePath, [file]);
    }
    const qualify = (change: SessionChangeSetFile): Omit<SessionAttributedFile, 'file'> => ({
        turns: change.turns,
        content: { source: change.source, confidence: change.confidence },
        attribution: change.attribution,
        checkpointOverlap: change.checkpointOverlap,
        evidence: evidenceByPath.get(change.filePath) ?? [],
    });
    const filesByPath = new Map(params.allRepositoryChangedFiles.map((file) => [file.fullPath, file] as const));
    const matchedAttributedFiles = params.projection.matchedFiles
        .map((match) => {
            const file = filesByPath.get(match.repositoryPath);
            if (!file) return null;
            return { file, ...qualify(match.sessionChange) };
        })
        .filter((entry): entry is SessionAttributedFile => entry !== null);
    const matchedPaths = new Set(matchedAttributedFiles.map((entry) => entry.file.fullPath));
    const unmatchedAttributedFiles = params.includeUnmatchedEvidence === true
        ? params.projection.unmatchedSessionFiles
            .map((file) => ({
                file: buildEvidenceFileStatus(file),
                ...qualify(file),
            }))
            .filter((entry) => !matchedPaths.has(entry.file.fullPath))
        : [];
    const attributedFiles = [...matchedAttributedFiles, ...unmatchedAttributedFiles];
    const attributedPaths = new Set(attributedFiles.map((entry) => entry.file.fullPath));
    return {
        attributedFiles,
        repositoryOnlyFiles: params.allRepositoryChangedFiles.filter((file) => !attributedPaths.has(file.fullPath)),
    };
}

export function useChangedFilesData(input: UseChangedFilesDataInput): UseChangedFilesDataResult {
    const {
        sessionId,
        scmSnapshot,
        workspaceTouchedPaths,
        searchQuery,
        showAllRepositoryFiles,
        latestTurnChangeSet = null,
        latestTurnEvidence = null,
        sessionChangeSet = null,
        computeAttribution = true,
    } = input;

    const scmStatusFiles = React.useMemo(() => {
        if (!scmSnapshot?.repo.isRepo) {
            return null;
        }
        return snapshotToScmStatusFiles(scmSnapshot);
    }, [scmSnapshot]);

    const changedFilesCount = (scmStatusFiles?.totalIncluded ?? 0) + (scmStatusFiles?.totalPending ?? 0);
    const shouldShowAllFiles = Boolean(searchQuery) || showAllRepositoryFiles || changedFilesCount === 0;

    const allRepositoryChangedFiles = React.useMemo(
        () => buildAllRepositoryChangedFiles(scmStatusFiles),
        [scmStatusFiles]
    );

    const latestTurnEvidenceChangeSet = React.useMemo(() => combineChangedFilesAttribution({
        sessionId,
        turns: latestTurnEvidence ? [latestTurnEvidence] : [],
        canonicalChangeSet: latestTurnChangeSet,
    }), [latestTurnChangeSet, latestTurnEvidence, sessionId]);

    const latestTurnProjection = React.useMemo(() => {
        return deriveSessionWorkingTreeProjection({
            sessionChangeSet: latestTurnEvidenceChangeSet.files.length > 0 ? latestTurnEvidenceChangeSet : null,
            snapshot: scmSnapshot,
        });
    }, [latestTurnEvidenceChangeSet, scmSnapshot]);

    const latestTurnAgentReportedChangeSet = React.useMemo(() => {
        if (!latestTurnEvidence) return null;
        const scoped = combineChangedFilesAttribution({
            sessionId,
            turns: [latestTurnEvidence],
            evidenceScope: 'agent_reported',
        });
        return scoped.files.length > 0 ? scoped : null;
    }, [latestTurnEvidence, sessionId]);

    const latestTurnCheckpointChangeSet = React.useMemo(() => {
        if (!latestTurnEvidence) return null;
        const scoped = combineChangedFilesAttribution({
            sessionId,
            turns: [latestTurnEvidence],
            evidenceScope: 'checkpoint',
        });
        return scoped.files.length > 0 ? scoped : null;
    }, [latestTurnEvidence, sessionId]);

    const latestTurnAgentReportedProjection = React.useMemo(() => {
        return deriveSessionWorkingTreeProjection({
            sessionChangeSet: latestTurnAgentReportedChangeSet,
            snapshot: scmSnapshot,
        });
    }, [latestTurnAgentReportedChangeSet, scmSnapshot]);

    const latestTurnCheckpointProjection = React.useMemo(() => {
        return deriveSessionWorkingTreeProjection({
            sessionChangeSet: latestTurnCheckpointChangeSet,
            snapshot: scmSnapshot,
        });
    }, [latestTurnCheckpointChangeSet, scmSnapshot]);

    const workspaceTouchedFiles = React.useMemo(
        () => adaptWorkspaceTouchedFiles(allRepositoryChangedFiles, workspaceTouchedPaths),
        [allRepositoryChangedFiles, workspaceTouchedPaths],
    );

    const sessionAttributionChangeSet = React.useMemo(() => combineChangedFilesAttribution({
        sessionId,
        canonicalChangeSet: sessionChangeSet,
        workspaceTouchedFiles,
    }), [sessionChangeSet, sessionId, workspaceTouchedFiles]);

    const sessionProjection = React.useMemo(() => {
        return deriveSessionWorkingTreeProjection({
            sessionChangeSet: sessionAttributionChangeSet.files.length > 0 ? sessionAttributionChangeSet : null,
            snapshot: scmSnapshot,
        });
    }, [scmSnapshot, sessionAttributionChangeSet]);

    const turnScope = React.useMemo<ScopedProjectionResult>(() => {
        if (!computeAttribution) {
            return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
        }

        if (latestTurnProjection) {
            return buildAttributedScope({
                allRepositoryChangedFiles,
                projection: latestTurnProjection,
                changeSet: latestTurnEvidenceChangeSet,
                includeUnmatchedEvidence: latestTurnEvidence !== null,
            });
        }

        return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
    }, [allRepositoryChangedFiles, computeAttribution, latestTurnEvidence, latestTurnEvidenceChangeSet, latestTurnProjection]);

    const turnAgentReportedScope = React.useMemo<ScopedProjectionResult>(() => {
        if (!computeAttribution) {
            return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
        }

        if (latestTurnAgentReportedProjection) {
            return buildAttributedScope({
                allRepositoryChangedFiles,
                projection: latestTurnAgentReportedProjection,
                changeSet: latestTurnAgentReportedChangeSet,
                includeUnmatchedEvidence: true,
            });
        }

        return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
    }, [allRepositoryChangedFiles, computeAttribution, latestTurnAgentReportedChangeSet, latestTurnAgentReportedProjection]);

    const turnCheckpointScope = React.useMemo<ScopedProjectionResult>(() => {
        if (!computeAttribution) {
            return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
        }

        if (latestTurnCheckpointProjection) {
            return buildAttributedScope({
                allRepositoryChangedFiles,
                projection: latestTurnCheckpointProjection,
                changeSet: latestTurnCheckpointChangeSet,
                includeUnmatchedEvidence: true,
            });
        }

        return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
    }, [allRepositoryChangedFiles, computeAttribution, latestTurnCheckpointChangeSet, latestTurnCheckpointProjection]);

    const sessionScope = React.useMemo<ScopedProjectionResult>(() => {
        if (!computeAttribution) {
            return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
        }

        if (sessionProjection) {
            return buildAttributedScope({
                allRepositoryChangedFiles,
                projection: sessionProjection,
                changeSet: sessionAttributionChangeSet,
                includeUnmatchedEvidence: true,
            });
        }

        return EMPTY_SCOPE_RESULT(allRepositoryChangedFiles);
    }, [allRepositoryChangedFiles, computeAttribution, sessionAttributionChangeSet, sessionProjection]);

    const showTurnViewToggle = React.useMemo(() => {
        if (!computeAttribution) return false;
        if (latestTurnEvidence?.files.length) return true;
        return turnScope.attributedFiles.length > 0;
    }, [computeAttribution, latestTurnEvidence?.files.length, turnScope.attributedFiles.length]);

    const showTurnAgentReportedViewToggle = React.useMemo(() => {
        if (!computeAttribution) return false;
        if (latestTurnAgentReportedChangeSet?.files.length) return true;
        return turnAgentReportedScope.attributedFiles.length > 0;
    }, [computeAttribution, latestTurnAgentReportedChangeSet?.files.length, turnAgentReportedScope.attributedFiles.length]);

    const showTurnCheckpointViewToggle = React.useMemo(() => {
        if (!computeAttribution) return false;
        return Boolean(latestTurnEvidence?.repositoryCheckpoint)
            || Boolean(latestTurnCheckpointChangeSet?.files.length)
            || turnCheckpointScope.attributedFiles.length > 0;
    }, [
        computeAttribution,
        latestTurnCheckpointChangeSet?.files.length,
        latestTurnEvidence?.repositoryCheckpoint,
        turnCheckpointScope.attributedFiles.length,
    ]);

    const showSessionViewToggle = computeAttribution && sessionScope.attributedFiles.length > 0;
    const sessionAttribution = sessionAttributionChangeSet.confidenceSummary.attribution;
    const sessionCheckpointOverlap = sessionAttributionChangeSet.confidenceSummary.checkpointOverlap;

    return {
        sessionAttribution,
        sessionCheckpointOverlap,
        showTurnViewToggle,
        showTurnAgentReportedViewToggle,
        showTurnCheckpointViewToggle,
        turnCheckpointMetadata: latestTurnEvidence?.repositoryCheckpoint ?? null,
        showSessionViewToggle,
        scmStatusFiles,
        changedFilesCount,
        shouldShowAllFiles,
        allRepositoryChangedFiles,
        turnAttributedFiles: turnScope.attributedFiles,
        turnAgentReportedFiles: turnAgentReportedScope.attributedFiles,
        turnCheckpointFiles: turnCheckpointScope.attributedFiles,
        turnRepositoryOnlyFiles: turnScope.repositoryOnlyFiles,
        sessionAttributedFiles: sessionScope.attributedFiles,
        repositoryOnlyFiles: sessionScope.repositoryOnlyFiles,
    };
}
