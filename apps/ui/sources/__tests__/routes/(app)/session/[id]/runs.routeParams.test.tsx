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

// The retired Runs list must never hydrate or list runs: the Session root owns exact-scope hydration,
// and the one Agents roster owns the list.
vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: hydrateSessionSpy,
}));

vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({ useIsDataReady: () => true }));

describe('retired session Runs route', () => {
    beforeEach(() => {
        hydrateSessionSpy.mockClear();
        routerMock.spies.replace.mockClear();
        routerMock.spies.push.mockClear();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('replaces an exact-Home link with the one Agents roster instead of a second run list', async () => {
        routeParams.current = { id: 's1', serverId: 'home-b' };
        const { default: RunsRoute } = await import('@/app/(app)/session/[id]/runs');

        const screen = await renderScreen(<RunsRoute />);

        expect(routerMock.spies.replace).toHaveBeenCalledWith('/session/s1?serverId=home-b&right=agents');
        expect(routerMock.spies.push).not.toHaveBeenCalled();
        expect(hydrateSessionSpy).not.toHaveBeenCalled();
        expect(screen.findByTestId('session-runs-screen')).toBeNull();
    });

    it('keeps an unqualified link unqualified so the Session root resolves its Home', async () => {
        routeParams.current = { id: 's1' };
        const { default: RunsRoute } = await import('@/app/(app)/session/[id]/runs');

        await renderScreen(<RunsRoute />);

        expect(routerMock.spies.replace).toHaveBeenCalledWith('/session/s1?right=agents');
    });

    it('renders the invalid-link fallback without navigating for an unusable identifier', async () => {
        routeParams.current = { id: '   ' };
        const { default: RunsRoute } = await import('@/app/(app)/session/[id]/runs');

        const screen = await renderScreen(<RunsRoute />);

        expect(routerMock.spies.replace).not.toHaveBeenCalled();
        expect(screen.findByTestId('session-invalid-link')).not.toBeNull();
    });
});
