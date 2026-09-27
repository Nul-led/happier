import * as React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useHappierNativeMinimumInteractiveTargetSize } from '@happier-dev/plugin-ui/environment';

import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { TextInput } from '@/components/ui/text/Text';

/**
 * The compact bordered search field of navigation rails and collection lists: a paper-coloured well
 * with a hairline, a small magnifying glass and a single-line input. Page-wide search above a long
 * list keeps using `SearchHeader`.
 */
export const CompactSearchField = React.memo(function CompactSearchField(props: Readonly<{
    value: string;
    onChangeText: (text: string) => void;
    placeholder: string;
    /** Test id of the text input itself. */
    testID?: string;
    style?: StyleProp<ViewStyle>;
    /**
     * Runs the search on Enter or the keyboard's search key, for lists whose query is an explicit
     * request (a remote search) rather than a filter applied as the user types.
     */
    onSubmitEditing?: () => void;
    /** `false` while the list behind the field cannot be searched (for example, offline). */
    editable?: boolean;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const inputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);
    // The whole drawn field is the touch target: a tap on the glass, the padding or the border
    // focuses the input. On phones it takes the shared native touch floor; pointer platforms keep
    // the rail's density.
    const nativeMinimumTargetSize = useHappierNativeMinimumInteractiveTargetSize();
    const focusInput = React.useCallback(() => inputRef.current?.focus?.(), []);
    return (
        <Pressable
            testID={props.testID ? `${props.testID}.field` : undefined}
            onPress={focusInput}
            accessible={false}
            focusable={false}
            // Web Pressables are tab stops unless told otherwise (`focusable` is ignored there); the
            // input is the field's only focus target, and its caret is the focus cue (DESIGN.md).
            tabIndex={-1}
            style={[
                styles.field,
                nativeMinimumTargetSize === undefined ? null : { minHeight: nativeMinimumTargetSize },
                props.style,
            ]}
        >
            <View style={styles.icon}>
                <Icon name="magnifying-glass" size={ICON_SIZE.xs} color={theme.colors.text.secondary} />
            </View>
            <TextInput
                ref={inputRef}
                testID={props.testID}
                placeholder={props.placeholder}
                placeholderTextColor={theme.colors.input.placeholder}
                value={props.value}
                onChangeText={props.onChangeText}
                onSubmitEditing={props.onSubmitEditing}
                returnKeyType={props.onSubmitEditing ? 'search' : undefined}
                editable={props.editable}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={props.placeholder}
                style={styles.input}
            />
        </Pressable>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    field: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: theme.borderRadius.lg,
        paddingHorizontal: 8,
        paddingVertical: 8,
        // A raised field on a tinted plane or paper: the paper colour plus a hairline reads as an
        // input in both themes without adding a shadow.
        backgroundColor: theme.colors.surface.base,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
    },
    icon: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        padding: 0,
        margin: 0,
        minHeight: 20,
        color: theme.colors.text.primary,
    },
}));
