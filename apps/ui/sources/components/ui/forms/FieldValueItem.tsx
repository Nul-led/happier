import * as React from 'react';
import {
    resolveHappierFieldKeyboardType,
    useHappierFieldValueDraft,
    type HappierFieldValueKind,
} from '@happier-dev/plugin-ui/presentation';

import { Item, type ItemProps } from '@/components/ui/lists/Item';

import { FieldTextInput } from './FieldTextInput';

export type FieldValueKind = HappierFieldValueKind;

export type FieldValueItemProps = Omit<ItemProps, 'rightElement' | 'onPress' | 'accessoryLayout' | 'showChevron' | 'detail'> & Readonly<{
    /** The saved value, as text. The field follows it whenever it changes. */
    value: string;
    /**
     * Saves the typed value. Called when focus leaves the field or on submit, and only when the draft
     * differs from `value`. Return the text the field should show afterwards (a number moved to its
     * bound, the saved value when the draft was refused); return nothing to keep the draft.
     */
    onCommit: (draft: string) => string | void;
    /** Called with each draft as the field keeps it (e.g. to clear a refusal the user is correcting). */
    onDraftChange?: (draft: string) => void;
    /** `integer` and `decimal` keep the draft to digits and return an empty draft to the saved value. */
    kind?: FieldValueKind;
    /** A number that may be negative: the draft keeps one leading minus. */
    signed?: boolean;
    /** A number that may be left empty ("not set"): an empty draft commits instead of returning. */
    allowEmpty?: boolean;
    placeholder?: string;
    /** Test id of the text input (its error is `<fieldTestID>.error`). */
    fieldTestID?: string;
    monospace?: boolean;
    /** Masks the draft as it is typed (secrets); pass `value=""` so a saved secret is never echoed. */
    secureTextEntry?: boolean;
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    /** Names the field; defaults to the row title. */
    fieldAccessibilityLabel?: string;
    error?: string | null;
    /** Focus the field when it appears (a value the user just asked to type). */
    autoFocus?: boolean;
}>;

/**
 * A setting whose value is typed in place: the row's label on the left and a field on the right
 * (beneath it on narrow rows). The draft is local while typing and commits when focus leaves the
 * field or on submit, so a number or name never goes through a modal prompt.
 */
export const FieldValueItem = React.memo(function FieldValueItem(props: FieldValueItemProps) {
    const {
        value,
        onCommit,
        onDraftChange,
        kind = 'text',
        signed = false,
        allowEmpty,
        placeholder,
        fieldTestID,
        monospace,
        secureTextEntry,
        autoCapitalize,
        fieldAccessibilityLabel,
        error,
        autoFocus,
        ...itemProps
    } = props;
    // The draft, its filtering and the commit rule are the shared owner's (a plugin page field
    // typed in place commits through the same one).
    const field = useHappierFieldValueDraft({ value, onCommit, onDraftChange, kind, signed, allowEmpty });

    const title = typeof itemProps.title === 'string' ? itemProps.title : undefined;
    // The subtitle sits beside the field, so it is attached for a screen reader focused on the field.
    const description = typeof itemProps.subtitle === 'string' ? itemProps.subtitle : undefined;
    return (
        <Item
            {...itemProps}
            showChevron={false}
            accessoryLayout="adaptive"
            rightElement={(
                <FieldTextInput
                    testID={fieldTestID}
                    value={field.draft}
                    onChangeText={field.change}
                    accessibilityLabel={fieldAccessibilityLabel ?? title ?? ''}
                    accessibilityHint={description}
                    placeholder={placeholder}
                    keyboardType={resolveHappierFieldKeyboardType(kind, signed)}
                    monospace={monospace}
                    secureTextEntry={secureTextEntry}
                    autoCapitalize={autoCapitalize}
                    editable={itemProps.disabled !== true}
                    error={error}
                    autoFocus={autoFocus}
                    onBlur={field.commit}
                    onSubmitEditing={field.commit}
                />
            )}
        />
    );
});
