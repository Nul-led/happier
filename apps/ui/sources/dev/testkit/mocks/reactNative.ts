import * as React from 'react';

import {
    createReactNativeAppStateEmitter,
    createReactNativeNativeRuntime,
    createReactNativeWebRuntime,
    installReactNativeWebRuntime,
    type TestReactNativeAppStateStatus,
    type TestReactNativeNativePlatformOS,
    type TestReactNativeRuntimeOverrides,
} from '../runtime/reactNativeRuntime';

export type TestReactNativeOverrides = TestReactNativeRuntimeOverrides;
export type { TestReactNativeAppStateStatus };
export type TestReactNativeNativeMockPlatformOS = TestReactNativeNativePlatformOS;

type TestReactNativeHostProps = Record<string, unknown> & Readonly<{
    children?: React.ReactNode;
}>;

export { createReactNativeAppStateEmitter };
export const createReactNativeWebMock = createReactNativeWebRuntime;
export const installReactNativeWebMock = installReactNativeWebRuntime;
export const createReactNativeNativeMock = createReactNativeNativeRuntime;

/**
 * A focused host Pressable for the small set of renderer tests that exercise
 * programmatic focus return through a React Native ref.
 */
export function createFocusablePressableMock(
    onFocus: () => void,
    onFocusTarget?: (props: TestReactNativeHostProps) => void,
) {
    return React.forwardRef<{ focus: () => void }, TestReactNativeHostProps>(
        function FocusablePressable(props, ref) {
            React.useImperativeHandle(ref, () => ({
                focus: onFocusTarget
                    ? () => { onFocusTarget(props); onFocus(); }
                    : onFocus,
            }), [onFocus, onFocusTarget, props]);
            return React.createElement('Pressable', props);
        },
    );
}

/** A focused host TextInput for renderer tests that verify field-error focus. */
export function createFocusableTextInputMock(
    onFocus: () => void,
    onFocusTarget?: (props: TestReactNativeHostProps) => void,
) {
    return React.forwardRef<{ focus: () => void }, TestReactNativeHostProps>(
        function FocusableTextInput(props, ref) {
            React.useImperativeHandle(ref, () => ({
                focus: onFocusTarget
                    ? () => { onFocusTarget(props); onFocus(); }
                    : onFocus,
            }), [onFocus, onFocusTarget, props]);
            return React.createElement('TextInput', props);
        },
    );
}
