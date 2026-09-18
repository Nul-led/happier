import {
    type SessionChangeAttribution,
    type CheckpointOverlapObservation,
    type FileChangeEvidence,
} from '@happier-dev/protocol';

import type { ScmFileStatus } from './scmStatusFiles';
import { isDirectoryLikeScmFileStatus } from './isDirectoryLikeScmFileStatus';

export type ChangedFilesViewMode =
    | 'repository'
    | 'selected'
    | 'turn'
    | 'turn_agent_reported'
    | 'turn_checkpoint'
    | 'session';
export type ChangedFilesPresentation = 'list' | 'review';

export type SessionAttributedFile = {
    file: ScmFileStatus;
    /** Internal aggregate lineage retained with the evidence projection; never rendered as user copy. */
    turns: readonly string[];
    content: Pick<FileChangeEvidence, 'source' | 'confidence'>;
    attribution: SessionChangeAttribution;
    checkpointOverlap: CheckpointOverlapObservation;
    evidence: readonly FileChangeEvidence[];
};

/** Shared lossless presentation adapter used by every mounted attributed-file surface. */
export function filterPresentableSessionAttributedFiles(
    files: readonly SessionAttributedFile[],
): SessionAttributedFile[] {
    return files.filter((entry) => Boolean(entry?.file) && !isDirectoryLikeScmFileStatus(entry.file));
}

/**
 * Which Changed Files scopes the current evidence can back. One predicate
 * (`isChangedFilesViewModeAvailable`) decides this for every consumer, so the offered scopes and
 * the resolved scope can never disagree.
 */
export type ChangedFilesViewModeAvailability = {
    showTurnViewToggle: boolean;
    showTurnAgentReportedViewToggle?: boolean;
    showTurnCheckpointViewToggle?: boolean;
    showSessionViewToggle: boolean;
    showSelectedViewToggle?: boolean;
};

/** Presentation order of the scopes a host may offer. */
const ORDERED_CHANGED_FILES_VIEW_MODES: readonly ChangedFilesViewMode[] = [
    'repository',
    'selected',
    'turn',
    'turn_agent_reported',
    'turn_checkpoint',
    'session',
];

export function getDefaultChangedFilesViewMode(): ChangedFilesViewMode {
    return 'repository';
}

export function getPreferredChangedFilesViewMode(input: ChangedFilesViewModeAvailability): ChangedFilesViewMode {
    if (input.showTurnViewToggle) return 'turn';
    if (input.showSessionViewToggle) return 'session';
    return getDefaultChangedFilesViewMode();
}

export function isChangedFilesViewModeAvailable(input: ChangedFilesViewModeAvailability & {
    mode: ChangedFilesViewMode;
}): boolean {
    if (input.mode === 'repository') return true;
    if (input.mode === 'selected') return input.showSelectedViewToggle === true;
    if (input.mode === 'turn') return input.showTurnViewToggle;
    if (input.mode === 'turn_agent_reported') return input.showTurnAgentReportedViewToggle === true;
    if (input.mode === 'turn_checkpoint') return input.showTurnCheckpointViewToggle === true;
    return input.showSessionViewToggle;
}

export function resolveChangedFilesViewMode(input: ChangedFilesViewModeAvailability & {
    mode: ChangedFilesViewMode;
}): ChangedFilesViewMode {
    if (isChangedFilesViewModeAvailable(input)) return input.mode;
    return getPreferredChangedFilesViewMode(input);
}

/**
 * Derived from the availability predicate rather than a second list, so a host can never resolve a
 * scope its selector refuses to offer. A lone repository scope is not a choice, so nothing is
 * offered.
 */
export function getSelectableChangedFilesViewModes(input: ChangedFilesViewModeAvailability): ChangedFilesViewMode[] {
    const modes = ORDERED_CHANGED_FILES_VIEW_MODES.filter((mode) => isChangedFilesViewModeAvailable({ ...input, mode }));
    return modes.length > 1 ? modes : [];
}
