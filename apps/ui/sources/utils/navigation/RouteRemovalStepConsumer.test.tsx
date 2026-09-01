import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NavigationContext } from '@react-navigation/native';

import { renderScreen, standardCleanup } from '@/dev/testkit';

const removal = vi.hoisted(() => ({
    enabled: false,
    callback: null as null | ((event: Readonly<{ data: Readonly<{ action: unknown }> }>) => void),
}));

vi.mock('@react-navigation/native', async () => {
    const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
    return createReactNavigationNativeMock({
        usePreventRemove: (enabled, callback) => {
            removal.enabled = enabled;
            removal.callback = callback;
        },
    });
});

describe('RouteRemovalStepConsumer', () => {
    beforeEach(() => {
        removal.enabled = false;
        removal.callback = null;
    });

    afterEach(() => {
        standardCleanup();
    });

    it('redispatches a same-page replacement without spending the declared Back step', async () => {
        const dispatch = vi.fn();
        const consume = vi.fn(() => true);
        const replacement = {
            type: 'REPLACE',
            payload: { name: 'plugin-settings-page', params: { subPath: 'bindings/7' } },
        };
        const { RouteRemovalStepConsumer } = await import('./RouteRemovalStepConsumer');

        await renderScreen(
            <NavigationContext.Provider value={{ dispatch } as never}>
                <RouteRemovalStepConsumer active consume={consume} />
            </NavigationContext.Provider>,
        );
        expect(removal.enabled).toBe(true);

        await act(async () => {
            removal.callback?.({ data: { action: replacement } });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(consume).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith(replacement);
    });

    it('spends the declared step for an actual backward removal', async () => {
        const dispatch = vi.fn();
        const consume = vi.fn(() => true);
        const goBack = { type: 'GO_BACK' };
        const { RouteRemovalStepConsumer } = await import('./RouteRemovalStepConsumer');

        await renderScreen(
            <NavigationContext.Provider value={{ dispatch } as never}>
                <RouteRemovalStepConsumer active consume={consume} />
            </NavigationContext.Provider>,
        );

        await act(async () => {
            removal.callback?.({ data: { action: goBack } });
            await Promise.resolve();
        });

        expect(consume).toHaveBeenCalledOnce();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('redispatches a targeted stack dismissal without spending the page-local step', async () => {
        const dispatch = vi.fn();
        const consume = vi.fn(() => true);
        const dismissTo = { type: 'POP_TO', payload: { name: 'settings' } };
        const { RouteRemovalStepConsumer } = await import('./RouteRemovalStepConsumer');

        await renderScreen(
            <NavigationContext.Provider value={{ dispatch } as never}>
                <RouteRemovalStepConsumer active consume={consume} />
            </NavigationContext.Provider>,
        );

        await act(async () => {
            removal.callback?.({ data: { action: dismissTo } });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(consume).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith(dismissTo);
    });
});
