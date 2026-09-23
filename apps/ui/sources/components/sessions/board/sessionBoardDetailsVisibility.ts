import { SESSION_DETAILS_BOARD_TAB_KEY } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';

/**
 * The exact Details facts this answer needs, so both the full workspace view and
 * the pane-scope projection of it can be asked the same question.
 */
export type SessionBoardDetailsVisibilityInput = Readonly<{
    isOpen: boolean;
    activeTabKey: string | null;
    groups?: ReadonlyArray<Readonly<{ id: string; activeTabKey: string | null }>>;
    maximizedGroupId?: string | null;
}>;

/**
 * Is a Board destination visible in the Details workspace right now?
 *
 * This reads the TYPED Details-workspace view — including split groups, which the
 * previous ad-hoc object inspection looked for under a `groupsById` key the view
 * does not expose, so a Board opened in a second split group counted as hidden and
 * the sidebar happily mounted a duplicate executable frame.
 *
 * A group is only "showing the Board" when the Board destination is its ACTIVE
 * tab: a background tab in a split group is not on screen.
 */
function visibleActiveTabKeys(
    details: SessionBoardDetailsVisibilityInput,
): readonly (string | null)[] {
    // A maximized group is the only one on screen; otherwise every group shows its
    // own active tab beside the workspace-level one.
    if (details.maximizedGroupId) {
        return [details.groups?.find((group) => group.id === details.maximizedGroupId)?.activeTabKey ?? null];
    }
    return [details.activeTabKey, ...(details.groups ?? []).map((group) => group.activeTabKey)];
}

const BOARD_ITEM_TAB_PREFIX = `${SESSION_DETAILS_BOARD_TAB_KEY}:`;

export function isSessionBoardVisibleInDetails(
    details: SessionBoardDetailsVisibilityInput | null | undefined,
): boolean {
    if (!details?.isOpen) return false;
    return visibleActiveTabKeys(details).some((key) => (
        key === SESSION_DETAILS_BOARD_TAB_KEY || (key !== null && key.startsWith(BOARD_ITEM_TAB_PREFIX))
    ));
}

/**
 * Is the GENERIC Board destination visible, as opposed to only an item's own
 * expanded `board:<itemId>` destination?
 *
 * The generic tab draws the selected view's placements; an expanded tab draws one
 * item. Only the generic tab makes Details a candidate host for an arbitrary item,
 * so the mount election needs the two answers apart.
 */
export function isGenericSessionBoardVisibleInDetails(
    details: SessionBoardDetailsVisibilityInput | null | undefined,
): boolean {
    if (!details?.isOpen) return false;
    return visibleActiveTabKeys(details).some((key) => key === SESSION_DETAILS_BOARD_TAB_KEY);
}

/**
 * Which items have their own expanded Board destination on screen right now.
 *
 * The generic Board tab and an item's `board:<itemId>` tab are deliberately
 * different destinations, so a split workspace can present both at once. Both
 * draw the same item at full density, and an executable source may run in only
 * one physical placement — this is the fact that tells the two copies apart.
 */
export function listVisibleSessionBoardDetailsExpandedItemIds(
    details: SessionBoardDetailsVisibilityInput | null | undefined,
): readonly string[] {
    if (!details?.isOpen) return [];
    return [...new Set(visibleActiveTabKeys(details).flatMap((key) => (
        key !== null && key.startsWith(BOARD_ITEM_TAB_PREFIX)
            ? [key.slice(BOARD_ITEM_TAB_PREFIX.length)]
            : []
    )))];
}
