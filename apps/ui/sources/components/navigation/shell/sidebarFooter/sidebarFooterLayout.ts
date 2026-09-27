import { ICON_SIZE } from '@/components/ui/icons/Icon';

/** The footer's inset from the sidebar edges; the account area's hover fill sits inside it. */
export const SIDEBAR_FOOTER_PADDING_PX = 8;
/** Each footer icon button: a 28px visible square carrying a sidebar-chrome glyph. */
export const SIDEBAR_FOOTER_ICON_BUTTON_SIZE_PX = 28;
export const SIDEBAR_FOOTER_ICON_GLYPH_SIZE_PX = ICON_SIZE.sm;
/** Between the account area and the first icon, and between icons. */
export const SIDEBAR_FOOTER_GAP_PX = 4;
export const SIDEBAR_FOOTER_ACCOUNT_AVATAR_SIZE_PX = 28;
export const SIDEBAR_FOOTER_ACCOUNT_PADDING_X_PX = 6;
export const SIDEBAR_FOOTER_ACCOUNT_AVATAR_GAP_PX = 8;
/**
 * The narrowest the account's name may get before the icons give way: about eight characters of
 * the 13px name ("Leeroy B…"), enough to recognise a person. Below it the name reads as a stub, so
 * Usage and Machines fold into "⋯" instead of squeezing it further.
 */
export const SIDEBAR_FOOTER_ACCOUNT_NAME_MIN_WIDTH_PX = 72;

const ACCOUNT_MIN_WIDTH_PX = SIDEBAR_FOOTER_ACCOUNT_PADDING_X_PX * 2
    + SIDEBAR_FOOTER_ACCOUNT_AVATAR_SIZE_PX
    + SIDEBAR_FOOTER_ACCOUNT_AVATAR_GAP_PX
    + SIDEBAR_FOOTER_ACCOUNT_NAME_MIN_WIDTH_PX;

function iconRowWidth(count: number): number {
    return count * (SIDEBAR_FOOTER_ICON_BUTTON_SIZE_PX + SIDEBAR_FOOTER_GAP_PX);
}

/**
 * Whether Usage and Machines fold into "⋯": only when the measured sidebar cannot hold the account
 * area at its minimum readable width beside every visible icon. The threshold therefore moves with
 * the icons actually shown (Updates only exists while an update does). An unmeasured width folds
 * nothing.
 */
export function resolveSidebarFooterFoldsSecondary(input: Readonly<{
    sidebarWidthPx: number | null;
    updatesVisible: boolean;
    usageVisible: boolean;
}>): boolean {
    if (input.sidebarWidthPx == null || !Number.isFinite(input.sidebarWidthPx)) return false;
    const available = input.sidebarWidthPx - SIDEBAR_FOOTER_PADDING_PX * 2;
    // Machines and Settings, plus Usage where the Home reports limits and Updates while one exists.
    const iconCount = 2 + (input.usageVisible ? 1 : 0) + (input.updatesVisible ? 1 : 0);
    return available < ACCOUNT_MIN_WIDTH_PX + iconRowWidth(iconCount);
}
