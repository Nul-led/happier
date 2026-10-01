import { invokeDesktopHost } from '@/utils/platform/desktopHost';

import type { DesktopTrayMenuState } from './buildDesktopTrayMenuState';
import type { DesktopTrayState } from './buildDesktopTrayState';

/**
 * What a tray item asked for while the main window was being built again (menu-bar mode): a
 * screen, or a row's Home (its Open).
 */
export type DesktopTrayDestination = 'updates' | 'settings' | Readonly<{ relayUrl: string }>;

export function readDesktopTrayDestination(value: unknown): DesktopTrayDestination | null {
    if (value === 'updates' || value === 'settings') return value;
    const relayUrl = value && typeof value === 'object' ? (value as { relayUrl?: unknown }).relayUrl : null;
    return typeof relayUrl === 'string' && relayUrl.trim() ? { relayUrl: relayUrl.trim() } : null;
}

/**
 * Pushes the tray's facts to the native menu. Resolves what a tray item asked for while this window
 * was being created, exactly once, so the fresh web UI acts on it after its router exists.
 */
export async function applyTauriTrayState(state: DesktopTrayState & DesktopTrayMenuState): Promise<DesktopTrayDestination | null> {
    return readDesktopTrayDestination(await invokeDesktopHost<unknown>('desktop_set_tray_state', { state }));
}
