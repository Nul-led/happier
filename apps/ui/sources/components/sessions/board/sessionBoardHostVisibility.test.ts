import { describe, expect, it } from 'vitest';

import {
    resolveSessionBoardItemPrimaryMountHost,
    resolveSessionBoardHostVisibility,
    type SessionBoardHostVisibilityFacts,
} from './sessionBoardHostVisibility';

function facts(overrides: Partial<SessionBoardHostVisibilityFacts> = {}): SessionBoardHostVisibilityFacts {
    return {
        foreground: true,
        panes: { detailsOpen: false, detailsFocusModeActive: false, rightOpen: false, rightActiveTabId: null },
        companionPlacement: { kind: 'hidden' },
        mobileSurface: null,
        ...overrides,
    };
}

describe('resolveSessionBoardHostVisibility', () => {
    it('gathers every candidate host the incumbent owners currently render', () => {
        expect(resolveSessionBoardHostVisibility(facts({
            panes: { detailsOpen: true, detailsFocusModeActive: false, rightOpen: true, rightActiveTabId: 'board' },
            companionPlacement: { kind: 'reserved_rail', edge: 'trailing', widthPx: 280 },
        })).visibleHosts).toEqual(['details', 'sidebar', 'companion']);
    });

    it('does not count Details while it is open on something other than the Board', () => {
        // An open Details pane showing a file mounts no Board. Counting it would
        // outrank the sidebar, leaving the executable item running nowhere while
        // the sidebar shows an inert "Open in Details" preview.
        const resolved = resolveSessionBoardHostVisibility(facts({
            panes: {
                detailsOpen: true,
                detailsShowsBoard: false,
                detailsFocusModeActive: false,
                rightOpen: true,
                rightActiveTabId: 'board',
            },
        }));

        expect(resolved.visibleHosts).toEqual(['sidebar']);
        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility: resolved,
            itemVisibleInCompanion: false,
        })).toBe('sidebar');
    });

    it('does not count the sidebar while another right tab is active', () => {
        expect(resolveSessionBoardHostVisibility(facts({
            panes: { detailsOpen: false, detailsFocusModeActive: false, rightOpen: true, rightActiveTabId: 'git' },
        })).visibleHosts).toEqual([]);
    });

    it('counts the Companion only where it actually renders content', () => {
        expect(resolveSessionBoardHostVisibility(facts({
            companionPlacement: { kind: 'collapsed_control', edge: 'trailing', reason: 'geometry' },
        })).visibleHosts).toEqual([]);
        expect(resolveSessionBoardHostVisibility(facts({
            companionPlacement: { kind: 'mobile_control' },
        })).visibleHosts).toEqual([]);
        expect(resolveSessionBoardHostVisibility(facts({ mobileSurface: 'companion' })).visibleHosts)
            .toEqual(['companion']);
        expect(resolveSessionBoardHostVisibility(facts({ mobileSurface: 'board' })).visibleHosts)
            .toEqual(['mobileCockpit']);
    });

    it.each([
        ['board', 'mobileCockpit'],
        ['companion', 'companion'],
    ] as const)('masks retained desktop pane candidates while the mobile %s surface is active', (mobileSurface, expectedHost) => {
        const resolved = resolveSessionBoardHostVisibility(facts({
            panes: {
                detailsOpen: true,
                detailsShowsBoard: true,
                detailsFocusModeActive: true,
                rightOpen: true,
                rightActiveTabId: 'board',
            },
            companionPlacement: { kind: 'reserved_rail', edge: 'trailing', widthPx: 280 },
            mobileSurface,
        }));

        expect(resolved.visibleHosts).toEqual([expectedHost]);
        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility: resolved,
            itemVisibleInCompanion: true,
        })).toBe(expectedHost);
    });

    it('restores retained desktop candidates when the exclusive mobile surface leaves', () => {
        const retainedDesktopFacts = facts({
            panes: {
                detailsOpen: true,
                detailsShowsBoard: true,
                detailsFocusModeActive: false,
                rightOpen: true,
                rightActiveTabId: 'board',
            },
            companionPlacement: { kind: 'reserved_rail', edge: 'trailing', widthPx: 280 },
        });

        expect(resolveSessionBoardHostVisibility({
            ...retainedDesktopFacts,
            mobileSurface: 'board',
        }).visibleHosts).toEqual(['mobileCockpit']);
        expect(resolveSessionBoardHostVisibility({
            ...retainedDesktopFacts,
            mobileSurface: null,
        }).visibleHosts).toEqual(['details', 'sidebar', 'companion']);
    });

    it('gives focused Details keyboard focus so it wins over precedence', () => {
        const resolved = resolveSessionBoardHostVisibility(facts({
            panes: { detailsOpen: true, detailsFocusModeActive: true, rightOpen: false, rightActiveTabId: null },
            companionPlacement: { kind: 'reserved_rail', edge: 'trailing', widthPx: 280 },
        }));

        expect(resolved.visibleHosts).toContain('focusedDetails');
        expect(resolved.focusedHost).toBe('focusedDetails');
        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility: resolved,
            itemVisibleInCompanion: true,
        })).toBe('focusedDetails');
    });

    it('resolves ONE primary host that the Companion and the sidebar agree on', () => {
        // The reachable split-brain this owner removes: the compact sidebar used
        // to self-appoint from its own visibility while the Companion resolved a
        // different winner, so one executable item mounted twice.
        const resolved = resolveSessionBoardHostVisibility(facts({
            panes: { detailsOpen: false, detailsFocusModeActive: false, rightOpen: true, rightActiveTabId: 'board' },
            companionPlacement: { kind: 'reserved_rail', edge: 'trailing', widthPx: 280 },
        }));

        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility: resolved,
            itemVisibleInCompanion: true,
        })).toBe('companion');
        expect(resolved.visibleHosts).toContain('sidebar');
    });

    it('resolves the primary host per item when only some Board items are in Companion', () => {
        const visibility = resolveSessionBoardHostVisibility(facts({
            panes: { detailsOpen: false, detailsFocusModeActive: false, rightOpen: true, rightActiveTabId: 'board' },
            companionPlacement: { kind: 'reserved_rail', edge: 'trailing', widthPx: 280 },
        }));

        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility,
            itemVisibleInCompanion: true,
        })).toBe('companion');
        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility,
            itemVisibleInCompanion: false,
        })).toBe('sidebar');
    });

    it('drives no executable mount from a background window', () => {
        const visibility = resolveSessionBoardHostVisibility(facts({
            foreground: false,
            panes: { detailsOpen: true, detailsFocusModeActive: false, rightOpen: false, rightActiveTabId: null },
        }));
        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility,
            itemVisibleInCompanion: false,
        })).toBeNull();
    });

    it('resolves nothing before the pane owner has published its state', () => {
        const visibility = resolveSessionBoardHostVisibility(facts({ panes: null }));
        expect(resolveSessionBoardItemPrimaryMountHost({
            visibility,
            itemVisibleInCompanion: false,
        })).toBeNull();
    });
});
