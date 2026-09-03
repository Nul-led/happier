import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installRootLayoutRouteCommonModuleMocks } from './rootLayoutRouteTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installRootLayoutRouteCommonModuleMocks();

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        refreshFromActiveServer: vi.fn(async () => {}),
    }),
}));

vi.mock('@/auth/routing/authRouting', () => ({
    isPublicRouteForUnauthenticated: () => false,
}));

vi.mock('@/hooks/server/useFriendsIdentityReadiness', () => ({
    useFriendsIdentityReadiness: () => ({ isReady: true }),
}));

vi.mock('@/hooks/server/useHappierVoiceSupport', () => ({
    useHappierVoiceSupport: () => true,
}));

vi.mock('@/components/navigation/mobile/chrome/MobileBottomChromeHost', () => ({
    MobileBottomChromeHost: () => React.createElement('MobileBottomChromeHost'),
}));

vi.mock('@/components/appShell/runtime/AuthenticatedAppRuntimeMounts', () => ({
    AuthenticatedAppRuntimeMounts: () => React.createElement('AuthenticatedAppRuntimeMounts'),
}));

vi.mock('@/desktop/window/isDesktopOverlayWindowContext', () => ({
    isDesktopOverlayWindowContext: () => false,
}));

vi.mock('@/components/onboarding/tour/state/journeySession', () => ({
    doesOnboardingJourneyOwnTransientDemoServer: (active: boolean) => active,
    useOnboardingJourneySessionActive: () => false,
}));

vi.mock('@/components/navigation/mobile/chrome/MainAppTabStateProvider', () => ({
    MainAppTabStateProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

afterEach(() => {
    vi.resetModules();
});

/**
 * The app stack is the one route-title owner. A route it does not register has
 * no title at all: the custom header renders an empty title bar and the native
 * header falls back to the raw route name, so every reachable Automation route
 * must be declared here rather than through a screen-local `Stack.Screen`.
 */
describe('RootLayout automation route titles', () => {
    it.each([
        'automations/index',
        'automations/[id]',
        'automations/new',
        'automations/edit',
        'automations/settings',
        'session/[id]/automations',
        'session/[id]/automations/new',
    ])('declares a central header title for %s', async (routeName) => {
        const RootLayout = (await import('@/app/(app)/_layout')).default;
        const screen = await renderScreen(<RootLayout />);

        const stackScreen = screen.tree.root
            .findAllByType('StackScreen' as never)
            .find((node) => (node.props as { name?: string }).name === routeName);
        expect(stackScreen, `Missing central Stack.Screen for ${routeName}`).toBeDefined();

        const rawOptions = (stackScreen!.props as { options?: unknown }).options;
        const options = (typeof rawOptions === 'function'
            ? (rawOptions as (params: Record<string, unknown>) => Record<string, unknown>)({ navigation: {} })
            : rawOptions ?? {}) as Record<string, unknown>;
        expect(typeof options.headerTitle === 'string' && options.headerTitle.length > 0).toBe(true);
    });
});
