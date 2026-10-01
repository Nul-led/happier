import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installUiListsCommonModuleMocks } from './uiListsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ROW_TEST_ID = 'item-a11y-actions';
const MARK_READ_ACTIONS = [{ name: 'markRead', label: 'Mark read' }] as const;

installUiListsCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Pressable: 'Pressable',
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'ios',
                select: (values: any) => values?.ios ?? values?.default,
            },
            AppState: {
                currentState: 'active',
                addEventListener: vi.fn(() => ({ remove: vi.fn() })),
            },
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock().module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key: string) => key });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock();
    },
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => {}) }));
/**
 * A row that owns a secondary native gesture (Inbox mark-read is the current
 * consumer) needs that action announced on the row itself, because the row is
 * the only thing a screen reader focuses. The action therefore has to reach the
 * same Pressable that owns activation — in either composition, so a row does not
 * silently lose its action by gaining a right accessory.
 */
describe('Item (row accessibility actions)', () => {
    it('forwards row accessibility actions to the activation owner', async () => {
        const onAccessibilityAction = vi.fn();
        const { Item } = await import('./Item');

        const screen = await renderScreen(
            <Item
                testID={ROW_TEST_ID}
                title="Row"
                onPress={() => {}}
                accessibilityActions={[...MARK_READ_ACTIONS]}
                onAccessibilityAction={onAccessibilityAction}
            />,
        );

        const pressable = screen.findByTestId(ROW_TEST_ID)!;
        expect(pressable.props.accessibilityActions).toEqual([...MARK_READ_ACTIONS]);
        pressable.props.onAccessibilityAction({ nativeEvent: { actionName: 'markRead' } });
        expect(onAccessibilityAction).toHaveBeenCalledOnce();
    });

    it('keeps them on the row pressable when the accessory renders outside it', async () => {
        const onAccessibilityAction = vi.fn();
        const { Item } = await import('./Item');

        const screen = await renderScreen(
            <Item
                testID={ROW_TEST_ID}
                title="Row"
                onPress={() => {}}
                rightElement={React.createElement('View', { testID: 'accessory' })}
                rightElementOutsidePressable
                accessibilityActions={[...MARK_READ_ACTIONS]}
                onAccessibilityAction={onAccessibilityAction}
            />,
        );

        const pressable = screen.findByTestId(ROW_TEST_ID)!;
        expect(pressable.props.accessibilityActions).toEqual([...MARK_READ_ACTIONS]);
        pressable.props.onAccessibilityAction({ nativeEvent: { actionName: 'markRead' } });
        expect(onAccessibilityAction).toHaveBeenCalledOnce();
    });
});
