import * as React from 'react';
import { View } from 'react-native';
import Animated, {
    cancelAnimation,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { reanimatedMotionTokens } from '@/components/ui/motion/reanimatedMotionTokens';
import { CapacityRing } from '@/components/ui/progress/CapacityRing';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useHostActivelyViewed } from '@/utils/runtime/useHostActivelyViewed';

const MARK_SIZE = 76;
const RING_STROKE = 3;
const GLYPH_CHIP_SIZE = 56;
/**
 * Half-period of the breathe. No duration token covers a looping status rhythm — the longest is a
 * one-shot stage camera move — so this is a local, deliberately slow value: fast enough to read as
 * alive, slow enough to sit behind reading copy for the length of a real install.
 */
const WORKING_PULSE_MS = 1500;
const WORKING_OPACITY_LOW = 0.5;
const WORKING_OPACITY_HIGH = 1;

const styles = StyleSheet.create((theme) => ({
    root: {
        width: MARK_SIZE,
        height: MARK_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ringLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    chip: {
        width: GLYPH_CHIP_SIZE,
        height: GLYPH_CHIP_SIZE,
        borderRadius: GLYPH_CHIP_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
}));

/**
 * The single activity object of the Personal Home setup surface.
 *
 * The Home mark IS the progress indicator: the arc around it is filled from the derived
 * milestone fraction (`personalHomeSetupProgress`), so the surface shows the facts it has
 * instead of an indeterminate spinner standing beside them. While an operation runs, exactly
 * one thing moves — the arc breathes in place; its LENGTH never moves on its own, so the
 * treatment implies no fraction the snapshot has not proven. Under reduced motion the arc is
 * simply static: every fact (fill, title, status sentence) survives untouched.
 *
 * `CapacityRing` is composed unmodified; it keeps no setup semantics.
 */
export const PersonalHomeSetupMark = React.memo(function PersonalHomeSetupMark(props: Readonly<{
    /** Derived milestone fraction, 0..1. */
    fraction: number;
    /** True while a bootstrap operation is running. */
    working: boolean;
    /** Test/host override for the app-wide reduced-motion preference. */
    reducedMotion?: boolean;
}>) {
    const { theme } = useUnistyles();
    const preferredReducedMotion = useReducedMotionPreference();
    const reducedMotion = props.reducedMotion ?? preferredReducedMotion;
    // Long-running status motion pauses while nobody can see the window (apps/ui/AGENTS.md).
    const hostActivelyViewed = useHostActivelyViewed();
    const animate = props.working && !reducedMotion && hostActivelyViewed;
    const arcOpacity = useSharedValue(WORKING_OPACITY_HIGH);

    React.useEffect(() => {
        if (!animate) {
            cancelAnimation(arcOpacity);
            arcOpacity.value = WORKING_OPACITY_HIGH;
            return;
        }
        arcOpacity.value = withRepeat(
            withTiming(WORKING_OPACITY_LOW, {
                duration: WORKING_PULSE_MS,
                easing: reanimatedMotionTokens.easing.standard,
            }),
            -1,
            true,
        );
        return () => {
            cancelAnimation(arcOpacity);
        };
    }, [animate, arcOpacity]);

    const arcStyle = useAnimatedStyle(() => ({ opacity: arcOpacity.value }));

    const ring = (
        <CapacityRing
            size={MARK_SIZE}
            strokeWidth={RING_STROKE}
            ratio={props.fraction}
            color={theme.colors.text.primary}
            trackColor={theme.colors.border.default}
            progressTestID="personal-home-bootstrap-progress-arc"
        />
    );

    return (
        <View
            testID="personal-home-bootstrap-mark"
            style={styles.root}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            {props.working ? (
                <Animated.View
                    testID="personal-home-bootstrap-activity"
                    accessible={false}
                    style={[styles.ringLayer, arcStyle]}
                >
                    {ring}
                </Animated.View>
            ) : (
                <View style={styles.ringLayer}>{ring}</View>
            )}
            <View style={styles.chip}>
                <Icon name="house" size={ICON_SIZE.lg} color={theme.colors.button.primary.tint} />
            </View>
        </View>
    );
});
