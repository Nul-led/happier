import * as React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { installSettingsViewCommonModuleMocks } from '@/components/settings/settingsViewTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The navigator is the boundary: the screen's navigation object, through the canonical router mock.
const setOptions = vi.fn();
// A settings collection's detail stack hides its own header; the visible one is its parent's.
const parentSetOptions = vi.fn();
const router = createExpoRouterMock();
installSettingsViewCommonModuleMocks({ router: () => router.module });

const { PageHeader, NavigationTitleChromeProvider } = await import('@/components/ui/layout/PageHeader');

beforeEach(() => {
    setOptions.mockReset();
    parentSetOptions.mockReset();
});

function header(nativeTitle: boolean, onPress: () => void, inNavigator = true) {
    const page = (
        <NavigationTitleChromeProvider showsTitle={nativeTitle}>
            <PageHeader
                testID="pool-header"
                title="New machine pool"
                description="Sessions try the preferred machine first."
                primaryAction={{ title: 'Create pool', onPress, testID: 'pool-create' }}
                actions={React.createElement('Chip')}
            />
        </NavigationTitleChromeProvider>
    );
    (router.state as { navigation: unknown }).navigation = inNavigator
        ? { setOptions, getParent: () => ({ setOptions: parentSetOptions }) }
        : null;
    return page;
}

function lastHeaderRight(): ReactTestInstance | null {
    const options = setOptions.mock.calls.map((call) => call[0] as { headerRight?: () => React.ReactNode }).filter((o) => 'headerRight' in o);
    const render = options.at(-1)?.headerRight;
    return render ? (render() as unknown as ReactTestInstance) : null;
}

describe('PageHeader primary action placement', () => {
    it('keeps the primary action in the page on wide layouts and leaves the native header alone', async () => {
        const onPress = vi.fn();
        const screen = await renderScreen(header(false, onPress));
        expect(screen.findHostByTestId('pool-create')).not.toBeNull();
        expect(setOptions.mock.calls.some((call) => (call[0] as { headerRight?: unknown }).headerRight)).toBe(false);
        await screen.pressByTestIdAsync('pool-create');
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('hands the primary action to the native header on phones instead of stacking it under the purpose', async () => {
        const onPress = vi.fn();
        const screen = await renderScreen(header(true, onPress));
        // Not in the page body.
        expect(screen.findHostByTestId('pool-create')).toBeNull();
        // In the native header, working.
        const headerRight = lastHeaderRight();
        expect(headerRight).not.toBeNull();
        const inHeader = await renderScreen(headerRight as unknown as React.ReactElement);
        await inHeader.pressByTestIdAsync('pool-create');
        expect(onPress).toHaveBeenCalledTimes(1);
        // The parent's (visible) header gets it too.
        expect(parentSetOptions.mock.calls.some((call) => typeof (call[0] as { headerRight?: unknown }).headerRight === 'function')).toBe(true);
        // Context controls stay in the page.
        expect(screen.root.findAllByType('Chip' as never)).toHaveLength(1);
    });

    it('renders outside any navigator (a preview, a plugin host) without a header to fill', async () => {
        const screen = await renderScreen(header(true, vi.fn(), false));
        expect(screen.findHostByTestId('pool-header')).not.toBeNull();
        expect(setOptions).not.toHaveBeenCalled();
    });

    it('clears the native header action when the page leaves', async () => {
        const screen = await renderScreen(header(true, vi.fn()));
        act(() => screen.tree.unmount());
        const last = setOptions.mock.calls.at(-1)?.[0] as { headerRight?: unknown };
        expect(last && 'headerRight' in last && last.headerRight === undefined).toBe(true);
    });
});
