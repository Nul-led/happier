import * as React from 'react';
import type { ViewProps } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    interpolateColor,
    useAnimatedStyle,
    useFrameCallback,
    useSharedValue,
    withRepeat,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';

import { DOT_SPINNER_STILL_OPACITY, getDotSpinnerFrames, type DotSpinnerInk } from './dotSpinnerFrames';
import { H_DOTS, type DotSpinnerStyleId, type HDot } from './dotSpinnerStyles';
import type { DotSpinnerMotion } from './dotSpinnerMotion';

const BREATH_LOW_OPACITY = 0.45;
const BREATH_HALF_CYCLE_MS = 1200;

/**
 * The native side reads the same frame table the web strip is drawn from. One frame callback per
 * spinner advances a frame index on the UI thread, and it only writes when the index changes, so
 * the dots update at the table's 30 fps rather than the display rate. The callback runs only while
 * the spinner is animating.
 */
export function DotSpinnerNative(props: Readonly<{
    styleId: DotSpinnerStyleId;
    size: number;
    ink: DotSpinnerInk;
    motion: DotSpinnerMotion;
    hidden: boolean;
    viewProps: ViewProps;
}>) {
    const { styleId, size, ink, motion, hidden, viewProps } = props;
    const frames = getDotSpinnerFrames(styleId);
    const { cycleMs, frameCount } = frames;
    const animate = motion === 'animate' && !hidden;
    const frame = useSharedValue(0);
    const breath = useSharedValue(1);
    const series = React.useMemo(() => H_DOTS.map((_, index) => ({
        opacity: seriesFor(frames.opacity, index, frames.frameCount),
        hue: frames.hue ? seriesFor(frames.hue, index, frames.frameCount) : null,
    })), [frames]);

    const clock = useFrameCallback((info) => {
        'worklet';
        // `timestamp` is the frame time every callback shares, so all spinners step together.
        const next = Math.floor(((info.timestamp % cycleMs) / cycleMs) * frameCount);
        if (next !== frame.value) frame.value = next;
    }, animate);

    React.useEffect(() => {
        clock.setActive(animate);
    }, [animate, clock]);

    React.useEffect(() => {
        if (motion !== 'breathe' || hidden) {
            cancelAnimation(breath);
            breath.value = 1;
            return;
        }
        breath.value = withRepeat(
            withTiming(BREATH_LOW_OPACITY, { duration: BREATH_HALF_CYCLE_MS, easing: Easing.inOut(Easing.ease) }),
            -1,
            true,
        );
        return () => cancelAnimation(breath);
    }, [breath, hidden, motion]);

    const breathStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

    return (
        <Animated.View {...viewProps} style={[{ width: size, height: size, alignSelf: 'center' }, breathStyle, viewProps.style]}>
            {hidden ? null : H_DOTS.map((dot, index) => (
                <NativeDot
                    key={dot.id}
                    dot={dot}
                    size={size}
                    ink={ink}
                    still={!animate}
                    frame={frame}
                    opacity={series[index]!.opacity}
                    hue={'aurora' in ink ? series[index]!.hue : null}
                />
            ))}
        </Animated.View>
    );
}

function seriesFor(table: readonly number[], dotIndex: number, frameCount: number): number[] {
    const series: number[] = [];
    for (let frame = 0; frame < frameCount; frame++) series.push(table[frame * H_DOTS.length + dotIndex]!);
    return series;
}

const NativeDot = React.memo(function NativeDot(props: Readonly<{
    dot: HDot;
    size: number;
    ink: DotSpinnerInk;
    still: boolean;
    frame: SharedValue<number>;
    opacity: readonly number[];
    hue: readonly number[] | null;
}>) {
    const { dot, size, ink, still, frame, opacity, hue } = props;
    const pitch = size / 3;
    const diameter = size / 6;
    const aurora = 'aurora' in ink ? ink.aurora : null;
    const color = 'color' in ink ? ink.color : ink.aurora[0];

    const animatedStyle = useAnimatedStyle(() => {
        const index = frame.value;
        const style: { opacity: number; backgroundColor?: string } = {
            opacity: still ? DOT_SPINNER_STILL_OPACITY : (opacity[index] ?? DOT_SPINNER_STILL_OPACITY),
        };
        if (aurora && hue) {
            style.backgroundColor = interpolateColor(hue[still ? 0 : index] ?? 0, [0, 1 / 3, 2 / 3, 1], [aurora[0], aurora[1], aurora[2], aurora[0]]);
        }
        return style;
    });

    return (
        <Animated.View
            testID="activity-spinner-dot"
            style={[
                {
                    position: 'absolute',
                    left: (dot.col + 0.5) * pitch - diameter / 2,
                    top: (dot.row + 0.5) * pitch - diameter / 2,
                    width: diameter,
                    height: diameter,
                    borderRadius: diameter / 2,
                    backgroundColor: color,
                },
                animatedStyle,
            ]}
        />
    );
});
