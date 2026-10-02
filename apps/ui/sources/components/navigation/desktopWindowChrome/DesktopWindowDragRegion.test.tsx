// @vitest-environment jsdom
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const desktopWindowBridgeState = vi.hoisted(() => ({
    startDesktopWindowDragging: vi.fn(),
    toggleDesktopWindowMaximize: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const web = await vi.importActual<typeof import('react-native')>('react-native-web');
    return createReactNativeWebMock({
        View: web.View,
        Pressable: web.Pressable,
        Platform: {
            OS: 'web',
        },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('@/utils/platform/desktopWindowBridge', () => ({
    startDesktopWindowDragging: () => desktopWindowBridgeState.startDesktopWindowDragging(),
    toggleDesktopWindowMaximize: () => desktopWindowBridgeState.toggleDesktopWindowMaximize(),
}));

describe('useDesktopWindowDragMouseProps', () => {
    beforeEach(() => {
        desktopWindowBridgeState.startDesktopWindowDragging.mockReset();
        desktopWindowBridgeState.toggleDesktopWindowMaximize.mockReset();
        vi.resetModules();
    });

    it('starts dragging once from pointer down and suppresses the follow-up mouse fallback', async () => {
        const { useDesktopWindowDragMouseProps } = await import('./DesktopWindowDragRegion');
        const hook = await renderHook(() => useDesktopWindowDragMouseProps(), {
            flushOptions: { cycles: 1, turns: 1 },
        });
        const dragProps = hook.getCurrent();
        const preventDefault = vi.fn();
        const draggableTarget = { closest: vi.fn(() => null) };

        dragProps.onPointerDown?.({
            buttons: 1,
            preventDefault,
            target: draggableTarget,
        });
        dragProps.onMouseDown?.({
            buttons: 1,
            preventDefault,
            target: draggableTarget,
        });

        expect(dragProps['data-tauri-drag-region']).toBe(true);
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(desktopWindowBridgeState.startDesktopWindowDragging).toHaveBeenCalledTimes(1);
        expect(desktopWindowBridgeState.toggleDesktopWindowMaximize).not.toHaveBeenCalled();
    });

    it('toggles maximize from double-click titlebar mouse down without starting a drag', async () => {
        const { useDesktopWindowDragMouseProps } = await import('./DesktopWindowDragRegion');
        const hook = await renderHook(() => useDesktopWindowDragMouseProps(), {
            flushOptions: { cycles: 1, turns: 1 },
        });
        const dragProps = hook.getCurrent();
        const preventDefault = vi.fn();
        const draggableTarget = { closest: vi.fn(() => null) };

        dragProps.onMouseDown?.({
            buttons: 1,
            detail: 2,
            preventDefault,
            target: draggableTarget,
        });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(desktopWindowBridgeState.toggleDesktopWindowMaximize).toHaveBeenCalledTimes(1);
        expect(desktopWindowBridgeState.startDesktopWindowDragging).not.toHaveBeenCalled();
    });

    it('does not start dragging from nested interactive controls', async () => {
        const { useDesktopWindowDragMouseProps } = await import('./DesktopWindowDragRegion');
        const hook = await renderHook(() => useDesktopWindowDragMouseProps(), {
            flushOptions: { cycles: 1, turns: 1 },
        });
        const dragProps = hook.getCurrent();
        const preventDefault = vi.fn();
        const interactiveTarget = { closest: vi.fn(() => ({ role: 'button' })) };

        dragProps.onPointerDown?.({
            buttons: 1,
            preventDefault,
            target: interactiveTarget,
        });

        expect(preventDefault).not.toHaveBeenCalled();
        expect(desktopWindowBridgeState.startDesktopWindowDragging).not.toHaveBeenCalled();
        expect(desktopWindowBridgeState.toggleDesktopWindowMaximize).not.toHaveBeenCalled();
    });

    it('preserves presses on a real React Native Web control without a button role', async () => {
        const { Pressable } = await vi.importActual<typeof import('react-native')>('react-native-web');
        const host = document.createElement('div');
        // Matches Header's current role-free default back-button Pressable shape.
        host.innerHTML = renderToStaticMarkup(
            <Pressable onPress={() => {}}><span data-testid="back-icon" /></Pressable>,
        );
        const icon = host.querySelector('[data-testid="back-icon"]');
        expect(icon).not.toBeNull();
        expect(icon?.closest('button,[role="button"]')).toBeNull();

        const { useDesktopWindowDragMouseProps } = await import('./DesktopWindowDragRegion');
        const hook = await renderHook(() => useDesktopWindowDragMouseProps(), {
            flushOptions: { cycles: 1, turns: 1 },
        });
        const preventDefault = vi.fn();
        const event = { buttons: 1, preventDefault, target: icon };
        hook.getCurrent().onPointerDown?.(event);
        hook.getCurrent().onMouseDown?.(event);

        expect(preventDefault).not.toHaveBeenCalled();
        expect(desktopWindowBridgeState.startDesktopWindowDragging).not.toHaveBeenCalled();
        expect(desktopWindowBridgeState.toggleDesktopWindowMaximize).not.toHaveBeenCalled();
    });

    it('keeps header controls clickable through document capture while blank chrome still drags', async () => {
        const { createRoot } = await import('react-dom/client');
        const { Pressable } = await import('react-native');
        const { Header } = await import('../Header');
        const { DesktopMainContentDragSurface } = await import('./DesktopMainContentDragSurface');
        const navigateBack = vi.fn();
        const close = vi.fn();
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await React.act(async () => {
                root.render(
                    <div tabIndex={-1}>
                        <DesktopMainContentDragSurface enabled leftOffsetPx={0}>
                            <Header
                                safeAreaEnabled={false}
                                title={<span data-testid="blank-title" />}
                                headerLeft={() => (
                                    <Pressable onPress={navigateBack}>
                                        <span data-testid="header-back-icon" />
                                    </Pressable>
                                )}
                                headerRight={() => (
                                    <Pressable onPress={close} accessibilityRole="button">
                                        <span data-testid="header-close-icon" />
                                    </Pressable>
                                )}
                            />
                        </DesktopMainContentDragSurface>
                    </div>,
                );
            });
            for (const testID of ['header-back-icon', 'header-close-icon']) {
                const icon = host.querySelector(`[data-testid="${testID}"]`);
                expect(icon).not.toBeNull();
                const down = new MouseEvent('mousedown', {
                    bubbles: true, cancelable: true, buttons: 1, clientX: 16, clientY: 20,
                });
                await React.act(async () => {
                    icon?.dispatchEvent(down);
                    icon?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    icon?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                });
                expect(down.defaultPrevented).toBe(false);
            }
            expect(navigateBack).toHaveBeenCalledOnce();
            expect(close).toHaveBeenCalledOnce();
            expect(desktopWindowBridgeState.startDesktopWindowDragging).not.toHaveBeenCalled();

            const blankTitle = host.querySelector('[data-testid="blank-title"]');
            expect(blankTitle).not.toBeNull();
            await React.act(async () => {
                blankTitle?.dispatchEvent(new MouseEvent('mousedown', {
                    bubbles: true, cancelable: true, buttons: 1, clientX: 100, clientY: 20,
                }));
            });
            expect(desktopWindowBridgeState.startDesktopWindowDragging).toHaveBeenCalled();
        } finally {
            await React.act(async () => root.unmount());
            host.remove();
        }
    });
});
