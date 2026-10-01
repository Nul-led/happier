import { useEffect, useRef } from 'react';
import { Animated, Platform, View, type DimensionValue, type ViewStyle } from 'react-native';

import { useOptionalHappierUiAccessibility } from '../../environment/context.js';
import type { HappierUiTheme } from '../../environment/types.js';
import type { HappierStyleProp } from '../portableTypes.js';

/**
 * The single implementation owner for Happier's loading skeleton (UI-T27).
 *
 * Extracted from `apps/ui/sources/components/ui/selectionList/SelectionListSkeletonRow.tsx`
 * with its measured behaviour intact — an opacity pulse between 0.4 and 0.8
 * over 800 ms in a yoyo loop, and a static 0.4 bar under reduced motion — so the
 * host's selection lists, the host's plugin-surface fallback and every plugin's
 * `LoadingState rows` draw one placeholder rather than three that drift.
 *
 * Web runs the pulse as a compositor CSS animation (`happierSkeletonPulse` in
 * `apps/ui/sources/theme.css`, beside the status-dot pulse); native runs it on
 * the native driver. Neither is a JavaScript-driven loop, and `animationEnabled`
 * lets a surface that is hidden or inactive stop it.
 */
export const HAPPIER_SKELETON_PULSE_V1 = Object.freeze({
  durationMs: 800,
  opacityLow: 0.4,
  opacityHigh: 0.8,
});

export type HappierSkeletonBlockProps = Readonly<{
  color: string;
  width: DimensionValue;
  height: number;
  radius?: number;
  /** Stops the pulse while the owning surface is hidden or inactive. */
  animationEnabled?: boolean;
  /** Resolved reduced-motion preference; defaults to the environment value. */
  reducedMotion?: boolean;
  style?: HappierStyleProp;
  testID?: string;
}>;

type WebPulseStyle = ViewStyle & {
  animationDirection?: 'alternate';
  animationDuration?: string;
  animationIterationCount?: string;
  animationName?: string;
  animationTimingFunction?: string;
};

const webPulseStyle: WebPulseStyle = {
  animationDirection: 'alternate',
  animationDuration: `${HAPPIER_SKELETON_PULSE_V1.durationMs}ms`,
  animationIterationCount: 'infinite',
  animationName: 'happierSkeletonPulse',
  animationTimingFunction: 'ease-in-out',
};

function blockStyle(props: HappierSkeletonBlockProps): ViewStyle {
  return {
    width: props.width,
    height: props.height,
    borderRadius: props.radius ?? Math.min(6, props.height / 2),
    backgroundColor: props.color,
  };
}

/** One pulsing placeholder bar. Always hidden from assistive technology. */
export function HappierSkeletonBlock(props: HappierSkeletonBlockProps) {
  const environmentAccessibility = useOptionalHappierUiAccessibility();
  const reducedMotion = props.reducedMotion ?? environmentAccessibility?.reducedMotion ?? false;
  const animate = props.animationEnabled !== false && !reducedMotion;
  if (!animate) {
    return (
      <View
        testID={props.testID}
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[blockStyle(props), { opacity: HAPPIER_SKELETON_PULSE_V1.opacityLow }, props.style]}
      />
    );
  }
  if (Platform.OS === 'web') {
    return (
      <View
        testID={props.testID}
        aria-hidden
        style={[blockStyle(props), { opacity: HAPPIER_SKELETON_PULSE_V1.opacityHigh }, webPulseStyle, props.style]}
      />
    );
  }
  return <NativePulsingBlock {...props} />;
}

function NativePulsingBlock(props: HappierSkeletonBlockProps) {
  const opacity = useRef(new Animated.Value(HAPPIER_SKELETON_PULSE_V1.opacityLow)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: HAPPIER_SKELETON_PULSE_V1.opacityHigh,
          duration: HAPPIER_SKELETON_PULSE_V1.durationMs,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: HAPPIER_SKELETON_PULSE_V1.opacityLow,
          duration: HAPPIER_SKELETON_PULSE_V1.durationMs,
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
      testID={props.testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[blockStyle(props), { opacity }, props.style]}
    />
  );
}

/** Consecutive rows read as real content of different lengths, not a uniform bar. */
const SKELETON_TITLE_WIDTHS: readonly DimensionValue[] = ['62%', '78%', '54%', '70%', '48%'];
const SKELETON_CONTEXT_WIDTHS: readonly DimensionValue[] = ['38%', '44%', '30%', '41%', '35%'];

export type HappierSkeletonRowsProps = Readonly<{
  rows: number;
  theme: HappierUiTheme;
  /**
   * What is loading. Present: the placeholder is announced once as a busy
   * progress region with this name. Absent: it is decoration and hidden.
   */
  accessibilityLabel?: string;
  animationEnabled?: boolean;
  reducedMotion?: boolean;
  testID?: string;
  style?: HappierStyleProp;
}>;

/**
 * Destination-shaped placeholder for a two-line list: a leading mark, a title
 * bar at the title role's line height and a quieter context bar at the body
 * role's, with the list row's own padding. Geometry comes from the projected
 * theme, so the placeholder occupies the space the first rows will and the
 * swap to content does not jump.
 */
export function HappierSkeletonRows(props: HappierSkeletonRowsProps) {
  const { theme } = props;
  const color = theme.colors.divider;
  const label = theme.typography.label;
  const body = theme.typography.body;
  const markSize = label.lineHeight;
  const rows = Array.from({ length: Math.max(0, Math.floor(props.rows)) }, (_, index) => index);
  const common = {
    color,
    ...(props.animationEnabled === undefined ? {} : { animationEnabled: props.animationEnabled }),
    ...(props.reducedMotion === undefined ? {} : { reducedMotion: props.reducedMotion }),
  };
  return (
    <View
      testID={props.testID}
      {...(props.accessibilityLabel
        ? {
            accessibilityRole: 'progressbar' as const,
            role: 'progressbar',
            accessibilityLabel: props.accessibilityLabel,
            'aria-label': props.accessibilityLabel,
            'aria-busy': true,
            accessibilityState: { busy: true },
          }
        : {
            'aria-hidden': true,
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          })}
      style={[{ width: '100%', minWidth: 0 }, props.style]}
    >
      {rows.map((index) => (
        <View
          key={index}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.small,
            paddingHorizontal: theme.spacing.medium,
            paddingVertical: theme.spacing.small,
          }}
        >
          <HappierSkeletonBlock {...common} width={markSize} height={markSize} radius={markSize / 2} />
          <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xsmall }}>
            <View style={{ height: label.lineHeight, justifyContent: 'center' }}>
              <HappierSkeletonBlock
                {...common}
                width={SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length]!}
                height={Math.round(label.fontSize * 0.8)}
              />
            </View>
            <View style={{ height: body.lineHeight, justifyContent: 'center' }}>
              <HappierSkeletonBlock
                {...common}
                width={SKELETON_CONTEXT_WIDTHS[index % SKELETON_CONTEXT_WIDTHS.length]!}
                height={Math.round(body.fontSize * 0.7)}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}
