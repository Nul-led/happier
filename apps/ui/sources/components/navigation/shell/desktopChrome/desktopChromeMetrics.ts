import { ICON_SIZE } from '@/components/ui/icons/Icon';

/** The physical pointer frame of a title-strip control (back, forward, the column toggle). */
export const DESKTOP_SIDEBAR_CHROME_TOP_NAV_ICON_TARGET_SIZE_PX = 24;
/**
 * One glyph size for every icon in the desktop window chrome: the title strip beside the 12px
 * traffic lights takes the compact step, so its glyphs have air inside their buttons.
 */
export const DESKTOP_SIDEBAR_CHROME_ICON_GLYPH_SIZE_PX = ICON_SIZE.sm;
/** The macOS traffic lights (or the custom window controls) need this much of the title strip. */
export const DESKTOP_WINDOW_CONTROLS_SLOT_MIN_WIDTH_PX = 68;
export const DESKTOP_WINDOW_CONTROLS_SLOT_MIN_HEIGHT_PX = 28;
export const DESKTOP_MAIN_CONTENT_DRAG_HEIGHT_PX = DESKTOP_WINDOW_CONTROLS_SLOT_MIN_HEIGHT_PX * 2;
