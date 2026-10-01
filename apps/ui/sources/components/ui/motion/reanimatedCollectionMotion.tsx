import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
    Easing,
    cancelAnimation,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';
import type {
    HappierCollectionAnimatedViewProps,
    HappierCollectionMotionDriver,
    HappierCollectionMotionTrack,
    HappierCollectionMotionValue,
} from '@happier-dev/plugin-ui/presentation';

import { motionTokens } from './motionTokens';

/**
 * Happier core's driver for the Collection's table ⇄ split transition (`Collection` in `@happier-dev/plugin-ui`).
 * The Collection decides what moves along which course; this runs it on the UI thread with the app's motion
 * tokens: the open is `durationMs.slow`, the quicker close `durationMs.base`, the reduced-motion cross-fade
 * `durationMs.fast`, and each track eases with `easing.standard` or the exit curve.
 */
type ReanimatedCollectionValue = HappierCollectionMotionValue & Readonly<{ shared: SharedValue<number> }>;

// Worklet-callable twins of `motionTokens.easing.standard` / `.exit` (same control points).
const STANDARD = Easing.bezierFn(0.2, 0, 0, 1);
const EXIT = Easing.bezierFn(0.4, 0, 1, 1);

function evaluate(track: HappierCollectionMotionTrack | undefined, progress: number, rest: number): number {
    'worklet';
    if (track === undefined) return rest;
    const [start, end] = track.input;
    const linear = Math.max(0, Math.min(1, (progress - start) / (end - start)));
    const eased = linear === 0 || linear === 1
        ? linear
        : track.easing === 'standard' ? STANDARD(linear) : track.easing === 'exit' ? EXIT(linear) : linear;
    return track.output[0] + (track.output[1] - track.output[0]) * eased;
}

function useReanimatedCollectionValue(initial: number): ReanimatedCollectionValue {
    const shared = useSharedValue(initial);
    return React.useMemo<ReanimatedCollectionValue>(() => ({
        shared,
        get: () => shared.value,
        set: (value) => {
            cancelAnimation(shared);
            shared.value = value;
        },
        // Linear in time: the Collection's timeline spreads one progress over its tracks, each with its own curve.
        animateTo: (target, durationMs, onFinished) => {
            shared.value = withTiming(target, { duration: durationMs, easing: Easing.linear }, (finished) => {
                'worklet';
                runOnJS(onFinished)(finished === true);
            });
        },
        cancel: () => {
            cancelAnimation(shared);
        },
    }), [shared]);
}

function ReanimatedCollectionView(props: HappierCollectionAnimatedViewProps) {
    const shared = (props.value as ReanimatedCollectionValue).shared;
    const tracks = props.tracks;
    // Always the same keys: Reanimated's native updater does not reset a property that disappears.
    const animatedStyle = useAnimatedStyle(() => {
        const progress = shared.value;
        return {
            opacity: evaluate(tracks.opacity, progress, 1),
            transform: [
                { translateX: evaluate(tracks.translateX, progress, 0) },
                { translateY: evaluate(tracks.translateY, progress, 0) },
            ],
        };
    }, [tracks]);
    return (
        <Animated.View
            testID={props.testID}
            pointerEvents={props.pointerEvents}
            style={[props.style as StyleProp<ViewStyle>, animatedStyle]}
        >
            {props.children}
        </Animated.View>
    );
}

export const reanimatedCollectionMotion: HappierCollectionMotionDriver = {
    useValue: useReanimatedCollectionValue,
    AnimatedView: ReanimatedCollectionView,
    durationsMs: {
        open: motionTokens.durationMs.slow,
        close: motionTokens.durationMs.base,
        reducedMotion: motionTokens.durationMs.fast,
    },
};
