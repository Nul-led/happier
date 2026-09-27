import * as React from 'react';
import { useHappierNativeMinimumInteractiveTargetSize } from '@happier-dev/plugin-ui/environment';
import { View, type StyleProp, type TextInputProps as RNTextInputProps, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FIELD_BOX_METRICS, fieldBoxShapeStyle, resolveFieldBoxColors } from '@/components/ui/forms/fieldBox';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

export type FieldTextInputProps = Readonly<{
    value: string;
    onChangeText: (text: string) => void;
    /** Names the field for assistive technology (the row title it sits beside). */
    accessibilityLabel: string;
    /** The field's current state for assistive technology ("A token is saved"); an error replaces it. */
    accessibilityHint?: string;
    /** The `nativeID` of a persistent visible label (`FieldItem` `labelNativeID`) that names this field. */
    accessibilityLabelledBy?: string;
    placeholder?: string;
    /** The field's refusal, shown under it and announced. */
    error?: string | null;
    /**
     * Marks the field invalid when its refusal is shown once for a group of fields (a filter's
     * clauses) instead of under this field; pair it with an `accessibilityHint` naming the problem.
     */
    invalid?: boolean;
    multiline?: boolean;
    /** A multiline field's minimum height, in lines (default 3): a JSON document needs more room than a note. */
    minLines?: number;
    /** `false` shows a value that can be read, selected and copied but not changed (an export). */
    editable?: boolean;
    /** Commands, identifiers and paths read better in the monospace face. */
    monospace?: boolean;
    autoCapitalize?: RNTextInputProps['autoCapitalize'];
    autoFocus?: boolean;
    /** Masks the value as it is typed (secrets); the value is never echoed back. */
    secureTextEntry?: boolean;
    keyboardType?: RNTextInputProps['keyboardType'];
    inputMode?: RNTextInputProps['inputMode'];
    /** Password-manager and autofill association (an email that is also the sign-in username). */
    autoComplete?: RNTextInputProps['autoComplete'];
    textContentType?: RNTextInputProps['textContentType'];
    returnKeyType?: RNTextInputProps['returnKeyType'];
    onSubmitEditing?: () => void;
    /** Fires when focus leaves the field: fields that commit a draft (numbers, prompts) save here. */
    onBlur?: () => void;
    maxLength?: number;
    /** Test id of the input; its error is `<testID>.error`. */
    testID?: string;
    style?: StyleProp<ViewStyle>;
}>;

/**
 * A configuration page's text field: the bordered field box a page select also uses, placed as a
 * row's control (`Item` `rightElement`, `accessoryLayout="adaptive"`), with its error beneath it.
 */
export const FieldTextInput = React.memo(React.forwardRef<React.ElementRef<typeof TextInput>, FieldTextInputProps>(
    function FieldTextInput(props, ref) {
        const { theme } = useUnistyles();
        const styles = stylesheet;
        const invalid = Boolean(props.error) || props.invalid === true;
        const colors = resolveFieldBoxColors(theme, invalid ? 'invalid' : 'idle');
        // On phones the input itself takes the shared native touch floor, so a tap anywhere in the
        // box lands in the field; pointer platforms keep the page's field density.
        const nativeMinimumTargetSize = useHappierNativeMinimumInteractiveTargetSize();
        return (
            <View style={[styles.container, props.style]}>
                <View
                    style={[
                        fieldBoxShapeStyle,
                        styles.box,
                        props.multiline ? styles.boxMultiline : null,
                        { borderColor: colors.borderColor, backgroundColor: colors.backgroundColor },
                    ]}
                >
                    <TextInput
                        ref={ref}
                        testID={props.testID}
                        value={props.value}
                        onChangeText={props.onChangeText}
                        placeholder={props.placeholder}
                        placeholderTextColor={theme.colors.input.placeholder}
                        accessibilityLabel={props.accessibilityLabel}
                        accessibilityHint={props.error ?? props.accessibilityHint}
                        accessibilityLabelledBy={props.accessibilityLabelledBy}
                        accessibilityState={invalid ? { invalid: true } as never : undefined}
                        autoCapitalize={props.autoCapitalize ?? 'none'}
                        autoCorrect={false}
                        autoFocus={props.autoFocus}
                        secureTextEntry={props.secureTextEntry}
                        keyboardType={props.keyboardType}
                        inputMode={props.inputMode}
                        autoComplete={props.autoComplete}
                        textContentType={props.textContentType}
                        returnKeyType={props.returnKeyType}
                        onSubmitEditing={props.onSubmitEditing}
                        onBlur={props.onBlur}
                        maxLength={props.maxLength}
                        // A multiline field keeps the platform default: Return inserts a newline and
                        // keeps focus. Only a single-line field leaves on Return unless it submits.
                        blurOnSubmit={props.multiline ? undefined : !props.onSubmitEditing}
                        multiline={props.multiline}
                        editable={props.editable}
                        style={[
                            styles.input,
                            props.monospace ? styles.inputMono : null,
                            props.multiline ? styles.inputMultiline : null,
                            props.multiline && props.minLines ? { minHeight: FIELD_BOX_METRICS.lineHeightPx * props.minLines } : null,
                            !props.multiline && nativeMinimumTargetSize !== undefined ? { minHeight: nativeMinimumTargetSize } : null,
                            { color: colors.valueColor },
                        ]}
                    />
                </View>
                {props.error ? (
                    <Text
                        testID={props.testID ? `${props.testID}.error` : undefined}
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                        style={styles.error}
                    >
                        {props.error}
                    </Text>
                ) : null}
            </View>
        );
    },
));

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        minWidth: FIELD_BOX_METRICS.inlineMinWidthPx,
        flexShrink: 1,
        gap: 4,
    },
    box: {
        justifyContent: 'center',
    },
    boxMultiline: {
        paddingVertical: 7,
    },
    input: {
        ...Typography.default(),
        fontSize: FIELD_BOX_METRICS.fontSizePx,
        lineHeight: FIELD_BOX_METRICS.lineHeightPx,
        padding: 0,
        margin: 0,
        minHeight: FIELD_BOX_METRICS.lineHeightPx,
    },
    inputMono: {
        ...Typography.mono(),
        fontSize: FIELD_BOX_METRICS.fontSizePx - 0.5,
    },
    inputMultiline: {
        minHeight: FIELD_BOX_METRICS.lineHeightPx * 3,
        textAlignVertical: 'top',
    },
    error: {
        ...Typography.default(),
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.state.danger.foreground,
    },
}));
