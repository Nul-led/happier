/**
 * The floating surface's geometry (menus, pickers, popovers drawn by `FloatingOverlay`). Menu rows
 * derive their inset and corner radius from it, so a highlighted row is concentric with the surface
 * around it (`MENU_ROW_METRICS`).
 */
export const FLOATING_OVERLAY_METRICS = {
    radiusPx: 12,
} as const;
