import type { Page } from '@playwright/test';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import {
    applyFakeTauriDesktopCommand,
    createFakeTauriDesktopState,
    installFakeTauriDesktopBridge,
    type FakeTauriDesktopState,
} from './fakeTauriDesktop';

async function installBrowserBridge() {
    const window: {
        __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
        __HAPPIER_FAKE_TAURI_DESKTOP__?: FakeTauriDesktopState;
    } = {};
    // Page is the external browser boundary; execute its serialized init script in an isolated realm.
    const page = {
        addInitScript: async (script: (state: FakeTauriDesktopState) => void, state: FakeTauriDesktopState) => {
            runInNewContext(`(${script.toString()})(initialState)`, { window, initialState: state });
        },
        url: () => 'about:blank',
    } as unknown as Page;
    await installFakeTauriDesktopBridge(page);
    return window;
}

describe('fakeTauriDesktop', () => {
    it('returns the canonical window chrome policy for the active Tauri window', async () => {
        const initial = createFakeTauriDesktopState({
            isMaximized: false,
            platform: 'windows',
            strategy: 'custom-controls',
        });

        const mainWindowPolicy = await applyFakeTauriDesktopCommand(
            initial,
            'desktop_get_window_chrome_policy',
        );

        const overlayWindowPolicy = await applyFakeTauriDesktopCommand(
            {
                ...initial,
                currentWindowLabel: 'activity_overlay',
            },
            'desktop_get_window_chrome_policy',
        );

        expect(mainWindowPolicy.result).toEqual({
            strategy: 'custom-controls',
        });
        expect(overlayWindowPolicy.result).toEqual({
            strategy: 'none',
        });
    });

    it('tracks the canonical desktop window bridge commands and maximize state', async () => {
        const initial = createFakeTauriDesktopState({
            isMaximized: false,
            platform: 'windows',
            strategy: 'custom-controls',
        });

        const minimizeResult = await applyFakeTauriDesktopCommand(
            initial,
            'desktop_minimize_window',
        );
        const maximizeResult = await applyFakeTauriDesktopCommand(
            minimizeResult.state,
            'desktop_toggle_window_maximize',
        );
        const dragResult = await applyFakeTauriDesktopCommand(
            maximizeResult.state,
            'desktop_start_window_dragging',
        );
        const closeResult = await applyFakeTauriDesktopCommand(
            dragResult.state,
            'desktop_close_window',
        );
        const maximizedState = await applyFakeTauriDesktopCommand(
            closeResult.state,
            'desktop_get_window_state',
        );

        expect(minimizeResult.result).toBe(true);
        expect(maximizeResult.result).toBe(true);
        expect(dragResult.result).toBe(true);
        expect(closeResult.result).toBe(true);
        expect(maximizedState.result).toEqual({
            isMaximized: true,
        });
        expect(maximizedState.state.controls).toEqual({
            closeCount: 1,
            dragCount: 1,
            minimizeCount: 1,
            toggleMaximizeCount: 1,
        });
        expect(maximizedState.state.invokeLog.map((entry) => entry.command)).toEqual([
            'desktop_minimize_window',
            'desktop_toggle_window_maximize',
            'desktop_start_window_dragging',
            'desktop_close_window',
            'desktop_get_window_state',
        ]);
    });

    it('persists desktop update install state', async () => {
        const initial = createFakeTauriDesktopState({
            updateAvailable: {
                version: '1.2.3',
            },
        });

        const installResult = await applyFakeTauriDesktopCommand(
            initial,
            'desktop_install_update',
        );
        const updateState = await applyFakeTauriDesktopCommand(
            installResult.state,
            'desktop_fetch_update',
        );

        expect(installResult.result).toBe(true);
        expect(updateState.result).toEqual({
            installed: true,
            version: '1.2.3',
        });
    });

    it.each(['exit', 'menuBar'] as const)('records the %s shutdown outcome in both bridge entry points', async (outcome) => {
        const args = outcome === 'menuBar' ? { outcome } : undefined;
        const finished = await applyFakeTauriDesktopCommand(createFakeTauriDesktopState(), 'desktop_finish_shutdown', args);
        expect(finished.result).toBeNull();
        expect(finished.state).toMatchObject({ shutdownOutcome: outcome });

        const browser = await installBrowserBridge();
        await expect(browser.__TAURI_INTERNALS__!.invoke('desktop_finish_shutdown', args)).resolves.toBeNull();
        expect(browser.__HAPPIER_FAKE_TAURI_DESKTOP__).toMatchObject({ shutdownOutcome: outcome });
    });

    it('rejects commands missing from the real desktop host in both bridge entry points', async () => {
        const browser = await installBrowserBridge();
        await expect(applyFakeTauriDesktopCommand(createFakeTauriDesktopState(), 'desktop_unknown_command')).rejects.toThrow();
        await expect(browser.__TAURI_INTERNALS__!.invoke('desktop_unknown_command')).rejects.toThrow();
    });

    it('stores the named tray payload in both bridge entry points', async () => {
        const state = { serviceAutostart: 'on-demand' };
        const pushed = await applyFakeTauriDesktopCommand(createFakeTauriDesktopState(), 'desktop_set_tray_state', { state });
        expect(pushed.state.trayState).toEqual(state);
        const browser = await installBrowserBridge();
        await browser.__TAURI_INTERNALS__!.invoke('desktop_set_tray_state', { state });
        expect(browser.__HAPPIER_FAKE_TAURI_DESKTOP__?.trayState).toEqual(state);
    });

    it('downloads an offered update separately from installing it, and can fail the download', async () => {
        const offered = createFakeTauriDesktopState({ updateAvailable: { version: '1.2.3' } });

        const downloaded = await applyFakeTauriDesktopCommand(offered, 'desktop_download_update');
        expect(downloaded.result).toBe(true);
        expect(downloaded.state.updateAvailable).toEqual({ version: '1.2.3' });

        const nothingOffered = await applyFakeTauriDesktopCommand(
            createFakeTauriDesktopState(),
            'desktop_download_update',
        );
        expect(nothingOffered.result).toBe(false);

        await expect(applyFakeTauriDesktopCommand(
            createFakeTauriDesktopState({ updateAvailable: { version: '1.2.3' }, updateDownload: 'fail' }),
            'desktop_download_update',
        )).rejects.toThrow();
    });

    it('stores and returns desktop activity overlay window state', async () => {
        const initial = createFakeTauriDesktopState({
            currentWindowLabel: 'activity_overlay',
            desktopActivityOverlayState: null,
        });
        const payload = {
            visible: true,
            expanded: false,
            model: {
                companion: {
                    enabled: true,
                    state: 'idle',
                },
            },
        };

        const synced = await applyFakeTauriDesktopCommand(
            initial,
            'desktop_activity_overlay_sync',
            { payload },
        );
        const state = await applyFakeTauriDesktopCommand(
            synced.state,
            'desktop_activity_overlay_get_window_state',
        );

        expect(synced.result).toBeNull();
        expect(state.result).toEqual(payload);
        expect(state.state.invokeLog.map((entry) => entry.command)).toEqual([
            'desktop_activity_overlay_sync',
            'desktop_activity_overlay_get_window_state',
        ]);

        const browser = await installBrowserBridge();
        await browser.__TAURI_INTERNALS__!.invoke('desktop_activity_overlay_sync', { payload });
        await browser.__TAURI_INTERNALS__!.invoke('desktop_activity_overlay_set_expanded', { expanded: true });
        await expect(browser.__TAURI_INTERNALS__!.invoke('desktop_activity_overlay_get_window_state')).resolves.toEqual({
            ...payload,
            expanded: true,
        });
    });

    it('admits synthetic pet overlay window state through the canonical desktop bridge', async () => {
        const windowState = {
            activity: {
                state: 'running',
                reason: 'running',
                sessionId: 'pets-overlay-synthetic-session',
                trayItems: [],
            },
        };
        const initial = createFakeTauriDesktopState({
            currentWindowLabel: 'pet_overlay',
            desktopPetOverlayState: windowState,
        });

        const read = await applyFakeTauriDesktopCommand(
            initial,
            'desktop_pet_overlay_read_window_state',
        );

        expect(read.result).toEqual(windowState);
        expect(read.state.invokeLog.at(-1)?.command).toBe('desktop_pet_overlay_read_window_state');
    });
});
