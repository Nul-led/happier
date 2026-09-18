import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installPartialStorageModuleMock } from '@/dev/testkit/mocks/storage';
import { installReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';

import { installNavigationShellCommonModuleMocks } from './navigationShellTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const hoistedState = vi.hoisted(() => ({
    mockPlatformOS: 'web' as 'web' | 'ios',
    mockWindowDimensions: { width: 1000, height: 800 },
    mockPathname: '/' as string,
    mockSegments: ['(app)'] as string[],
    routerReplaceMock: vi.fn(),
    dimensionListeners: new Set<() => void>(),
}));

installNavigationShellCommonModuleMocks({
    appPaneProvider: () => ({
        useAppPaneContext: () => {
            const focusModeScopeId = mockAppPaneStore.useContextValue();
            return {
                dispatch: mockAppPaneStore.dispatch,
                state: {
                    activeScopeId: 'session:s1',
                    focusMode: { scopeId: focusModeScopeId },
                    scopes: {
                        'session:s1': {
                            right: { isOpen: true },
                            details: { isOpen: true },
                            bottom: { isOpen: false },
                        },
                    },
                },
                getDriver: () => null,
                driverRegistryVersion: 1,
                registerDriver: () => () => {},
            };
        },
    }),
    reactNative: installReactNativeWebMock({
        View: (props: any) => React.createElement('View', props, props.children),
        Pressable: (props: any) => React.createElement('Pressable', props, props.children),
        PanResponder: {
            create: () => ({ panHandlers: {} }),
        },
        Dimensions: {
            get: () => ({
                width: hoistedState.mockWindowDimensions.width,
                height: hoistedState.mockWindowDimensions.height,
                scale: 1,
                fontScale: 1,
            }),
        },
        useWindowDimensions: () => React.useSyncExternalStore(
            (listener) => {
                hoistedState.dimensionListeners.add(listener);
                return () => { hoistedState.dimensionListeners.delete(listener); };
            },
            () => hoistedState.mockWindowDimensions,
        ),
        Platform: {
            get OS() {
                return hoistedState.mockPlatformOS;
            },
            select: (options: any) =>
                options?.[hoistedState.mockPlatformOS] ?? options?.default ?? options?.ios ?? options?.android,
        },
    }),
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            pathname: () => hoistedState.mockPathname,
            segments: () => hoistedState.mockSegments,
            router: {
                replace: hoistedState.routerReplaceMock,
            },
        }).module;
    },
    storage: installPartialStorageModuleMock({
        useLocalSetting: (key: string) => {
            return React.useSyncExternalStore(
                (listener) => mockLocalSettingsStore.subscribe(listener),
                () => {
                    if (key === 'sidebarCollapsed') return mockLocalSettingsStore.sidebarCollapsed;
                    if (key === 'sidebarWidthPx') return mockLocalSettingsStore.sidebarWidthPx;
                    if (key === 'sidebarWidthBasisPx') return mockLocalSettingsStore.sidebarWidthBasisPx;
                    return false;
                },
                () => {
                    if (key === 'sidebarCollapsed') return mockLocalSettingsStore.sidebarCollapsed;
                    if (key === 'sidebarWidthPx') return mockLocalSettingsStore.sidebarWidthPx;
                    if (key === 'sidebarWidthBasisPx') return mockLocalSettingsStore.sidebarWidthBasisPx;
                    return false;
                },
            );
        },
        useLocalSettingMutable: (key: string) => {
            const val = (React as any).useSyncExternalStore(
                (listener: any) => mockLocalSettingsStore.subscribe(listener),
                () => {
                    if (key === 'sidebarCollapsed') return mockLocalSettingsStore.sidebarCollapsed;
                    if (key === 'sidebarWidthPx') return mockLocalSettingsStore.sidebarWidthPx;
                    if (key === 'sidebarWidthBasisPx') return mockLocalSettingsStore.sidebarWidthBasisPx;
                    return false;
                },
                () => {
                    if (key === 'sidebarCollapsed') return mockLocalSettingsStore.sidebarCollapsed;
                    if (key === 'sidebarWidthPx') return mockLocalSettingsStore.sidebarWidthPx;
                    if (key === 'sidebarWidthBasisPx') return mockLocalSettingsStore.sidebarWidthBasisPx;
                    return false;
                },
            );
            return [
                val,
                (next: unknown) => {
                    if (key === 'sidebarCollapsed' && typeof next === 'boolean') mockLocalSettingsStore.setSidebarCollapsed(next);
                    if (key === 'sidebarWidthPx' && typeof next === 'number') mockLocalSettingsStore.setSidebarWidthPx(next);
                    if (key === 'sidebarWidthBasisPx' && typeof next === 'number') mockLocalSettingsStore.setSidebarWidthBasisPx(next);
                },
            ] as const;
        },
    }),
});

