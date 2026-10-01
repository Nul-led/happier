import * as React from 'react';
import { TextInput, View } from 'react-native';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: <T,>(options: { ios?: T; native?: T; default?: T; web?: T; android?: T }) =>
                options.ios ?? options.native ?? options.default ?? options.web ?? options.android,
        },
    });
});

vi.mock('expo-blur', () => ({
    BlurView: (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('BlurView', props, props.children),
}));

describe('SoftSlideTransitionFrame native blur', () => {
    it('preserves the outgoing native slide instance while it exits', async () => {
        const { SoftSlideTransitionFrame } = await import('./SoftSlideTransitionFrame');
        const mounts: string[] = [];
        function Slide(props: Readonly<{ name: string }>) {
            const [value, setValue] = React.useState('initial');
            React.useEffect(() => {
                mounts.push(`mount:${props.name}`);
                return () => { mounts.push(`unmount:${props.name}`); };
            }, [props.name]);
            return <TextInput testID={`slide-${props.name}`} value={value} onChangeText={setValue} />;
        }
        const frame = (key: string) => <SoftSlideTransitionFrame
            direction="forward" reducedMotion testID="soft" transitionKey={key}
        ><Slide name={key} /></SoftSlideTransitionFrame>;
        const screen = await renderScreen(frame('one'));
        await act(async () => { screen.findByTestId('slide-one')?.props.onChangeText('changed'); });
        await screen.update(frame('two'));
        expect(screen.findByTestId('slide-one')?.props.value).toBe('changed');
        expect(mounts).toEqual(['mount:one', 'mount:two']);
    });
    it('renders native blur overlays while slides transition', async () => {
        const { SoftSlideTransitionFrame } = await import('./SoftSlideTransitionFrame');
        const screen = await renderScreen(
            <SoftSlideTransitionFrame
                direction="replace"
                reducedMotion={false}
                testID="soft"
                transitionKey="one"
            >
                <View testID="slide-one" />
            </SoftSlideTransitionFrame>,
        );

        await screen.update(
            <SoftSlideTransitionFrame
                direction="forward"
                reducedMotion={false}
                testID="soft"
                transitionKey="two"
            >
                <View testID="slide-two" />
            </SoftSlideTransitionFrame>,
        );

        await vi.waitFor(async () => {
            await flushHookEffects({ cycles: 1, turns: 1 });
            expect(screen.findAllByType('BlurView')).toHaveLength(2);
        });
        expect(screen.findByTestId('soft-exit-layer')?.props).toMatchObject({
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants',
        });
    });
});
