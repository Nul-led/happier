import * as React from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const hydrateSessionSpy = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const routerMock = createExpoRouterMock({ params: {} });

vi.mock('expo-router', () => ({
    ...routerMock.module,
    useLocalSearchParams: () => routeParams.current,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        ActivityIndicator: 'ActivityIndicator',
        Platform: { OS: 'web', select: (spec: Record<string, unknown>) => spec.web ?? spec.default },
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

// The contracted route must never hydrate: the Session root owns exact-scope
// hydration and unavailable handling.
vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: hydrateSessionSpy,
}));

vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({ useIsDataReady: () => true }));

describe('legacy session sharing route', () => {
    beforeEach(() => {
        hydrateSessionSpy.mockClear();
        routerMock.spies.replace.mockClear();
        routerMock.spies.push.mockClear();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('replaces an exact-Home deep link with the canonical Collaboration destination', async () => {
        routeParams.current = { id: ['s1', 's2'], serverId: 'home-b' };
        const { default: SharingRoute } = await import('@/app/(app)/session/[id]/sharing');

        await renderScreen(<SharingRoute />);

        expect(routerMock.spies.replace).toHaveBeenCalledWith('/session/s1?serverId=home-b&collaborationFocus=access&right=collaboration');
        expect(routerMock.spies.push).not.toHaveBeenCalled();
        expect(hydrateSessionSpy).not.toHaveBeenCalled();
    });

    it('keeps an unqualified released link unqualified so the Session root resolves its Home', async () => {
        routeParams.current = { id: 's1' };
        const { default: SharingRoute } = await import('@/app/(app)/session/[id]/sharing');

        await renderScreen(<SharingRoute />);

        expect(routerMock.spies.replace).toHaveBeenCalledWith('/session/s1?collaborationFocus=access&right=collaboration');
    });

    it('renders the invalid-link fallback without navigating for an unusable identifier', async () => {
        routeParams.current = { id: '   ' };
        const { default: SharingRoute } = await import('@/app/(app)/session/[id]/sharing');

        const screen = await renderScreen(<SharingRoute />);

        expect(routerMock.spies.replace).not.toHaveBeenCalled();
        expect(screen.findByTestId('session-invalid-link')).not.toBeNull();
    });
});
