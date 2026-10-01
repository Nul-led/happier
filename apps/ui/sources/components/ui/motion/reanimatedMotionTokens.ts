import { Easing } from 'react-native-reanimated';

import { motionTokens } from './motionTokens';

export const reanimatedMotionTokens = {
    durationMs: motionTokens.durationMs,
    /** `withSpring` configs for `motionTokens.spring` (Reanimated's duration + damping-ratio form). */
    spring: {
        travel: {
            duration: motionTokens.spring.travel.durationMs,
            dampingRatio: motionTokens.spring.travel.dampingRatio,
        },
    },
    easing: {
        standard: Easing.bezier(0.2, 0, 0, 1),
        exit: Easing.bezier(0.4, 0, 1, 1),
        stageCamera: Easing.bezier(0.22, 0.82, 0.2, 1),
        linear: Easing.linear,
    },
} as const;
