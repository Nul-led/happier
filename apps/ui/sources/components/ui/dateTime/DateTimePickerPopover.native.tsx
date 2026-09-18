import * as React from 'react';
import { Platform, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import type { DateTimePickerPopoverProps } from './DateTimePickerPopover';

export function DateTimePickerPopover(props: DateTimePickerPopoverProps) {
    return <View testID={`date-time-picker-${props.mode}-picker`} style={{ alignItems: 'center' }}>
        <DateTimePicker
            value={props.value}
            mode={props.mode}
            display={Platform.OS === 'ios' ? (props.mode === 'date' ? 'inline' : 'spinner') : (props.mode === 'date' ? 'calendar' : 'clock')}
            minimumDate={props.mode === 'date' ? props.minimumDate : undefined}
            accentColor={props.accentColor}
            onChange={(event: DateTimePickerEvent, value?: Date) => {
                if (event.type === 'dismissed') { props.onDismiss(); return; }
                if (value) props.onChange(value);
                if (Platform.OS === 'android') props.onDismiss();
            }}
        />
    </View>;
}
