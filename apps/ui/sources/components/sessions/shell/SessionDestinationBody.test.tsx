import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { DestinationInstanceHost } from '@/components/appShell/workspace/DestinationInstanceHost';

// Native SDK/navigation boundaries only; Session, hydration, pane and activation owners stay real.
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 1400, height: 900 }) });
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ pathname: '/session/focused' }).module;
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 1400, height: 900 }),
}));

afterEach(standardCleanup);

describe('SessionDestinationBody workspace activation', () => {
    it('presents both visible panes while only the focused pane owns the route anchor across retention', async () => {
        const { storage } = await import('@/sync/domains/state/storageStore').catch((cause) => {
            throw new Error('Real Session fixture storage graph failed to import', { cause });
        });
        const { getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
        const { resetSessionSurfaceVisibilityForTests, getSessionSurfaceVisibilitySnapshot } = await import('@/sync/domains/session/sessionSurfaceVisibility');
        const { SessionDestinationBody } = await import('./SessionDestinationBody').catch((cause) => {
            throw new Error('Real SessionDestinationBody graph failed to import', { cause });
        });
        const { AppPaneProvider } = await import('@/components/appShell/panes/AppPaneProvider');
        const { InjectedAuthProvider } = await import('@/auth/context/AuthContext');
        const serverId = getActiveServerSnapshot().serverId;
        const previousState = storage.getState();
        resetSessionSurfaceVisibilityForTests();
        storage.getState().applySessions(['focused', 'companion'].map((id) => createSessionFixture({ id, serverId })));
        storage.setState({ settings: { ...storage.getState().settings, mobileWorkspaceExperienceV1: 'classic' } });
        try {
            const body = (companionVisible: boolean) => <InjectedAuthProvider credentials={null}><AppPaneProvider>
                {['focused', 'companion'].map((id) => <DestinationInstanceHost key={id} tabId={id}
                    ref={{ kind: 'session', params: { id, serverId } }} pathname={`/session/${id}`}
                    focused={id === 'focused'} visible={id === 'focused' || companionVisible}
                    navigation={{ push: () => {}, replace: () => {}, back: () => {} }}>
                    <SessionDestinationBody />
                </DestinationInstanceHost>)}
            </AppPaneProvider></InjectedAuthProvider>;
            const screen = await renderScreen(body(true));
            expect(getSessionSurfaceVisibilitySnapshot()).toMatchObject({
                focusedSessionId: 'focused', routeAnchorSessionId: 'focused', visibleSessionIds: ['focused', 'companion'],
            });
            expect(screen.findByTestId('session-view-retained-surface:companion')?.props.pointerEvents).toBe('auto');
            await screen.update(body(false));
            expect(getSessionSurfaceVisibilitySnapshot()).toMatchObject({
                focusedSessionId: 'focused', routeAnchorSessionId: 'focused', visibleSessionIds: ['focused'],
            });
            await screen.update(body(true));
            expect(getSessionSurfaceVisibilitySnapshot()).toMatchObject({
                focusedSessionId: 'focused', routeAnchorSessionId: 'focused', visibleSessionIds: ['focused', 'companion'],
            });
        } finally {
            await standardCleanup();
            storage.setState(previousState);
            resetSessionSurfaceVisibilityForTests();
        }
    });
});
