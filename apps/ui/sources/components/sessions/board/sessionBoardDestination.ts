import type { IconName } from '@/components/ui/icons/Icon';

/**
 * The ONE Board destination descriptor.
 *
 * Details, the right sidebar, the Session header overflow and the mobile Cockpit
 * are four entry points to the same place. Each of them used to spell that place
 * out itself, which is how a Board tab and a Board menu item end up with different
 * icons and — worse — different Homes. They read the id, icon and localized label
 * from here, and they resolve availability from the same `sessions.board` decision
 * on the exact Session's Home.
 *
 * Availability is a feature decision, not a content check: an empty Board is still
 * reachable, and a missing or malformed decision fails closed.
 */
export const SESSION_BOARD_DESTINATION = Object.freeze({
    /** The right-sidebar tab id and mobile Cockpit surface id. */
    id: 'board' as const,
    icon: 'squares-four' as IconName,
    /** Resolved through `t(...)` by each entry point so copy stays localized. */
    labelKey: 'sessionBoard.title' as const,
    /** The canonical feature decision every entry point applies. */
    featureId: 'sessions.board' as const,
});

/** The Session header overflow entry id, handled by the Session shell. */
export const SESSION_BOARD_HEADER_MENU_ACTION_ID = 'header.openBoard';