const mockLocalSettingsStore = (() => {
  let sidebarCollapsed = false;
  let sidebarWidthPx = 320;
  let sidebarWidthBasisPx = 1200;
  const listeners = new Set<() => void>();

  return {
    get sidebarCollapsed() {
      return sidebarCollapsed;
    },
    get sidebarWidthPx() {
      return sidebarWidthPx;
    },
    get sidebarWidthBasisPx() {
      return sidebarWidthBasisPx;
    },
    setSidebarCollapsed(next: boolean) {
      sidebarCollapsed = next;
      for (const l of listeners) l();
    },
    setSidebarWidthPx(next: number) {
      sidebarWidthPx = next;
      for (const l of listeners) l();
    },
    setSidebarWidthBasisPx(next: number) {
      sidebarWidthBasisPx = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

const mockAppPaneStore = (() => {
  let focusModeScopeId: string | null = null;
  const listeners = new Set<() => void>();
  const dispatch = vi.fn((action: any) => {
    if (action?.type === 'enterFocusMode') {
      focusModeScopeId = action.scopeId;
    }
    if (action?.type === 'exitFocusMode') {
      if (!action.scopeId || action.scopeId === focusModeScopeId) focusModeScopeId = null;
    }
    for (const listener of listeners) listener();
  });

  return {
    get focusModeScopeId() {
      return focusModeScopeId;
    },
    setFocusModeScopeId(next: string | null) {
      focusModeScopeId = next;
      for (const listener of listeners) listener();
    },
    reset() {
      focusModeScopeId = null;
      dispatch.mockClear();
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    useContextValue() {
      return React.useSyncExternalStore(
        (listener) => mockAppPaneStore.subscribe(listener),
        () => mockAppPaneStore.focusModeScopeId,
        () => mockAppPaneStore.focusModeScopeId,
      );
    },
    dispatch,
  };
})();

vi.mock('@/auth/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock('./SidebarView', () => ({
  SidebarView: () => React.createElement('SidebarView', {}, null),
}));

vi.mock('./CollapsedSidebarView', () => ({
  CollapsedSidebarView: (props: any) =>
    React.createElement(
      'CollapsedSidebarView',
      props,
      React.createElement('Pressable', {
        testID: 'collapsed-sidebar-home-button',
        onPress: () => props.onExitFocusMode?.(),
      }),
      React.createElement(
        'Pressable',
        {
          testID: 'sidebar-expand-button',
          onPress: () => props.onRequestExpand?.() ?? mockLocalSettingsStore.setSidebarCollapsed(false),
        },
        React.createElement('SidebarExpandIcon', {}, null)
      )
    ),
}));

vi.mock('./SidebarIcons', () => ({
  SidebarExpandIcon: (props: any) => React.createElement('SidebarExpandIcon', props, null),
  SidebarCollapseIcon: (props: any) => React.createElement('SidebarCollapseIcon', props, null),
}));

function getSidebar(tree: renderer.ReactTestRenderer) {
  return tree.root.findByProps({ testID: 'navigation-sidebar' });
}

function getResizableSidebarPane(tree: renderer.ReactTestRenderer) {
  return tree.find((node) => {
    return typeof node.props?.onCommitWidthPx === 'function' && node.props?.minWidthPx === 250;
  });
}

describe('SidebarNavigator (collapsed sidebar)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      mockLocalSettingsStore.setSidebarCollapsed(false);
      mockLocalSettingsStore.setSidebarWidthPx(320);
      mockLocalSettingsStore.setSidebarWidthBasisPx(1200);
      mockAppPaneStore.reset();
    });
    hoistedState.mockPlatformOS = 'web';
    hoistedState.mockWindowDimensions = { width: 1000, height: 800 };
    hoistedState.mockPathname = '/';
    hoistedState.mockSegments = ['(app)'];
    hoistedState.routerReplaceMock.mockReset();
  });

  it.each(['web', 'ios'] as const)('preserves the mounted navigator across responsive layouts on %s', async (platform) => {
    hoistedState.mockPlatformOS = platform;
    hoistedState.mockWindowDimensions = { width: 1280, height: 577 };
    const { SidebarNavigator } = await import('./SidebarNavigator');
    const { Stack } = await import('expo-router');
    const screen = await renderScreen(<SidebarNavigator />);
    const navigator = screen.tree.findByType(Stack);
    for (const dimensions of [{ width: 1440, height: 1007 }, { width: 1280, height: 577 }]) {
      await act(async () => {
        hoistedState.mockWindowDimensions = dimensions;
        for (const listener of hoistedState.dimensionListeners) listener();
      });
      expect(screen.tree.findByType(Stack) === navigator).toBe(true);
    }
  });

  it('preserves the navigator while onboarding owns and releases the viewport', async () => {
    const { SidebarNavigator } = await import('./SidebarNavigator');
    const { Stack } = await import('expo-router');
    const { beginOnboardingJourneySession, endOnboardingJourneySession } = await import('@/components/onboarding/tour/state/journeySession');
    const screen = await renderScreen(<SidebarNavigator />);
    const navigator = screen.tree.findByType(Stack);
    try {
      await act(async () => { beginOnboardingJourneySession(); });
      expect(screen.tree.findAllByProps({ testID: 'navigation-sidebar' })).toHaveLength(0);
      expect(screen.tree.findByType(Stack) === navigator).toBe(true);
    } finally {
      await act(async () => { endOnboardingJourneySession(); });
    }
    expect(screen.findByTestId('navigation-sidebar')).toBeTruthy();
    expect(screen.tree.findByType(Stack) === navigator).toBe(true);
  });

  it('keeps public setup routes free of sidebar chrome', async () => {
    hoistedState.mockPathname = '/setup';
    hoistedState.mockSegments = ['(app)', 'setup'];
    const { SidebarNavigator } = await import('./SidebarNavigator');
    const { Stack } = await import('expo-router');
    const screen = await renderScreen(<SidebarNavigator />);
    expect(screen.tree.findByType(Stack)).toBeDefined();
    expect(screen.tree.findAllByProps({ testID: 'navigation-sidebar' })).toHaveLength(0);
  });

  it('keeps the dedicated activity overlay transparent and free of sidebar chrome', async () => {
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('window', { location: { href: 'http://localhost/desktop/activity-overlay' } });
    const addEventListener = vi.fn();
    vi.stubGlobal('document', { addEventListener, removeEventListener: vi.fn() });
    const { SidebarNavigator } = await import('./SidebarNavigator');
    const { Stack } = await import('expo-router');
    const { StyleSheet } = await import('react-native');
    const screen = await renderScreen(<SidebarNavigator />);
    expect(screen.tree.findAllByProps({ testID: 'navigation-sidebar' })).toHaveLength(0);
    expect(screen.tree.findByType(Stack).props.screenOptions.contentStyle.backgroundColor).toBe('transparent');
    const surface = screen.findByTestId('desktop-main-content-drag-surface');
    expect(surface).toBeTruthy();
    expect(StyleSheet.flatten(surface?.props.style)?.backgroundColor).toBeUndefined();
    expect(addEventListener).not.toHaveBeenCalledWith('mousedown', expect.any(Function), true);
  });

  it('stops wheel propagation on web so sidebar scrolling is not blocked by document scroll-lock listeners', async () => {
    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<SidebarNavigator />);
    });

    const wheelBoundary = tree.root.find((node) => {
      return (node.type as any) === 'View' && typeof (node.props as any)?.onWheel === 'function';
    });

    const stopPropagation = vi.fn();
    wheelBoundary.props.onWheel({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('uses a collapsed sidebar width when sidebarCollapsed is true', async () => {
    act(() => {
      mockLocalSettingsStore.setSidebarCollapsed(true);
    });

    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<SidebarNavigator />);
    });

    const sidebar = getSidebar(tree);
    expect(sidebar.props.style.width).toBe(72);
  });

  it('enables the permanent sidebar when min edge is at least 600px', async () => {
    hoistedState.mockWindowDimensions = { width: 800, height: 600 };

    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    const sidebar = getSidebar(tree);
    expect(sidebar.props.style.width).toBeGreaterThan(0);
  });

  it('hides the permanent sidebar when min edge is below 600px (e.g. landscape phone)', async () => {
    hoistedState.mockWindowDimensions = { width: 812, height: 375 };

    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    expect(tree.findAllByProps({ testID: 'navigation-sidebar' })).toHaveLength(0);
  });

  it('keeps the full sidebar when resized down to the minimum width', async () => {
    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    expect(mockLocalSettingsStore.sidebarCollapsed).toBe(false);
    const resizablePane = getResizableSidebarPane(tree);

    await act(async () => {
      resizablePane.props.onDragWidthPx(250, {
        attemptedSizePx: 250,
        clampedSizePx: 250,
        exceededMinPx: false,
        exceededMaxPx: false,
      });
      resizablePane.props.onCommitWidthPx(250, {
        attemptedSizePx: 250,
        clampedSizePx: 250,
        exceededMinPx: false,
        exceededMaxPx: false,
      });
    });

    expect(mockLocalSettingsStore.sidebarCollapsed).toBe(false);
    expect(mockLocalSettingsStore.sidebarWidthPx).toBe(250);

    const sidebar = getSidebar(tree);
    expect(sidebar.props.style.width).toBe(250);
  });

  it('collapses into compact view when resized narrower again from the minimum width', async () => {
    act(() => {
      mockLocalSettingsStore.setSidebarWidthPx(250);
      mockLocalSettingsStore.setSidebarWidthBasisPx(1000);
    });

    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    const resizablePane = getResizableSidebarPane(tree);

    await act(async () => {
      resizablePane.props.onDragWidthPx(250, {
        attemptedSizePx: 200,
        clampedSizePx: 250,
        exceededMinPx: true,
        exceededMaxPx: false,
      });
    });

    expect(mockLocalSettingsStore.sidebarCollapsed).toBe(true);

    const sidebar = getSidebar(tree);
    expect(sidebar.props.style.width).toBe(72);
  });

  it('renders the expand icon button in collapsed sidebar on desktop', async () => {
    act(() => {
      mockLocalSettingsStore.setSidebarCollapsed(true);
    });
    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    // CollapsedSidebarView is mocked here, so this can only pin the navigator's own wiring: that
    // the collapsed rail mounts with its two affordances. Which GLYPH the expand button draws is a
    // contract of the real component, covered in SidebarIcons.test.tsx and the collapsed-view test.
    expect(tree.findByProps({ testID: 'sidebar-expand-button' })).toBeDefined();
    expect(tree.findByProps({ testID: 'collapsed-sidebar-home-button' })).toBeDefined();
  });

  it('clears scoped focus mode when the current route no longer matches the focused pane scope', async () => {
    hoistedState.mockPathname = '/settings';
    act(() => {
      mockAppPaneStore.setFocusModeScopeId('session:s1');
    });
    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    expect(mockAppPaneStore.dispatch).toHaveBeenCalledWith({
      type: 'exitFocusMode',
      scopeId: 'session:s1',
    });
    const sidebar = getSidebar(tree);
    expect(sidebar.props.style.width).toBeGreaterThan(72);
  });

  it('can collapse again on the first resize attempt after expanding from compact view', async () => {
    act(() => {
      mockLocalSettingsStore.setSidebarWidthPx(250);
      mockLocalSettingsStore.setSidebarWidthBasisPx(1000);
    });

    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    let resizablePane = getResizableSidebarPane(tree);
    let onDragWidthPx = resizablePane.props.onDragWidthPx;

    await act(async () => {
      onDragWidthPx(250, {
        attemptedSizePx: 200,
        clampedSizePx: 250,
        exceededMinPx: true,
        exceededMaxPx: false,
      });
    });

    expect(mockLocalSettingsStore.sidebarCollapsed).toBe(true);

    await act(async () => {
      onDragWidthPx(null, null);
    });

    const expandButton = tree.findByProps({ testID: 'sidebar-expand-button' });
    await act(async () => {
      await pressTestInstanceAsync(expandButton);
    });

    expect(mockLocalSettingsStore.sidebarCollapsed).toBe(false);

    resizablePane = getResizableSidebarPane(tree);
    onDragWidthPx = resizablePane.props.onDragWidthPx;
    await act(async () => {
      onDragWidthPx(250, {
        attemptedSizePx: 200,
        clampedSizePx: 250,
        exceededMinPx: true,
        exceededMaxPx: false,
      });
    });

    expect(mockLocalSettingsStore.sidebarCollapsed).toBe(true);
  });

  it('uses the collapsed permanent sidebar when scoped focus mode toggles without remounting', async () => {
    hoistedState.mockPathname = '/session/s1';
    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    tree = (await renderScreen(<SidebarNavigator />)).tree;

    const { Stack } = await import('expo-router');
    const navigator = tree.root.findByType(Stack);

    const sidebarBefore = getSidebar(tree);
    expect(sidebarBefore.props.style.width).toBeGreaterThan(0);

    await act(async () => {
      mockAppPaneStore.setFocusModeScopeId('session:s1');
    });

    // No remount: toggling focus should not reset session/details state.
    expect(tree.root.findByType(Stack) === navigator).toBe(true);

    const sidebarAfter = getSidebar(tree);
    expect(sidebarAfter).toBeDefined();
    expect(sidebarAfter.props.style.width).toBe(72);
    expect(sidebarAfter.findByType('CollapsedSidebarView' as any).props.focusModeActive).toBe(true);

    const expandButton = tree.findByProps({ testID: 'sidebar-expand-button' });
    await act(async () => {
      await pressTestInstanceAsync(expandButton);
    });

    expect(mockAppPaneStore.dispatch).toHaveBeenCalledWith({ type: 'exitFocusMode' });
    expect(mockLocalSettingsStore.sidebarCollapsed).toBe(false);
  });

  it('keeps the route navigator mounted with hidden chrome on terminal-connect desktop web routes', async () => {
    hoistedState.mockPathname = '/terminal/connect';
    hoistedState.mockSegments = ['(app)', 'terminal', 'connect'];

    const { SidebarNavigator } = await import('./SidebarNavigator');
    let tree!: renderer.ReactTestRenderer;

    await act(async () => {
      tree = renderer.create(<SidebarNavigator />);
    });

    const { Stack } = await import('expo-router');
    const navigator = tree.root.findByType(Stack);

    expect(navigator).toBeDefined();
    expect(tree.root.findAllByProps({ testID: 'navigation-sidebar' })).toHaveLength(0);
    expect(tree.root.findAllByType('SidebarView' as any)).toHaveLength(0);
    expect(tree.root.findAllByType('CollapsedSidebarView' as any)).toHaveLength(0);

  });
});
