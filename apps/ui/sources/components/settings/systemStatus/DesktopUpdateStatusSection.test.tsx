import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { createDeferred } from '@/dev/testkit/hooks/createDeferred';
import { renderScreen } from '@/dev/testkit/render/renderScreen';

vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock({ translate: (key: string) => key }));
vi.mock('@/components/ui/lists/Item', async () => (await import('@/dev/testkit/mocks/components')).createPassThroughModule(['Item']));
vi.mock('@/components/ui/lists/ItemGroup', async () => (await import('@/dev/testkit/mocks/components')).createPassThroughModule(['ItemGroup']));
vi.mock('@/components/ui/icons/Icon', async () => (await import('@/dev/testkit/mocks/components')).createPassThroughModule(['Icon']));

describe('DesktopUpdateStatusSection', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal('__DEV__', false);
    });
    afterEach(() => {
        standardCleanup();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('shows the available version and installs through the shared native updater', async () => {
        const invoke = vi.fn(async (command: string) => command === 'desktop_fetch_update'
            ? { version: '2.0.0', currentVersion: '1.0.0', notes: null, pubDate: null }
            : false);
        vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
        const { DesktopUpdateStatusSection } = await import('./DesktopUpdateStatusSection');
        const screen = await renderScreen(<DesktopUpdateStatusSection />);
        expect(screen.findByTestId('settings-desktop-update-install')?.props.detail).toBe('2.0.0');
        await screen.pressByTestIdAsync('settings-desktop-update-install');
        expect(invoke.mock.calls.map(([command]) => command)).toEqual(['desktop_fetch_update', 'desktop_install_update']);
        expect(screen.findByTestId('settings-desktop-update-check')?.props.subtitle).toBe('systemStatus.updates.upToDate');
    });

    it('disables manual checks when the configured desktop update policy is off', async () => {
        vi.stubEnv('EXPO_PUBLIC_HAPPIER_DESKTOP_UPDATES_ENABLED', '0');
        const invoke = vi.fn(async () => null);
        vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
        const { DesktopUpdateStatusSection } = await import('./DesktopUpdateStatusSection');
        const screen = await renderScreen(<DesktopUpdateStatusSection />);
        expect(screen.findByTestId('settings-desktop-update-check')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings-desktop-update-check')?.props.subtitle).toBe('systemStatus.updates.disabled');
        await screen.pressByTestIdAsync('settings-desktop-update-check');
        expect(invoke).not.toHaveBeenCalled();
    });

    it('disables check and apply while a native check is pending', async () => {
        const pending = createDeferred<null>();
        const invoke = vi.fn<() => Promise<unknown>>(async () => ({ version: '2.0.0', currentVersion: '1.0.0', notes: null, pubDate: null }));
        vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
        const { DesktopUpdateStatusSection } = await import('./DesktopUpdateStatusSection');
        const screen = await renderScreen(<DesktopUpdateStatusSection />);
        invoke.mockReturnValueOnce(pending.promise);
        let refresh!: Promise<void>;
        await act(async () => { refresh = screen.findByTestId('settings-desktop-update-check')?.props.onPress(); });
        expect(screen.findByTestId('settings-desktop-update-check')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings-desktop-update-install')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings-desktop-update-check')?.props.subtitle).toBe('systemStatus.updates.checking');
        await act(async () => { pending.resolve(null); await refresh; });
        expect(screen.findByTestId('settings-desktop-update-check')?.props.disabled).toBe(false);
    });

    it('omits desktop actions in a browser', async () => {
        const { DesktopUpdateStatusSection } = await import('./DesktopUpdateStatusSection');
        const screen = await renderScreen(<DesktopUpdateStatusSection />);
        expect(screen.findByTestId('settings-desktop-update-check')).toBeNull();
    });
});
