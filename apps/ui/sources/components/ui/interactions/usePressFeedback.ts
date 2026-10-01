import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { motionTokens } from '@/components/ui/motion/motionTokens';
import { reanimatedMotionTokens } from '@/components/ui/motion/reanimatedMotionTokens';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

const PRESSED_SCALE_DELTA = 1 - motionTokens.press.scale;
const PRESSED_OPACITY_DELTA = 1 - motionTokens.press.opacity;

export type PressFeedbackOptions = Readonly<{
    /** Keep an eased opacity response without movement, where scale would be distracting. */
    static?: boolean;
    /**
     * For icon- or text-led affordances whose visible mark is small (16-24px glyphs):
     * 4% of a 16px glyph is under a pixel, so the scale is paired with the opacity dip.
     * Use it on every icon-sized press target; larger chrome (buttons, cards, rows) omits it.
     */
    glyph?: boolean;
    /**
     * A caller-owned motion cap (for example the instrument kit's `minimal` level, which
     * already folds in the OS preference). When omitted, the OS reduced-motion preference applies.
     */
    reduced?: boolean;
}>;

/**
 * The shared tactile press: a quick scale-down on press-in and a slower settle on
 * release, so a cancelled press (finger moved away) returns without committing.
 *
 * Reduced motion keeps the acknowledgement as an immediate opacity change rather
 * than spatial motion. Spread the handlers on a pressable and apply `animatedStyle`
 * to the `Animated.View` that carries its visible chrome. A surface that already owns
 * a composed transform reads `progress` with `scaleDelta`/`opacityDelta` instead of
 * stacking a second animated scale.
 */
export function usePressFeedback(options?: PressFeedbackOptions) {
    const preference = useReducedMotionPreference();
    const reducedMotion = options?.reduced ?? preference;
    const progress = useSharedValue(0);
    const opacityOnly = options?.static === true || reducedMotion;
    const scaleDelta = opacityOnly ? 0 : PRESSED_SCALE_DELTA;
    const opacityDelta = opacityOnly || options?.glyph === true ? PRESSED_OPACITY_DELTA : 0;
    const animatedStyle = useAnimatedStyle(() => {
        'worklet';
        const p = progress.value;
        if (scaleDelta === 0) return { opacity: 1 - p * opacityDelta };
        const transform = [{ scale: 1 - p * scaleDelta }];
        return opacityDelta === 0 ? { transform } : { opacity: 1 - p * opacityDelta, transform };
    });
    const settle = (target: 0 | 1, duration: number) => {
        progress.value = reducedMotion
            ? target
            : withTiming(target, { duration, easing: reanimatedMotionTokens.easing.standard });
    };

    return {
        animatedStyle,
        progress,
        scaleDelta,
        opacityDelta,
        onPressIn: () => settle(1, reanimatedMotionTokens.durationMs.press),
        onPressOut: () => settle(0, reanimatedMotionTokens.durationMs.release),
    };
}
