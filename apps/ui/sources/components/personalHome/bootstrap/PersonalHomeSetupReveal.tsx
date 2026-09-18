import * as React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
    cancelAnimation,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

import { reanimatedMotionTokens } from '@/components/ui/motion/reanimatedMotionTokens';

/** How far the departing setup frame recedes while it dissolves. Small on purpose: this is a settle, not a zoom. */
const REVEAL_SCALE_LIFT = 0.012;

/**
 * The departing first-run setup frame, played once over the shell that has just been released.
 *
 * Lane 03 releases the shell the moment Home readiness is derived; without this the frame was
 * replaced in a single commit — a hard cut out of the surface the user was reading. The outgoing
 * frame therefore stays mounted for one restrained settle (opacity out, a hair of recession)
 * above the live shell, and unmounts when the animation lands. It never takes input: the shell
 * beneath is already interactive.
 *
 * Under reduced motion the gate does not mount this at all — the immediate swap is the
 * substitute, and no fact is carried by the transition itself.
 */
export function PersonalHomeSetupReveal(props: Readonly<{
    onSettled: () => void;
    children: React.ReactNode;
}>): React.ReactElement {
    const progress = useSharedValue(1);
    const onSettledRef = React.useRef(props.onSettled);
    onSettledRef.current = props.onSettled;

    React.useEffect(() => {
        const settle = () => onSettledRef.current();
        progress.value = withTiming(
            0,
            {
                duration: reanimatedMotionTokens.durationMs.stageCrossfade,
                easing: reanimatedMotionTokens.easing.standard,
            },
            (finished) => {
                'worklet';
                if (finished) runOnJS(settle)();
            },
        );
        return () => {
            cancelAnimation(progress);
        };
    }, [progress]);

    const style = useAnimatedStyle(() => ({
        opacity: progress.value,
        transform: [{ scale: 1 + (1 - progress.value) * REVEAL_SCALE_LIFT }],
    }));

    return (
        <Animated.View
            testID="personal-home-setup-reveal"
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[StyleSheet.absoluteFill, style]}
        >
            {props.children}
        </Animated.View>
    );
}
