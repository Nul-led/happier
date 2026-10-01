import * as React from 'react';
import type { TextInput, TextInputProps } from 'react-native';

import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Item } from '@/components/ui/lists/Item';

/**
 * A provider form field as a page row: the label (and what it is for) on the left, the field on the
 * right, beneath the label on narrow widths; multi-line fields always sit beneath it.
 */
export const ProviderFieldRow = React.memo(React.forwardRef<TextInput, Readonly<{
    testID?: string;
    title: string;
    description?: string;
    value: string;
    onChangeText: (value: string) => void;
    /** Commit points for a field that saves on its own (no form Save): leaving it, or Enter. */
    onBlur?: () => void;
    onSubmitEditing?: () => void;
    placeholder?: string;
    error?: string | null;
    multiline?: boolean;
    monospace?: boolean;
    editable?: boolean;
    autoCapitalize?: TextInputProps['autoCapitalize'];
    keyboardType?: TextInputProps['keyboardType'];
}>>(function ProviderFieldRow(props, ref) {
    return (
        <Item
            title={props.title}
            subtitle={props.description}
            subtitleLines={0}
            accessoryLayout={props.multiline ? 'stacked' : 'adaptive'}
            showChevron={false}
            rightElement={(
                <FieldTextInput
                    ref={ref}
                    testID={props.testID}
                    value={props.value}
                    onChangeText={props.onChangeText}
                    onBlur={props.onBlur}
                    onSubmitEditing={props.onSubmitEditing}
                    accessibilityLabel={props.title}
                    placeholder={props.placeholder}
                    error={props.error}
                    multiline={props.multiline}
                    monospace={props.monospace}
                    editable={props.editable}
                    autoCapitalize={props.autoCapitalize}
                    keyboardType={props.keyboardType}
                />
            )}
        />
    );
}));
