import { describe, expect, it } from 'vitest';

import {
    getDefaultChangedFilesViewMode,
    getPreferredChangedFilesViewMode,
    getSelectableChangedFilesViewModes,
    isChangedFilesViewModeAvailable,
    resolveChangedFilesViewMode,
    resolveChangedFilesEmptyStateTranslationKey,
    partitionRepositoryChangesBySession,
    type SessionAttributedFile,
} from './scmAttribution';
import type { ScmFileStatus } from './scmStatusFiles';

describe('changed files view mode availability', () => {
    it('uses one empty-state copy projection for every mounted host', () => {
        expect(resolveChangedFilesEmptyStateTranslationKey('turn')).toBe('files.noLatestTurnChanges');
        expect(resolveChangedFilesEmptyStateTranslationKey('turn_agent_reported')).toBe('files.noAgentReportedTurnChanges');
        expect(resolveChangedFilesEmptyStateTranslationKey('turn_checkpoint')).toBe('files.noCheckpointTurnChanges');
        expect(resolveChangedFilesEmptyStateTranslationKey('session')).toBe('files.noSessionAttributedChanges');
        expect(resolveChangedFilesEmptyStateTranslationKey('repository')).toBe('files.noChanges');
    });
    it('uses repository view as the default changed-files mode', () => {
        expect(getDefaultChangedFilesViewMode()).toBe('repository');
    });
    it('offers selected-for-commit as an explicit scope only when files are selected', () => {
        expect(getSelectableChangedFilesViewModes({
            showTurnViewToggle: false,
            showSessionViewToggle: false,
            showSelectedViewToggle: true,
        })).toEqual(['repository', 'selected']);

        expect(resolveChangedFilesViewMode({
            mode: 'selected',
            showTurnViewToggle: false,
            showSessionViewToggle: false,
            showSelectedViewToggle: true,
        })).toBe('selected');

        expect(resolveChangedFilesViewMode({
            mode: 'selected',
            showTurnViewToggle: true,
            showSessionViewToggle: false,
            showSelectedViewToggle: false,
        })).toBe('turn');
    });

    it('prefers the most specific available mode before repository mode', () => {
        expect(getPreferredChangedFilesViewMode({
            showTurnViewToggle: true,
            showSessionViewToggle: true,
        })).toBe('turn');

        expect(getPreferredChangedFilesViewMode({
            showTurnViewToggle: false,
            showSessionViewToggle: true,
        })).toBe('session');

        expect(getPreferredChangedFilesViewMode({
            showTurnViewToggle: false,
            showSessionViewToggle: false,
        })).toBe('repository');
    });

    it('falls back when the selected mode is no longer available', () => {
        expect(resolveChangedFilesViewMode({
            mode: 'turn',
            showTurnViewToggle: false,
            showSessionViewToggle: true,
        })).toBe('session');

        expect(resolveChangedFilesViewMode({
            mode: 'session',
            showTurnViewToggle: false,
            showSessionViewToggle: false,
        })).toBe('repository');
    });

    it('lists selectable modes only when an attributed view can be shown', () => {
        expect(getSelectableChangedFilesViewModes({
            showTurnViewToggle: false,
            showSessionViewToggle: false,
        })).toEqual([]);

        expect(getSelectableChangedFilesViewModes({
            showTurnViewToggle: true,
            showSessionViewToggle: false,
        })).toEqual(['repository', 'turn']);
    });

    it('keeps source evidence out of ordinary modes while preserving existing navigation', () => {
        expect(getPreferredChangedFilesViewMode({
            showTurnViewToggle: true,
            showTurnAgentReportedViewToggle: true,
            showTurnCheckpointViewToggle: true,
            showSessionViewToggle: true,
        })).toBe('turn');

        expect(resolveChangedFilesViewMode({
            mode: 'turn_checkpoint',
            showTurnViewToggle: true,
            showTurnAgentReportedViewToggle: true,
            showTurnCheckpointViewToggle: false,
            showSessionViewToggle: true,
        })).toBe('turn');
    });

    it('resolves and offers the same modes so a resolved scope is always selectable', () => {
        const availability = {
            showTurnViewToggle: true,
            showTurnAgentReportedViewToggle: true,
            showTurnCheckpointViewToggle: true,
            showSessionViewToggle: true,
            showSelectedViewToggle: true,
        };
        const selectable = getSelectableChangedFilesViewModes(availability);

        for (const mode of ['repository', 'selected', 'turn', 'turn_agent_reported', 'turn_checkpoint', 'session'] as const) {
            expect({ mode, selectable: selectable.includes(mode) }).toEqual({
                mode,
                selectable: isChangedFilesViewModeAvailable({ ...availability, mode }),
            });
            expect(resolveChangedFilesViewMode({ ...availability, mode })).toBe(
                selectable.includes(mode) ? mode : getPreferredChangedFilesViewMode(availability)
            );
        }
    });
});

// Session-tabs lab G1: the Git pane groups the repository's changes into the ones this Session made
// (its attributed change set) and the rest of the repository, session first.
describe('partitionRepositoryChangesBySession', () => {
    const file = (fullPath: string): ScmFileStatus => ({
        fileName: fullPath.split('/').pop() ?? fullPath,
        filePath: fullPath.split('/').slice(0, -1).join('/'),
        fullPath,
        status: 'modified',
        isIncluded: false,
        linesAdded: 1,
        linesRemoved: 0,
    });
    const attributed = (entry: ScmFileStatus): SessionAttributedFile => ({
        file: entry,
        turns: ['t1'],
        content: { source: 'provider_native', confidence: 'exact' },
        attribution: { confidence: 'exact', reason: 'provider_correlated' },
        checkpointOverlap: 'unknown',
        evidence: [],
    } as unknown as SessionAttributedFile);

    it('puts the session change set first, in repository order, and the rest of the repository after it', () => {
        const repository = [file('AGENTS.md'), file('apps/ui/b.tsx'), file('apps/ui/a.tsx'), file('docs/c.md')];
        const result = partitionRepositoryChangesBySession(repository, [
            attributed(file('apps/ui/a.tsx')),
            attributed(file('apps/ui/b.tsx')),
        ]);

        expect(result.session.map((entry) => entry.fullPath)).toEqual(['apps/ui/b.tsx', 'apps/ui/a.tsx']);
        expect(result.elsewhere.map((entry) => entry.fullPath)).toEqual(['AGENTS.md', 'docs/c.md']);
        // The rows are the repository's current rows (what can be selected and committed), not the evidence copies.
        expect(result.session[0]).toBe(repository[1]);
    });

    it('leaves out attributed paths that are no longer changed in the repository', () => {
        const repository = [file('docs/c.md')];
        const result = partitionRepositoryChangesBySession(repository, [attributed(file('apps/ui/gone.tsx'))]);

        expect(result.session).toEqual([]);
        expect(result.elsewhere.map((entry) => entry.fullPath)).toEqual(['docs/c.md']);
    });
});
