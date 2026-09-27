import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installFormsCommonModuleMocks } from './formsTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installFormsCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock();
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock();
    },
});

const inputFocus = vi.hoisted(() => ({ calls: 0 }));

// The app `TextInput` adds font scaling (a settings boundary); the host input's focus handle is what
// the field's frame drives.
vi.mock('@/components/ui/text/Text', () => ({
    TextInput: React.forwardRef((props: Record<string, unknown>, ref) => {
        React.useImperativeHandle(ref, () => ({ focus: () => { inputFocus.calls += 1; } }), []);
        return React.createElement('TextInput', props);
    }),
}));

vi.mock('@/components/ui/icons/Icon', () => ({
    Icon: () => null,
    ICON_SIZE: { xs: 14 },
}));

describe('CompactSearchField', () => {
    it('runs an explicit search on submit and stays read-only while the list cannot be searched', async () => {
        const onSubmit = vi.fn();
        const { CompactSearchField } = await import('./CompactSearchField');
        const screen = await renderScreen(
            <CompactSearchField
                testID="search"
                value="triage"
                onChangeText={() => {}}
                placeholder="Search every source"
                onSubmitEditing={onSubmit}
                editable={false}
            />,
        );
        const input = screen.tree.root.findByType('TextInput' as never);
        expect(input.props.editable).toBe(false);
        expect(input.props.returnKeyType).toBe('search');
        await act(async () => {
            (input.props.onSubmitEditing as () => void)();
        });
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('filters as the user types when no explicit search is wired', async () => {
        const { CompactSearchField } = await import('./CompactSearchField');
        const screen = await renderScreen(
            <CompactSearchField testID="search" value="" onChangeText={() => {}} placeholder="Search" />,
        );
        const input = screen.tree.root.findByType('TextInput' as never);
        expect(input.props.returnKeyType).toBeUndefined();
        expect(input.props.onSubmitEditing).toBeUndefined();
    });

    it('leaves keyboard focus to the input: the frame around it is not a tab stop', async () => {
        // On web a Pressable is a tab stop by default; a focused frame shows the browser's ring and no
        // caret, and a dialog's initial focus would land on it instead of the input.
        const { CompactSearchField } = await import('./CompactSearchField');
        const screen = await renderScreen(
            <CompactSearchField testID="search" value="" onChangeText={() => {}} placeholder="Search" />,
        );
        const frame = screen.findByTestId('search.field');
        expect(frame?.props.tabIndex).toBe(-1);
    });

    it('focuses the input when the field around it is tapped (icon, padding, border)', async () => {
        inputFocus.calls = 0;
        const { CompactSearchField } = await import('./CompactSearchField');
        const screen = await renderScreen(
            <CompactSearchField testID="search" value="" onChangeText={() => {}} placeholder="Search" />,
        );
        const frame = screen.findByTestId('search.field');
        if (!frame) throw new Error('Missing search field frame');
        await act(async () => {
            (frame.props.onPress as () => void)();
        });
        expect(inputFocus.calls).toBe(1);
        // The frame is not a second control for assistive technology or the keyboard.
        expect(frame.props.accessible).toBe(false);
        expect(frame.props.focusable).toBe(false);
    });

    it('takes the native touch floor on phones and keeps pointer density on web', async () => {
        const { HappierUiPlatformProvider } = await import('@happier-dev/plugin-ui/environment');
        const { CompactSearchField } = await import('./CompactSearchField');
        const { flattenTestStyle } = await import('@/dev/testkit');
        const minHeightOn = async (platform: 'ios' | 'android' | 'web') => {
            const screen = await renderScreen(
                <HappierUiPlatformProvider platform={{ platform, colorScheme: 'light' }}>
                    <CompactSearchField testID="search" value="" onChangeText={() => {}} placeholder="Search" />
                </HappierUiPlatformProvider>,
            );
            const value = flattenTestStyle(screen.findByTestId('search.field')!.props.style).minHeight;
            await screen.unmount();
            return value;
        };
        expect(await minHeightOn('ios')).toBe(44);
        expect(await minHeightOn('android')).toBe(48);
        expect(await minHeightOn('web')).toBeUndefined();
    });
});
