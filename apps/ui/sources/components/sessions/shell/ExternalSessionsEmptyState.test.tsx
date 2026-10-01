import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const routerPushSpy = vi.hoisted(() => vi.fn());

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: { push: routerPushSpy },
    }).module;
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useLocalSetting: () => undefined,
    });
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

describe('ExternalSessionsEmptyState', () => {
    beforeEach(() => {
        routerPushSpy.mockReset();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('offers the canonical Browse action from the external-session empty state', async () => {
        const { ExternalSessionsEmptyState } = await import('./ExternalSessionsEmptyState');
        const screen = await renderScreen(<ExternalSessionsEmptyState />);

        const browse = screen.findByTestId('direct-sessions-empty-state-browse');
        expect(browse).not.toBeNull();
        expect(browse?.props.accessibilityLabel).toBe('externalSessions.browseOpenExisting');

        await screen.pressByTestIdAsync('direct-sessions-empty-state-browse');

        expect(routerPushSpy).toHaveBeenCalledWith('/external/browse');
    });

    it('says it in one line inside the session list and keeps the page state for the main pane', async () => {
        const { ExternalSessionsEmptyState } = await import('./ExternalSessionsEmptyState');
        const rail = await renderScreen(<ExternalSessionsEmptyState surface="sidebar" />);
        expect(rail.findByTestId('direct-sessions-empty-state-line')).toBeTruthy();
        expect(rail.findByTestId('direct-sessions-empty-state-description')).toBeNull();
        await rail.pressByTestIdAsync('direct-sessions-empty-state-browse');
        expect(routerPushSpy).toHaveBeenCalledWith('/external/browse');
        await rail.unmount();

        const pane = await renderScreen(<ExternalSessionsEmptyState surface="primaryPane" />);
        expect(pane.findByTestId('direct-sessions-empty-state-line')).toBeNull();
        expect(pane.findByTestId('direct-sessions-empty-state-description')).toBeTruthy();
    });
});
