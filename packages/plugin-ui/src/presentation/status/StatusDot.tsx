import { useEffect, useRef } from 'react';
import { Animated, Platform, View, type ViewStyle } from 'react-native';

import { useHappierUiAnimationActivityInternal, useOptionalHappierUiAccessibility } from '../../environment/context.js';
import type { HappierStyleProp } from '../portableTypes.js';

/**
 * The single implementation owner for Happier's status dot (UI-T27).
 *
 * Extracted from `apps/ui/sources/components/ui/status/StatusDot.tsx` with its
 * measured behaviour intact: a stepped CSS pulse on web, a native
 * `Animated.loop` elsewhere, a static dot when the pulse is switched off, and
 * accessibility identity that either NAMES the status or hides the dot from
 * assistive technology entirely — a colour-only dot with no label is decoration
 * and must not be announced.
 *
 * `reducedMotion` is injected (§3.10.2), and only the pulsing path reads it.
 * Status dots mount by the hundred in virtualized lists, so a preference read
 * on the static path would make every row pay for a value it cannot use.
 */
const WEB_PULSE_TIMING_FUNCTION = 'steps(6, end)';
const DEFAULT_STATUS_DOT_SIZE = 6;

export type HappierStatusDotProps = Readonly<{
  color: string;
  isPulsing?: boolean;
  size?: number;
  style?: HappierStyleProp;
  testID?: string;
  /**
   * The semantic meaning of the colour. Present: the dot is announced as an
   * image with this label. Absent: it is hidden from assistive technology,
   * because an unnamed colour conveys nothing to a screen reader.
   */
  accessibilityLabel?: string;
  /** Keep the pulsing state visible while disabling the animation. */
  animationEnabled?: boolean;
  /**
   * A soft ring behind the dot, in this colour (a themed tint such as the
   * success state's background). The ring is concentric and twice the dot's
   * size; it is drawn under the dot and never intercepts input. This is the one
   * halo composition: services, launchpad and stream dots all draw it here.
   */
  halo?: string;
  /**
   * The resolved reduced-motion preference. When omitted the environment value
   * is used; when there is no environment the dot animates.
   */
  reducedMotion?: boolean;
}>;

function accessibilityProps(accessibilityLabel: string | undefined) {
  return accessibilityLabel
    ? {
      accessibilityRole: 'image' as const,
      accessibilityLabel,
    }
    : {
      'aria-hidden': true,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants' as const,
    };
}

function dotStyle(color: string, size: number): ViewStyle {
  return {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
  };
}

export function HappierStatusDot({ halo, ...props }: HappierStatusDotProps) {
  const dot = !props.isPulsing || props.animationEnabled === false
    ? <StaticStatusDot {...props} />
    : <MotionAwareStatusDot {...props} />;
  if (!halo) return dot;
  return (
    <View
      testID={props.testID ? `${props.testID}-halo` : undefined}
      pointerEvents="none"
      style={haloStyle(props.size ?? DEFAULT_STATUS_DOT_SIZE, halo)}
    >
      {dot}
    </View>
  );
}

function haloStyle(size: number, color: string): ViewStyle {
  const ring = size * 2;
  return {
    width: ring,
    height: ring,
    borderRadius: ring / 2,
    backgroundColor: color,
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function MotionAwareStatusDot(props: HappierStatusDotProps) {
  const environmentAccessibility = useOptionalHappierUiAccessibility();
  const presentationActive = useHappierUiAnimationActivityInternal();
  const reducedMotion = props.reducedMotion ?? environmentAccessibility?.reducedMotion ?? false;

  if (reducedMotion || !presentationActive) {
    return <StaticStatusDot {...props} />;
  }
  if (Platform.OS === 'web') {
    return <WebStatusDot {...props} />;
  }
  return <PulsingStatusDot {...props} />;
}

function StaticStatusDot({
  color,
  size = DEFAULT_STATUS_DOT_SIZE,
  style,
  testID,
  accessibilityLabel,
}: HappierStatusDotProps) {
  return (
    <View
      testID={testID}
      {...accessibilityProps(accessibilityLabel)}
      style={[dotStyle(color, size), style]}
    />
  );
}

function WebStatusDot({
  color,
  isPulsing,
  size = DEFAULT_STATUS_DOT_SIZE,
  style,
  testID,
  animationEnabled = true,
  accessibilityLabel,
}: HappierStatusDotProps) {
  return (
    <View
      testID={testID}
      {...accessibilityProps(accessibilityLabel)}
      style={[
        dotStyle(color, size),
        isPulsing && animationEnabled ? webPulseStyle : null,
        style,
      ]}
    />
  );
}

function PulsingStatusDot({
  color,
  size = DEFAULT_STATUS_DOT_SIZE,
  style,
  testID,
  accessibilityLabel,
}: HappierStatusDotProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      testID={testID}
      {...accessibilityProps(accessibilityLabel)}
      style={[
        dotStyle(color, size),
        { opacity },
        style,
      ]}
    />
  );
}

type WebPulseStyle = ViewStyle & {
  animationDirection?: 'alternate';
  animationDuration?: string;
  animationIterationCount?: string;
  animationName?: string;
  animationTimingFunction?: string;
};

const webPulseStyle: WebPulseStyle = {
  animationDirection: 'alternate',
  animationDuration: '1000ms',
  animationIterationCount: 'infinite',
  animationName: 'happierStatusDotPulse',
  animationTimingFunction: WEB_PULSE_TIMING_FUNCTION,
};
