import {
    resolveSessionBoardPrimaryMountHost,
    type SessionBoardMountHost,
} from '@/sync/domains/session/board';

import type { SessionCompanionPlacement } from '@/components/sessions/companion/layout/resolveSessionCompanionPlacement';

/**
 * The ONE place a Session shell answers "which placement runs this item".
 *
 * V1 gives an executable item exactly one interactive placement per viewer and
 * window. Before this owner existed, four surfaces answered that question from
 * their own partial view — the compact sidebar and the Details renderer
 * self-appointed from local visibility while the Companion ran the precedence
 * resolver over a host set that did not include them. With a Board tab open in
 * the right pane AND a Companion rail visible, the sidebar called itself primary
 * and the Companion also called itself primary: one item, two live mounts.
 *
 * The fix is not another arbiter. It is gathering the complete candidate set from
 * the incumbent pane, Cockpit and Companion owners ONCE and invoking the existing
 * pure precedence resolver with it. Nothing is stored, leased or persisted.
 */

export type SessionBoardPaneVisibilityFacts = Readonly<{
    detailsOpen: boolean;
    /**
     * A Board destination is the ACTIVE tab of some Details group. An open Details
     * pane showing a file or a diff mounts no Board, so it is not a candidate.
     * Omitted keeps the previous, coarser reading for callers that cannot yet
     * supply the exact fact.
     */
    detailsShowsBoard?: boolean;
    /** Incumbent pane focus mode, which is also what selects the focused Details renderer. */
    detailsFocusModeActive: boolean;
    rightOpen: boolean;
    rightActiveTabId: string | null;
}>;

export type SessionBoardHostVisibilityFacts = Readonly<{
    /** The window/app is foreground. A background window drives no executable mount. */
    foreground: boolean;
    /** `null` until the incumbent pane owner has published this scope's state. */
    panes: SessionBoardPaneVisibilityFacts | null;
    /** The resolved viewer-local Companion placement, from its one layout owner. */
    companionPlacement: SessionCompanionPlacement;
    /**
     * The mobile Cockpit's current Session surface, when this shell IS the
     * Cockpit. Desktop/tablet shells pass `null`.
     */
    mobileSurface: 'board' | 'companion' | null;
}>;

export type SessionBoardHostVisibility = Readonly<{
    foreground: boolean;
    visibleHosts: readonly SessionBoardMountHost[];
    focusedHost: SessionBoardMountHost | null;
}>;

const SIDEBAR_BOARD_TAB_ID = 'board';

export function resolveSessionBoardHostVisibility(
    facts: SessionBoardHostVisibilityFacts,
): SessionBoardHostVisibility {
    // Board and Companion are exclusive full-screen Cockpit surfaces. Their
    // content is mounted through SessionView's contentOverride while the normal
    // AppPaneScopeHost tree is skipped, so retained desktop pane/preferences are
    // restoration state rather than physical candidates. Mask them here at the
    // shared visibility owner instead of closing panes or teaching the primary
    // resolver about mobile presentation.
    if (facts.mobileSurface) {
        const mobileHost: SessionBoardMountHost = facts.mobileSurface === 'board'
            ? 'mobileCockpit'
            : 'companion';
        return Object.freeze({
            foreground: facts.foreground,
            visibleHosts: Object.freeze([mobileHost]),
            focusedHost: null,
        });
    }

    const visibleHosts: SessionBoardMountHost[] = [];

    if (facts.panes) {
        const detailsRendersBoard = facts.panes.detailsOpen
            && (facts.panes.detailsShowsBoard ?? true);
        if (detailsRendersBoard) visibleHosts.push('details');
        if (detailsRendersBoard && facts.panes.detailsFocusModeActive) visibleHosts.push('focusedDetails');
        if (facts.panes.rightOpen && facts.panes.rightActiveTabId === SIDEBAR_BOARD_TAB_ID) {
            visibleHosts.push('sidebar');
        }
    }

    // Only a reserved rail actually renders item content; the collapsed control
    // and the phone entry point render an affordance, so they are not candidates.
    if (facts.companionPlacement.kind === 'reserved_rail') visibleHosts.push('companion');
    const focusedHost: SessionBoardMountHost | null = visibleHosts.includes('focusedDetails')
        ? 'focusedDetails'
        : null;

    return Object.freeze({
        foreground: facts.foreground,
        visibleHosts: Object.freeze(visibleHosts),
        focusedHost,
    });
}

/**
 * Resolve the executable placement for one exact item.
 *
 * Board-like hosts render the selected Board view, while Companion renders only
 * the viewer's ordered local subset. Treating Companion as visible for every
 * Board item can therefore select a host that does not render the item at all,
 * leaving the real Board copy as an inert preview. The membership bit comes from
 * the canonical Companion preference; this function remains a pure projection
 * over the incumbent visibility owners and stores nothing.
 */
export function resolveSessionBoardItemPrimaryMountHost(input: Readonly<{
    visibility: SessionBoardHostVisibility;
    itemVisibleInCompanion: boolean;
}>): SessionBoardMountHost | null {
    const visibleHosts = input.itemVisibleInCompanion
        ? input.visibility.visibleHosts
        : input.visibility.visibleHosts.filter((host) => host !== 'companion');
    const focusedHost = input.visibility.focusedHost === 'companion' && !input.itemVisibleInCompanion
        ? null
        : input.visibility.focusedHost;
    return resolveSessionBoardPrimaryMountHost({
        foreground: input.visibility.foreground,
        visibleHosts,
        focusedHost,
    });
}
