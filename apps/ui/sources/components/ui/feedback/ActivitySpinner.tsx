import {
    HappierDotSpinner,
    iconMatchedSpinnerSize,
    resolveHappierSpinnerPresentation,
    type HappierSpinnerStyleId,
} from '@happier-dev/plugin-ui/presentation';
import * as React from 'react';
import {
    ActivityIndicator as RNActivityIndicator,
    Platform,
    View,
    type ActivityIndicatorProps as RNActivityIndicatorProps,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useLocalSetting } from '@/sync/store/hooks';
import { useHostActivelyViewed } from '@/utils/runtime/useHostActivelyViewed';

export { iconMatchedSpinnerSize };

export type ActivitySpinnerProps = RNActivityIndicatorProps & Readonly<{
    /**
     * Keep the spinner visible but hold it still: dot styles show the full H at rest, the classic
     * ring stops turning. For ambient motion that must pause without the mark disappearing.
     */
    animationEnabled?: boolean;
    /**
     * Draw this style instead of the one chosen in Settings → Appearance. Only for surfaces that
     * show the styles themselves, such as that picker's previews.
     */
    variant?: HappierSpinnerStyleId;
}>;

/**
 * Happier core's activity-spinner adapter.
 *
 * The shared presentation owner decides what every spinner draws and how it moves
 * (`resolveHappierSpinnerPresentation`) and draws the dots (`HappierDotSpinner`). This adapter
 * owns the RN hosts and their complete core style contract, and injects core's facts: the Unistyles
 * colour and accents, the style chosen in Settings → Appearance, the app-wide reduced-motion
 * preference, and whether anyone can see the window.
 *
 * A window nobody can see (a hidden tab, a backgrounded app, a hidden desktop window) gets a still
 * spinner: `apps/ui/AGENTS.md` requires every animation loop to declare its stop condition, and
 * {@link useHostActivelyViewed} is the canonical answer to "is anyone looking?". Like `StatusDot`,
 * the fact is injected through the existing `animationEnabled` pause, so a hidden host releases the
 * native clock and drops the web animation exactly as any other pause does.
 */
export function ActivitySpinner(props: ActivitySpinnerProps) {
    const { theme } = useUnistyles();
    const storedStyle = useLocalSetting('loadingIndicatorStyle');
    const reducedMotion = useReducedMotionPreference();
    const hostActivelyViewed = useHostActivelyViewed();
    const {
        animating,
        animationEnabled = true,
        color,
        hidesWhenStopped,
        size,
        style,
        variant,
        ...hostProps
    } = props;
    const { indigo, purple, orange } = theme.colors.accent;
    const auroraAccents = React.useMemo(
        () => [indigo, purple, orange] as const,
        [indigo, orange, purple],
    );

    const presentation = resolveHappierSpinnerPresentation({
        platform: Platform.OS === 'web' ? 'web' : 'native',
        defaultColor: theme.colors.text.secondary,
        color,
        size,
        indicatorStyle: variant ?? storedStyle,
        auroraAccents,
        animating,
        animationEnabled: animationEnabled && hostActivelyViewed,
        hidesWhenStopped,
        reducedMotion,
    });

    if (!presentation) {
        return null;
    }
    if (presentation.kind === 'nativeRing') {
        return (
            <RNActivityIndicator
                {...hostProps}
                style={style}
                size={size}
                color={color ?? presentation.color}
                animating={presentation.animating}
                hidesWhenStopped={presentation.hidesWhenStopped}
            />
        );
    }

    return (
        <View
            {...hostProps}
            accessibilityRole={props.accessibilityRole ?? presentation.accessibilityRole}
            style={[presentation.style, style]}
        >
            {presentation.kind === 'dots' && presentation.dots ? <HappierDotSpinner model={presentation.dots} /> : null}
        </View>
    );
}
