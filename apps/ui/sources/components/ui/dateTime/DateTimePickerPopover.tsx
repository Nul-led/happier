import type * as React from 'react';
import type { View } from 'react-native';

export type DateTimePickerPopoverProps = Readonly<{
    mode: 'date' | 'time';
    anchorRef: React.RefObject<View | null>;
    value: Date;
    minimumDate: Date;
    accentColor: string;
    onChange: (value: Date) => void;
    onDismiss: () => void;
}>;

export function DateTimePickerPopover(_props: DateTimePickerPopoverProps) { return null; }
