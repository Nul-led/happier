import * as React from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { usePressFeedback } from '@/components/ui/interactions/usePressFeedback';
import type { FocusReturnTarget } from '@/keyboard/focusReturn';

/**
 * A control that acknowledges the press before the work completes.
 *
 * The press response (scale, release settle, reduced-motion opacity) is the
 * shared `usePressFeedback` owner, so every control built on it feels like every
 * other tactile control in the app.
 */
export const TactilePressable = React.memo(function TactilePressable(props: Readonly<{
    onPress?: (event: GestureResponderEvent) => void;
    onLongPress?: (event: GestureResponderEvent) => void;
    accessibilityLabel: string;
    accessibilityHint?: string;
    /**
     * The control's current *state*, when it has one the label does not carry.
     *
     * Kept separate from `accessibilityLabel` on purpose: the label names the action a press
     * performs ("Mute"), the value reports the condition it acts on ("Microphone active").
     */
    accessibilityValue?: Readonly<{ text: string }>;
    /**
     * Set on a control that expands and collapses a region, so its state is announced.
     *
     * Forwarded as `aria-expanded`, which is the one spelling that lands on **both** platforms:
     * react-native-web 0.21 has no `accessibilityState` handling whatsoever — only `aria-expanded`
     * (or the deprecated `accessibilityExpanded`) reaches the DOM
     * (`react-native-web/dist/modules/createDOMProps/index.js:343-345`) — while React Native's own
     * Pressable folds `aria-expanded` back into `accessibilityState.expanded` for native assistive
     * tech (`react-native/Libraries/Components/Pressable/Pressable.js:189,231`).
     */
    expanded?: boolean;
    disabled?: boolean;
    testID?: string;
    style?: any;
    children: React.ReactNode;
    /** Disable the scale response where movement would be distracting. */
    static?: boolean;
    /** Icon-sized mark (16-24px): pair the scale with the opacity dip (see `usePressFeedback`). */
    glyph?: boolean;
    /** Caller-owned motion cap; defaults to the OS reduced-motion preference. */
    reduced?: boolean;
    /**
     * Layout applied to the Pressable itself.
     *
     * `style` lands on the inner animated view, so flex/size rules put there are
     * silently ignored by the parent row — the Pressable still shrinks to its
     * content. Anything that participates in the parent's layout belongs here.
     */
    containerStyle?: any;
    /** Host ref used for ephemeral focus handoff; it owns no focus state. */
    focusTargetRef?: React.RefCallback<FocusReturnTarget>;
    onFocus?: () => void;
    onBlur?: () => void;
    /*
     * There is deliberately no `hitSlop` here.
     *
     * react-native-web 0.21 implements it only in the legacy `Touchable` export —
     * `Pressable` and `View` never read the prop — and every surface these
     * controls appear on ships through the web bundle on desktop. A control's
     * target is therefore its real frame: either `MINIMUM_TARGET_CONTAINER_STYLE`,
     * or a larger frame paired with an equal negative margin where the row's
     * rhythm is measured from the box.
     */
}>) {
    const feedback = usePressFeedback({ static: props.static, glyph: props.glyph, reduced: props.reduced });
    // A pressable must never wrap another pressable: react-native-web renders
    // `accessibilityRole="button"` as a real <button>, so nesting produces
    // invalid DOM and a screen reader that cannot reach the inner control.
    // Concepts therefore keep their controls as siblings of the tap target,
    // never as its children.

    return (
        <Pressable
            ref={props.focusTargetRef as any}
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            accessibilityHint={props.accessibilityHint}
            accessibilityValue={props.accessibilityValue}
            {...(props.accessibilityValue
                ? { 'aria-valuetext': props.accessibilityValue.text }
                : {})}
            {...(props.expanded === undefined ? {} : { 'aria-expanded': props.expanded })}
            disabled={props.disabled}
            testID={props.testID}
            style={props.containerStyle}
            onPressIn={feedback.onPressIn}
            onPressOut={feedback.onPressOut}
            onPress={props.onPress}
            onLongPress={props.onLongPress}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
        >
            <Animated.View style={[props.style, feedback.animatedStyle]}>{props.children}</Animated.View>
        </Pressable>
    );
});
