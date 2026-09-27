import { StyleSheet } from 'react-native';

/**
 * The bordered field box of configuration pages: a page select's trigger and a page text field share
 * this one shape, so a row of fields reads as one set whatever the control.
 */
export const FIELD_BOX_METRICS = {
    minHeightPx: 32,
    radiusPx: 9,
    borderWidthPx: 1,
    paddingLeftPx: 12,
    paddingRightPx: 8,
    fontSizePx: 13.5,
    lineHeightPx: 18,
    /** Narrowest width beside a label; stacked under the label a field spans the row instead. */
    inlineMinWidthPx: 240,
} as const;

type FieldBoxTheme = Readonly<{
    colors: Readonly<{
        border: Readonly<{ strong: string }>;
        surface: Readonly<{ base: string }>;
        text: Readonly<{ primary: string }>;
        input: Readonly<{ placeholder: string }>;
        state: Readonly<{ danger: Readonly<{ foreground: string }> }>;
    }>;
}>;

export type FieldBoxState = 'idle' | 'invalid';

/**
 * The field box colours. There is no focused colour: a text field's caret is its focus cue
 * (DESIGN.md → focus), and a select trigger takes the row's own focus-visible treatment.
 */
export function resolveFieldBoxColors(theme: FieldBoxTheme, state: FieldBoxState = 'idle') {
    return {
        borderColor: state === 'invalid' ? theme.colors.state.danger.foreground : theme.colors.border.strong,
        backgroundColor: theme.colors.surface.base,
        valueColor: theme.colors.text.primary,
        placeholderColor: theme.colors.input.placeholder,
    } as const;
}

export const fieldBoxShapeStyle = StyleSheet.create({
    box: {
        minHeight: FIELD_BOX_METRICS.minHeightPx,
        borderRadius: FIELD_BOX_METRICS.radiusPx,
        borderWidth: FIELD_BOX_METRICS.borderWidthPx,
        paddingLeft: FIELD_BOX_METRICS.paddingLeftPx,
        paddingRight: FIELD_BOX_METRICS.paddingRightPx,
    },
}).box;
