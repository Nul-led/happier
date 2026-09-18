import { describe, expect, it } from 'vitest';

import {
    getDefaultChangedFilesViewMode,
    getPreferredChangedFilesViewMode,
    getSelectableChangedFilesViewModes,
    isChangedFilesViewModeAvailable,
    resolveChangedFilesViewMode,
} from './scmAttribution';

describe('changed files view mode availability', () => {
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
