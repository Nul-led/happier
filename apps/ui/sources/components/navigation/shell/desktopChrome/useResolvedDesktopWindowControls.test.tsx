import React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { findNearestHostParent, renderScreen } from '@/dev/testkit';
import { useResolvedDesktopWindowControls } from './useResolvedDesktopWindowControls';

import { installNavigationShellCommonModuleMocks } from '../navigationShellTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const desktopHostState = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(),
}));

installNavigationShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
            },
        });
    },
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock({
        theme: {
            colors: {
                groupped: { background: '#fff' },
                divider: '#ddd',
                surface: '#fff',
                text: '#111',
                textSecondary: '#777',
                header: { tint: '#111' },
                button: { primary: { tint: '#fff' } },
                status: { error: '#f00' },
            },
        },
    });
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

// Tauri invocation/events are the platform boundary; the real chrome bridge stays under test.
vi.mock('@/utils/platform/desktopHost', () => ({
    isDesktopHost: () => true,
    invokeDesktopHost: (command: string) => desktopHostState.invoke(command),
    listenDesktopHostEvent: (event: string, handler: (payload: unknown) => void) => desktopHostState.listen(event, handler),
}));

function ResolvedDesktopWindowControlsHarness(props: Readonly<{
    variant: 'expanded' | 'collapsed';
    desktopWindowControls?: React.ReactNode;
}>) {
    const controls = useResolvedDesktopWindowControls({
        variant: props.variant,
        desktopWindowControls: props.desktopWindowControls,
        hasDesktopWindowControlsOverride: Object.prototype.hasOwnProperty.call(props, 'desktopWindowControls'),
    });

    return React.createElement(React.Fragment, null, controls);
}

describe('useResolvedDesktopWindowControls', () => {
    beforeEach(() => {
        desktopHostState.invoke.mockReset();
        desktopHostState.listen.mockReset();
        desktopHostState.invoke.mockResolvedValue({ strategy: 'none' });
        desktopHostState.listen.mockResolvedValue(async () => {});
    });

    it('returns no controls when the desktop strategy is none', async () => {
        const screen = await renderScreen(<ResolvedDesktopWindowControlsHarness variant="expanded" />);

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.findAllByTestId('desktop-window-controls-slot')).toHaveLength(0);
        expect(desktopHostState.listen).not.toHaveBeenCalled();
    });

    it('uses injected controls without consulting the bridge', async () => {
        const screen = await renderScreen(
            <ResolvedDesktopWindowControlsHarness
                variant="expanded"
                desktopWindowControls={React.createElement('View', { testID: 'injected-window-controls' })}
            />,
        );

        expect(screen.findByTestId('injected-window-controls')).toBeTruthy();
        expect(desktopHostState.invoke).not.toHaveBeenCalled();
    });

    it('renders stacked custom-controls for the collapsed host', async () => {
        desktopHostState.invoke.mockImplementation(async (command: string) => command === 'desktop_get_window_chrome_policy'
            ? { strategy: 'custom-controls' }
            : { isMaximized: false, isFullscreen: false });

        const screen = await renderScreen(<ResolvedDesktopWindowControlsHarness variant="collapsed" />);

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        const minimizeButton = screen.findHostByTestId('desktop-window-controls-minimize');
        if (!minimizeButton) {
            throw new Error('minimize button should be present');
        }
        expect(minimizeButton).toBeTruthy();
        expect(screen.findByTestId('desktop-window-controls-toggle-maximize')).toBeTruthy();
        expect(screen.findByTestId('desktop-window-controls-close')).toBeTruthy();
    });

    it('releases the traffic-light inset in fullscreen and restores it on exit', async () => {
        desktopHostState.invoke.mockImplementation(async (command: string) => command === 'desktop_get_window_chrome_policy'
            ? { strategy: 'native-macos-traffic-lights' }
            : { isMaximized: false, isFullscreen: false });
        let updateState: ((state: unknown) => void) | undefined;
        const unlisten = vi.fn();
        desktopHostState.listen.mockImplementation(async (_event: string, handler: (state: unknown) => void) => {
            updateState = handler;
            return unlisten;
        });
        const screen = await renderScreen(<ResolvedDesktopWindowControlsHarness variant="expanded" />);
        await act(async () => { await Promise.resolve(); });
        expect(screen.findAllByTestId('desktop-window-controls-slot')).toHaveLength(1);
        await act(async () => { updateState?.({ isMaximized: false, isFullscreen: true }); });
        expect(screen.findAllByTestId('desktop-window-controls-slot')).toHaveLength(0);
        await act(async () => { updateState?.({ isMaximized: false, isFullscreen: false }); });
        expect(screen.findAllByTestId('desktop-window-controls-slot')).toHaveLength(1);
        await screen.unmount();
        expect(unlisten).toHaveBeenCalledOnce();
    });
});
