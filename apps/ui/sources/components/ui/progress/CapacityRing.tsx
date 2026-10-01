import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
    cancelAnimation,
    useAnimatedProps,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Svg, Circle } from 'react-native-svg';

import { reanimatedMotionTokens } from '@/components/ui/motion/reanimatedMotionTokens';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

/**
 * Canonical circular progress ring (gauge). Renders one or more CONCENTRIC arcs
 * (outermost first) over a faint track, with a centered content slot — the shared
 * primitive behind token-usage rings AND the connected-service capacity gauges
 * (where each ring is one usage limit), so the ring geometry never drifts.
 *
 * Tone → color resolution stays with the caller (each arc takes a resolved
 * `color`): this primitive has no opinion about any domain's tone vocabulary.
 */
export type CapacityRingProps = Readonly<{
    /** Single-arc fill fraction 0..1 (used when `rings` is not provided). */
    ratio?: number;
    /** Single-arc resolved color (used when `rings` is not provided). */
    color?: string;
    /** Concentric arcs, OUTERMOST first. Overrides `ratio`/`color` when non-empty. */
    rings?: ReadonlyArray<{ ratio: number; color: string }>;
    /** Outer diameter in px. */
    size?: number;
    strokeWidth?: number;
    /** Resolved track (unfilled) color. Defaults to the theme's default border. */
    trackColor?: string;
    /** Centered content (e.g. the capacity % text). */
    children?: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    testID?: string;
    /** testID for the `Svg` element. */
    ringTestID?: string;
    /** testID for the OUTERMOST progress arc `Circle`. */
    progressTestID?: string;
    accessibilityLabel?: string;
}>;

/** Radial gap between adjacent concentric arcs. */
const RING_GAP = 2.5;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export function CapacityRing(props: CapacityRingProps) {
    const { theme } = useUnistyles();
    const reducedMotion = useReducedMotionPreference();
    const size = props.size ?? 40;
    const strokeWidth = props.strokeWidth ?? 3;
    const trackColor = props.trackColor ?? theme.colors.border.default;
    const outerRadius = (size - strokeWidth) / 2;

    const arcs = props.rings && props.rings.length > 0
        ? props.rings
        : [{ ratio: props.ratio ?? 0, color: props.color ?? trackColor }];

    return (
        <View
            testID={props.testID}
            pointerEvents="none"
            accessibilityRole="image"
            accessibilityLabel={props.accessibilityLabel}
            style={[styles.root, { width: size, height: size, borderRadius: size / 2 }, props.style]}
        >
            <Svg
                testID={props.ringTestID}
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                style={styles.ring}
            >
                {arcs.map((arc, index) => {
                    const radius = outerRadius - index * (strokeWidth + RING_GAP);
                    if (radius < strokeWidth) return null;
                    const circumference = 2 * Math.PI * radius;
                    return (
                        <React.Fragment key={index}>
                            <Circle
                                cx={size / 2}
                                cy={size / 2}
                                r={radius}
                                fill="none"
                                stroke={trackColor}
                                strokeWidth={strokeWidth}
                            />
                            <AnimatedCapacityArc
                                testID={index === 0 ? props.progressTestID : undefined}
                                cx={size / 2}
                                cy={size / 2}
                                r={radius}
                                color={arc.color}
                                strokeWidth={strokeWidth}
                                circumference={circumference}
                                dashOffset={circumference * (1 - clamp01(arc.ratio))}
                                reducedMotion={reducedMotion}
                                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                            />
                        </React.Fragment>
                    );
                })}
            </Svg>
            {props.children != null ? (
                <View pointerEvents="none" style={styles.centerOverlay}>
                    {props.children}
                </View>
            ) : null}
        </View>
    );
}

type AnimatedCapacityArcProps = Readonly<{
    testID?: string;
    cx: number;
    cy: number;
    r: number;
    color: string;
    strokeWidth: number;
    circumference: number;
    dashOffset: number;
    reducedMotion: boolean;
    transform: string;
}>;

function AnimatedCapacityArc(props: AnimatedCapacityArcProps) {
    const dashOffset = useSharedValue(props.dashOffset);
    const previousTargetRef = React.useRef(props.dashOffset);
    const previousReducedMotionRef = React.useRef(props.reducedMotion);

    React.useEffect(() => {
        cancelAnimation(dashOffset);
        const targetChanged = previousTargetRef.current !== props.dashOffset;
        const motionBecameAvailable = previousReducedMotionRef.current && !props.reducedMotion;
        previousTargetRef.current = props.dashOffset;
        previousReducedMotionRef.current = props.reducedMotion;

        if (props.reducedMotion) {
            dashOffset.value = props.dashOffset;
        } else if (targetChanged || motionBecameAvailable) {
            dashOffset.value = withTiming(props.dashOffset, {
                duration: reanimatedMotionTokens.durationMs.base,
                easing: reanimatedMotionTokens.easing.standard,
            });
        }

        return () => {
            cancelAnimation(dashOffset);
        };
    }, [dashOffset, props.dashOffset, props.reducedMotion]);

    const animatedProps = useAnimatedProps(() => ({
        strokeDashoffset: dashOffset.value,
    }));

    return (
        <AnimatedCircle
            testID={props.testID}
            cx={props.cx}
            cy={props.cy}
            r={props.r}
            fill="none"
            stroke={props.color}
            strokeWidth={props.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${props.circumference} ${props.circumference}`}
            transform={props.transform}
            animatedProps={animatedProps}
        />
    );
}

const styles = StyleSheet.create(() => ({
    root: {
        position: 'relative',
        justifyContent: 'center',
        alignItems: 'center',
    },
    ring: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    centerOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        justifyContent: 'center',
        alignItems: 'center',
    },
}));
