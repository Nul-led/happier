import * as React from 'react';
import { Animated, Platform, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import { motionTokens } from './motionTokens';

type Size = Readonly<{ width: number; height: number }>;

const stylesheet = {
    // Behind the content, anchored to the bottom edge of its parent so a taller state grows upward
    // (a dock), and centred by the parent's own alignment so a wider state grows from both sides.
    backdrop: { position: 'absolute', bottom: 0 } as ViewStyle,
};

function webMorphStyle(size: Size, animate: boolean): ViewStyle {
    return {
        width: size.width,
        height: size.height,
        transitionProperty: 'width, height',
        transitionDuration: `${animate ? motionTokens.durationMs.base : 0}ms`,
        transitionTimingFunction: motionTokens.easingCss.standard,
    } as unknown as ViewStyle;
}

/**
 * A surface that reshapes to its content instead of jumping (a capsule going from "Claude is browsing ·
 * Take control" to "Stopping Claude…" to "You have control · Hand back"): the content lays out at its
 * new size at once and cross-fades on its own, while the surface drawn behind it — `backdrop`, usually
 * a `GlassPanel` filling its frame — travels from the old size to the new one on the standard curve.
 *
 * The parent positions the pair: it holds the content in flow and centres (or stretches) its children,
 * and the backdrop follows the content's measured box. The first measurement places the backdrop at
 * once (nothing moves on arrival); reduced motion always places it at once. The backdrop is never
 * transformed, so a web `backdrop-filter` inside it keeps blurring what is behind.
 */
export function ContentMorphBackdrop(props: Readonly<{
    backdrop: React.ReactNode;
    children: React.ReactNode;
    contentStyle?: StyleProp<ViewStyle>;
}>): React.ReactElement {
    const reducedMotion = useReducedMotionPreference();
    const [size, setSize] = React.useState<Size | null>(null);
    const placedRef = React.useRef(false);
    const width = React.useRef(new Animated.Value(0)).current;
    const height = React.useRef(new Animated.Value(0)).current;

    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        const next = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
        setSize((current) => (current && current.width === next.width && current.height === next.height ? current : next));
    }, []);

    const animate = placedRef.current && !reducedMotion;
    React.useEffect(() => {
        if (!size) return;
        placedRef.current = true;
        if (Platform.OS === 'web') return;
        if (!animate) {
            width.setValue(size.width);
            height.setValue(size.height);
            return;
        }
        const timing = { duration: motionTokens.durationMs.base, easing: motionTokens.easing.standard, useNativeDriver: false };
        Animated.parallel([
            Animated.timing(width, { ...timing, toValue: size.width }),
            Animated.timing(height, { ...timing, toValue: size.height }),
        ]).start();
    }, [animate, height, size, width]);

    const backdropStyle: StyleProp<ViewStyle> = size === null
        ? { opacity: 0 }
        : Platform.OS === 'web'
            ? webMorphStyle(size, animate)
            : { width, height } as unknown as ViewStyle;

    return (
        <>
            <Animated.View pointerEvents="none" style={[stylesheet.backdrop, backdropStyle]}>
                {props.backdrop}
            </Animated.View>
            <View onLayout={onLayout} style={props.contentStyle}>
                {props.children}
            </View>
        </>
    );
}
