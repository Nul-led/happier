import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSessionRouteCommonModuleMocks } from '../sessionRouteTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detailsViewSpy = vi.fn((_props: unknown) => null);
const routerReplaceSpy = vi.fn();
const stackScreenSpy = vi.fn((_props: unknown) => null);
let routeFocused = true;
let routeParams: { id: string; discussionId: string } = {
    id: 'session-1',
    discussionId: 'discussion-1',
};
let SessionDiscussionRouteScreen: typeof import('@/components/sessions/conversations/SessionDiscussionRouteScreen').SessionDiscussionRouteScreen;

installSessionRouteCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const navigation = { canGoBack: vi.fn(() => false) };
        const router = createExpoRouterMock({
            params: routeParams,
            navigation,
            router: {
                back: vi.fn(),
                push: vi.fn(),
                replace: routerReplaceSpy,
                setParams: vi.fn(),
            },
        });
        return {
            ...router.module,
            useLocalSearchParams: () => routeParams,
            useNavigation: () => navigation,
            Stack: { Screen: (props: unknown) => stackScreenSpy(props) },
        };
    },
});

vi.mock('@/components/workspaceCockpit/useMobileWorkspaceExperienceState', () => ({
    useMobileWorkspaceExperienceState: () => ({ cockpitEnabled: true }),
}));

vi.mock('@/hooks/session/sessionRouteServerScope', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/hooks/session/sessionRouteServerScope')>();
    return {
        ...original,
        createSessionRouteServerScope: () => ({
            serverId: null,
            candidateAddresses: [],
            hydrationOptions: undefined,
            withParams: <T extends Record<string, unknown>>(params: T) => params,
            buildHref: () => '/session/session-1',
        }),
    };
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: () => ({ kind: 'ready', serverId: 'home-hydrated' }),
}));

vi.mock('@/sync/domains/session/sessionRouteHydrationState', () => ({
    isSessionRouteHydrationAvailable: (value: { kind: string }) => value.kind === 'ready',
    isSessionRouteHydrationMissing: (value: { kind: string }) => value.kind === 'missing',
}));

// Navigation focus is the platform boundary: a standalone route that is pushed
// under another screen stays mounted but is no longer the visible surface.
vi.mock('@react-navigation/native', () => ({
    useIsFocused: () => routeFocused,
}));

vi.mock('@/components/sessions/conversations/SessionDiscussionDetailsView', () => ({
    SessionDiscussionDetailsView: (props: unknown) => detailsViewSpy(props),
}));

describe('SessionDiscussionRouteScreen', () => {
    beforeAll(async () => {
        ({ SessionDiscussionRouteScreen } = await import('@/components/sessions/conversations/SessionDiscussionRouteScreen'));
    }, 180_000);

    afterEach(() => {
        standardCleanup();
        detailsViewSpy.mockClear();
        routerReplaceSpy.mockClear();
        stackScreenSpy.mockClear();
        routeParams = { id: 'session-1', discussionId: 'discussion-1' };
        routeFocused = true;
    });

    it('mounts persisted discussion details against the exact Home resolved by hydration', async () => {
        await renderScreen(<SessionDiscussionRouteScreen kind="discussion" />);

        expect(detailsViewSpy).toHaveBeenCalledWith(expect.objectContaining({
            active: true,
            standaloneSurface: true,
            target: {
                kind: 'discussion',
                address: { serverId: 'home-hydrated', sessionId: 'session-1' },
                discussionId: 'discussion-1',
            },
        }));
    });

    it('is the visible Discussion surface only while the route is focused', async () => {
        routeFocused = false;
        await renderScreen(<SessionDiscussionRouteScreen kind="discussion" />);

        expect(detailsViewSpy).toHaveBeenLastCalledWith(expect.objectContaining({
            active: false,
            standaloneSurface: true,
        }));
    });
});
