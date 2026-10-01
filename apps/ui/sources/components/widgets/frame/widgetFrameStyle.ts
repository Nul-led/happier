import type { WidgetFramePlacement, WidgetFrameStyle } from './WidgetFrame';

/** Each surface's default when Appearance has no value: Home and the Board are cards, the Companion is plain. */
export const WIDGET_FRAME_PLACEMENT_DEFAULTS: Readonly<Record<WidgetFramePlacement, WidgetFrameStyle>> = Object.freeze({
    home: 'card',
    board: 'card',
    companion: 'plain',
});

type FrameStyleInput = Readonly<{
    placement: WidgetFramePlacement;
    /** Settings → Appearance → Widgets, for this surface on this device. */
    surfaceDefault?: WidgetFrameStyle | null;
    /** The widget's own override (Board: shared, in the Board layout; Home and Companion: personal). */
    override?: WidgetFrameStyle | null;
}>;

/** The one decision of how a widget is framed: its override, else its surface's default. */
export function resolveWidgetFrameStyle(input: FrameStyleInput): WidgetFrameStyle {
    return input.override ?? input.surfaceDefault ?? WIDGET_FRAME_PLACEMENT_DEFAULTS[input.placement];
}

/**
 * What the widget's ⋯ menu offers: the style it does not show now ("Show frame" / "Hide frame") and,
 * once it has an override, a way back to the surface's default.
 */
export function resolveWidgetFrameStyleToggle(input: FrameStyleInput): Readonly<{
    effective: WidgetFrameStyle;
    toggleTo: WidgetFrameStyle;
    canReset: boolean;
}> {
    const effective = resolveWidgetFrameStyle(input);
    return { effective, toggleTo: effective === 'card' ? 'plain' : 'card', canReset: input.override != null };
}
