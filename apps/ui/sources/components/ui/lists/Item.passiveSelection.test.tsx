import * as React from 'react';
import { StyleSheet } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installUiListsCommonModuleMocks } from './uiListsTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installUiListsCommonModuleMocks();

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const { Item } = await import('./Item');

function rowBackground(screen: Awaited<ReturnType<typeof renderScreen>>, testID: string): unknown {
    const host = screen.findHostByTestId(testID);
    return (StyleSheet.flatten(host?.props.style) as { backgroundColor?: unknown } | undefined)?.backgroundColor;
}

describe('Item selection without an action', () => {
    it('keeps the selected mark on a row that cannot be pressed right now (a read-only or unavailable choice)', async () => {
        const screen = await renderScreen(
            <>
                <Item testID="chosen" title="Admins create Teams" selected disabled showChevron={false} />
                <Item testID="other" title="Anyone can create Teams" selected={false} disabled showChevron={false} />
            </>,
        );
        const chosen = rowBackground(screen, 'chosen');
        expect(chosen).toBeTruthy();
        expect(chosen).not.toBe('transparent');
        expect(rowBackground(screen, 'other') ?? 'transparent').toBe('transparent');
    });
});
