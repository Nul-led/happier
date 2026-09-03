import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                    Platform: {
                        OS: 'web',
                    },
                    View: 'View',
                    Text: 'Text',
                    ActivityIndicator: 'ActivityIndicator',
                    Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
                }
    );
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

describe('RoundButton', () => {
    it('forwards the press event to modifier-aware actions', async () => {
        const { RoundButton } = await import('./RoundButton');
        const onPress = vi.fn();
        const event = { nativeEvent: { metaKey: true } };
        const screen = await renderScreen(<RoundButton title="New session" testID="round-button" onPress={onPress} />);

        screen.findByTestId('round-button')?.props.onPress(event);

        expect(onPress).toHaveBeenCalledWith(event);
    });

    it('forwards testID to the Pressable', async () => {
        const { RoundButton } = await import('./RoundButton');
        const screen = await renderScreen(<RoundButton title="Hello" testID="round-button" />);
        const pressable = screen.findByTestId('round-button');
        if (!pressable) {
            throw new Error('Expected round button pressable to render');
        }
        expect(pressable.props.testID).toBe('round-button');
        expect(pressable.findByType('LinearGradient' as never).props.colors).toEqual(['#000000', '#020202']);
    });

    it('applies a reduced effective opacity when disabled', async () => {
        const { RoundButton } = await import('./RoundButton');
        const screen = await renderScreen(<RoundButton title="Disabled" disabled={true} testID="disabled-round-button" />);
        const pressable = screen.findByTestId('disabled-round-button');
        if (!pressable) {
            throw new Error('Expected disabled round button pressable to render');
        }
        const styleOutput = pressable.props.style({ pressed: false });
        const flattened = Array.isArray(styleOutput)
            ? styleOutput.reduce((acc: Record<string, unknown>, next: Record<string, unknown> | null | undefined) => ({ ...acc, ...(next ?? {}) }), {})
            : (styleOutput ?? {});
        expect(flattened.opacity).toBe(0.35);
    });

    it('keeps labels single-line by default and allows a bounded multiline opt-in', async () => {
        const { RoundButton } = await import('./RoundButton');
        const defaultScreen = await renderScreen(<RoundButton title="Default label" testID="default-round-button" />);
        const multilineScreen = await renderScreen(
            <RoundButton
                title="Mirror workspace and allow destination-only files to be removed"
                titleNumberOfLines={2}
                testID="multiline-round-button"
            />,
        );

        const defaultLabel = defaultScreen.tree.root.find((node) => node.props.children === 'Default label');
        const multilineLabel = multilineScreen.tree.root.find((node) => (
            node.props.children === 'Mirror workspace and allow destination-only files to be removed'
        ));

        expect(defaultLabel.props.numberOfLines).toBe(1);
        expect(multilineLabel.props.numberOfLines).toBe(2);
    });

    it('lets a consequence-bearing label wrap completely instead of truncating at a line cap', async () => {
        const { RoundButton } = await import('./RoundButton');
        // Long enough that a two-line cap truncates it at the narrow widths and large
        // text sizes this action is confirmed at.
        const label = 'Mirror workspace and allow destination-only files to be permanently removed';
        const screen = await renderScreen(
            <RoundButton
                title={label}
                titleNumberOfLines="complete"
                accessibilityLabel={label}
                testID="complete-round-button"
            />,
        );

        const completeLabel = screen.tree.root.find((node) => node.props.children === label);
        expect(completeLabel.props.numberOfLines).toBeUndefined();
        // The full sentence stays the accessible name, not a shortened stand-in.
        expect(screen.findByTestId('complete-round-button')?.props.accessibilityLabel).toBe(label);
    });

    it('centres a wrapping label without disturbing the single-line default', async () => {
        const { RoundButton } = await import('./RoundButton');
        const defaultScreen = await renderScreen(<RoundButton title="Short" testID="single" />);
        const wrappedScreen = await renderScreen(
            <RoundButton title="A much longer destructive confirmation" titleNumberOfLines="complete" testID="wrapped" />,
        );

        const flatten = (style: unknown): Record<string, unknown> => (Array.isArray(style)
            ? style.reduce((acc: Record<string, unknown>, next) => ({ ...acc, ...(flatten(next)) }), {})
            : ((style as Record<string, unknown> | null | undefined) ?? {}));

        const defaultLabel = defaultScreen.tree.root.find((node) => node.props.children === 'Short');
        const wrappedLabel = wrappedScreen.tree.root.find((node) => (
            node.props.children === 'A much longer destructive confirmation'
        ));

        expect(flatten(defaultLabel.props.style).textAlign).toBeUndefined();
        expect(flatten(wrappedLabel.props.style).textAlign).toBe('center');
    });
});
