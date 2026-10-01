import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installNavigationShellCommonModuleMocks } from './navigationShellTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerPushSpy = vi.hoisted(() => vi.fn());

// The Workflows destination's discovery reads the two canonical feature decisions.
const featureState = vi.hoisted(() => ({
    enabled: true,
}));

installNavigationShellCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key) => (key === 'workflows.openCollection' ? 'Open Workflows' : key),
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const expoRouterMock = createExpoRouterMock({
            router: { push: routerPushSpy },
            segments: [],
        });
        return expoRouterMock.module;
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSocketStatus: () => ({
                    status: 'connected',
                    lastConnectedAt: null,
                    lastDisconnectedAt: null,
                    lastError: null,
                    lastErrorAt: null,
                }),
                useSyncError: () => null,
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

vi.mock('@/components/ui/status/StatusDot', () => ({
    StatusDot: 'StatusDot',
}));

vi.mock('@/components/navigation/Header', () => ({
    Header: ({ headerLeft, headerRight, title }: any) =>
        React.createElement(
            'Header',
            null,
            headerLeft ? headerLeft() : null,
            title ?? null,
            headerRight ? headerRight() : null,
        ),
}));

vi.mock('@/components/updates/UpdatesPopoverButton', () => ({
    UpdatesPopoverButton: (props: Record<string, unknown>) => React.createElement('UpdatesPopoverButton', props),
}));

// Decisions keep their identity across renders, as the real owner's do.
const decisionCache = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/hooks/server/useFeatureDecision', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/hooks/server/useFeatureDecision')>()),
    useFeatureDecision: (featureId: string) => {
        // Only the two decisions the Workflows destination reads are steered here.
        if (featureId !== 'workflows' && featureId !== 'automations') return null;
        const key = `${featureId}:${featureState.enabled}`;
        if (!decisionCache.has(key)) {
            decisionCache.set(key, featureState.enabled
                ? { featureId, state: 'enabled', blockedBy: null, blockerCode: 'none', diagnostics: [], evaluatedAt: 0, scope: { scopeKind: 'runtime' } }
                : { featureId, state: 'disabled', blockedBy: 'server', blockerCode: 'feature_disabled', diagnostics: [], evaluatedAt: 0, scope: { scopeKind: 'runtime' } });
        }
        return decisionCache.get(key);
    },
}));

function findPressableByLabel(tree: renderer.ReactTestRenderer, label: string) {
    return tree.findByProps({ accessibilityLabel: label });
}

describe('HomeHeader Workflows button', () => {
    beforeEach(() => {
        routerPushSpy.mockReset();
        featureState.enabled = true;
    });

    it('shows the Workflows button next to the logo and opens the one Workflows destination', async () => {
        const { HomeHeader } = await import('./HomeHeader');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<HomeHeader />)).tree;

        const button = findPressableByLabel(tree!, 'Open Workflows');
        await act(async () => {
            await pressTestInstanceAsync(button);
        });

        expect(routerPushSpy).toHaveBeenCalledWith('/workflows');
    });

    it('hides the Workflows button when the server denies the destination', async () => {
        featureState.enabled = false;
        const { HomeHeader } = await import('./HomeHeader');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<HomeHeader />)).tree;

        expect(() => findPressableByLabel(tree!, 'Open Workflows')).toThrow();
    });

    it('opens an explicit ordinary-entry draft route from the header action', async () => {
        const { HomeHeader } = await import('./HomeHeader');
        const tree = (await renderScreen(<HomeHeader />)).tree;

        tree.findByProps({ testID: 'home-header-start-new-session' }).props.onPress({
            nativeEvent: { ctrlKey: true },
        });

        expect(routerPushSpy).toHaveBeenCalledWith({
            pathname: '/new',
            params: {
                draftId: expect.any(String),
                draftOrigin: 'ordinary',
            },
        });
    });

    it('keeps the logo in the mobile header slot while there is nothing to update', async () => {
        const { HomeHeader } = await import('./HomeHeader');

        const screen = await renderScreen(<HomeHeader />);

        // No provider in this render: the shared summary is empty, so the logo stays.
        expect(screen.tree.findAllByType('UpdatesPopoverButton' as never)).toHaveLength(0);
    });
});
