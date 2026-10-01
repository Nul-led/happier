import { Easing } from 'react-native';
import { type WithSpringConfig } from 'react-native-reanimated';

import { motionTokens } from './motionTokens';

/**
 * The one role vocabulary for every slide transition in the app.
 *
 *   - `'signature'`: once-per-journey storytelling surfaces (StoryDeck, onboarding
 *     tour narration/reel, release notes). Longer travel, a soft blur and a
 *     looser settle.
 *
 *   - `'routine'`: frequent, functional stepping (wizard/step bodies, settings
 *     sub-pages, SelectionList popovers, editor mode swaps). Short travel, no
 *     blur by default, quick settle.
 *
 * Two render engines consume a role; each keeps its own timing model:
 *
 *   - `spring`: the Reanimated progress pipeline (`SlideTransitionSwitch` →
 *     `SlideTransitionFrame`). Blur is on by default only for `signature`.
 *   - `timed`: the fixed-duration two-layer frame (`SoftSlideTransitionFrame`).
 *     `StepTransitionFrame` wraps it with `routine`; StoryDeck renders it
 *     directly with `signature`.
 *
 * `reducedMotionDurationMs` is shared by both engines: under reduced motion the
 * travel and blur collapse to a plain crossfade of this length.
 */
export type SlideTransitionRole = 'signature' | 'routine';

type SlideEasing = typeof motionTokens.easing.standard;

export type SlideTransitionRoleTokens = Readonly<{
    /** Crossfade length when the user prefers reduced motion (both engines). */
    reducedMotionDurationMs: number;
    /** Spring engine (`SlideTransitionSwitch` / `SlideTransitionFrame`). */
    spring: Readonly<{
        config: WithSpringConfig;
        /** Travel (px) of a non-current layer at progress=0. */
        translatePx: number;
        /** Peak blur (px on web); the blur layer maps it onto native intensity. */
        maxBlurPx: number;
        /** Multiplier from web blurPx to native BlurView intensity (capped at 100). */
        nativeBlurIntensityScale: number;
    }>;
    /** Timed engine (`SoftSlideTransitionFrame`). */
    timed: Readonly<{
        durationMs: Readonly<{ enter: number; exit: number }>;
        translatePx: number;
        /** Peak web blur (px); 0 disables blur. */
        blurPx: number;
        /** Native BlurView intensity at peak; 0 disables blur. */
        nativeBlurIntensity: number;
        easing: SlideEasing;
        easingExit: SlideEasing;
        easingCss: string;
    }>;
}>;

/** Accelerating exit so the outgoing layer clears before the incoming one settles. */
const exitEasing: SlideEasing = Easing.bezier(0.4, 0, 1, 1);

export const slideTransitionTokens: Readonly<Record<SlideTransitionRole, SlideTransitionRoleTokens>> = {
    signature: {
        reducedMotionDurationMs: 180,
        spring: {
            config: { damping: 18, stiffness: 140, mass: 0.9 },
            translatePx: 32,
            maxBlurPx: 12,
            nativeBlurIntensityScale: 3,
        },
        timed: {
            durationMs: { enter: 460, exit: 320 },
            translatePx: 18,
            blurPx: 10,
            nativeBlurIntensity: 34,
            easing: motionTokens.easing.standard,
            easingExit: exitEasing,
            easingCss: motionTokens.easingCss.standard,
        },
    },
    routine: {
        reducedMotionDurationMs: motionTokens.durationMs.fast,
        spring: {
            config: { damping: 24, stiffness: 220, mass: 0.7 },
            translatePx: 16,
            maxBlurPx: 6,
            nativeBlurIntensityScale: 3,
        },
        timed: {
            durationMs: { enter: motionTokens.durationMs.base, exit: motionTokens.durationMs.fast },
            translatePx: 12,
            blurPx: 0,
            nativeBlurIntensity: 0,
            easing: motionTokens.easing.standard,
            easingExit: exitEasing,
            easingCss: motionTokens.easingCss.standard,
        },
    },
};
