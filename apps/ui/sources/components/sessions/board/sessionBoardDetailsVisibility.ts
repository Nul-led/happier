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
export function isSessionBoardVisibleInDetails(
    details: SessionBoardDetailsVisibilityInput | null | undefined,
): boolean {
    if (!details?.isOpen) return false;
    const isBoardKey = (key: string | null): boolean => (
        key === SESSION_DETAILS_BOARD_TAB_KEY || (key !== null && key.startsWith(`${SESSION_DETAILS_BOARD_TAB_KEY}:`))
    );
    if (details.maximizedGroupId) {
        return isBoardKey(
            details.groups?.find((group) => group.id === details.maximizedGroupId)?.activeTabKey ?? null,
        );
    }
    if (isBoardKey(details.activeTabKey)) return true;
    return (details.groups ?? []).some((group) => isBoardKey(group.activeTabKey));
}
