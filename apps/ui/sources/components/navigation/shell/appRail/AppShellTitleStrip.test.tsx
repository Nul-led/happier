import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { installNavigationShellCommonModuleMocks } from '../navigationShellTestHelpers';

const router = vi.hoisted(() => ({ navigate: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }));

installNavigationShellCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ pathname: () => '/settings/appearance', router }).module;
    },
});

vi.mock('@/components/inbox/actionOperations/ActionOperationActivityButton', () => ({
    ActionOperationActivityButton: () => null,
}));

afterEach(() => {
    standardCleanup();
    router.navigate.mockReset();
    router.push.mockReset();
});

describe('AppShellTitleStrip', () => {
    it('uses workspace availability and actions for the shell history controls', async () => {
        const navigation = { canGoBack: true, canGoForward: true, back: vi.fn(), forward: vi.fn(), openHref: vi.fn() };
        const { AppShellTitleStrip } = await import('./AppShellTitleStrip');
        const screen = await renderScreen(
            <AppShellTitleStrip columnVisible columnToggleAvailable onToggleColumn={() => {}} navigation={navigation} />,
        );
        expect(screen.findByTestId('app-shell-back').props.disabled).toBe(false);
        expect(screen.findByTestId('app-shell-forward').props.disabled).toBe(false);
        await screen.pressByTestIdAsync('app-shell-back');
        await screen.pressByTestIdAsync('app-shell-forward');
        await screen.pressByTestIdAsync('app-shell-logo');
        expect(navigation.back).toHaveBeenCalledOnce();
        expect(navigation.forward).toHaveBeenCalledOnce();
        expect(navigation.openHref).toHaveBeenCalledWith('/');
        expect(router.push).not.toHaveBeenCalled();
    });
    it('leads with the Happier logo, which opens the home screen, then back, forward and the column toggle', async () => {
        const { AppShellTitleStrip } = await import('./AppShellTitleStrip');
        const screen = await renderScreen(
            <AppShellTitleStrip columnVisible columnToggleAvailable onToggleColumn={() => {}} />,
        );
        const order = ['app-shell-logo', 'app-shell-back', 'app-shell-forward', 'app-shell-column-toggle'];
        const rendered = screen.root
            .findAll((node) => typeof node.props?.testID === 'string' && order.includes(node.props.testID))
            .map((node) => node.props.testID as string)
            .filter((id, index, all) => all.indexOf(id) === index);
        expect(rendered).toEqual(order);

        await screen.pressByTestIdAsync('app-shell-logo');
        const opened = [...router.navigate.mock.calls, ...router.push.mock.calls].map((call) => call[0]);
        expect(opened).toEqual(['/']);
    });
});
