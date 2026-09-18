import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

import { DateTimePickerPopover } from './DateTimePickerPopover';
import {
    formatLocalDateInput,
    formatLocalTimeInput,
    parseLocalDateTime,
    type LocalDateTimeDraft,
} from './localDateTimeValue';

/**
 * One local date and time, typed or picked.
 *
 * This is the editor the Session reminder modal grew and the Temporary-computer
 * package expiry needed: two fields, a themed platform picker behind each field's
 * own icon, and one honest message when the reading is not a future moment. It
 * owns no domain meaning — the caller decides what the instant is for, what the
 * fields are called, and what to do with a `null` result — so neither feature has
 * to grow a second calendar.
 */
export function LocalDateTimeEditor(props: Readonly<{
    /** The instant the reading must be after; also the picker's minimum day. */
    nowMs: number;
    value: LocalDateTimeDraft;
    onChange: (value: LocalDateTimeDraft) => void;
    labels: Readonly<{ date: string; time: string; pastInstant: string }>;
    /** Distinguishes this editor's fields from any other on the same screen. */
    testIDPrefix: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const [pickerMode, setPickerMode] = React.useState<'date' | 'time' | null>(null);
    const dateAnchorRef = React.useRef<View | null>(null);
    const timeAnchorRef = React.useRef<View | null>(null);
    const parsed = parseLocalDateTime(props.value);
    const pickerValue = React.useMemo(
        () => new Date(parsed ?? props.nowMs),
        [parsed, props.nowMs],
    );

    const openPicker = React.useCallback((mode: 'date' | 'time') => {
        setPickerMode((current) => current === mode ? null : mode);
    }, []);

    const fieldStyle = {
        ...Typography.default(),
        color: theme.colors.text.primary,
        backgroundColor: theme.colors.input.background,
        borderColor: theme.colors.border.default,
        borderWidth: 1,
        borderRadius: 12,
        paddingLeft: 13,
        paddingRight: 48,
        paddingVertical: 11,
        fontSize: 16,
    };
    const accessoryStyle = ({ pressed }: Readonly<{ pressed: boolean }>) => ({
        position: 'absolute' as const,
        right: 4,
        top: 4,
        bottom: 4,
        width: 40,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        opacity: pressed ? 0.55 : 1,
    });

    return (
        <View style={{ gap: 16 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1, gap: 7 }}>
                    <Text style={{ color: theme.colors.text.secondary, fontSize: 13 }}>{props.labels.date}</Text>
                    <View ref={dateAnchorRef} style={{ position: 'relative' }}>
                        <TextInput
                            testID={`${props.testIDPrefix}-date-input`}
                            accessibilityLabel={props.labels.date}
                            value={props.value.date}
                            onChangeText={(date) => props.onChange({ ...props.value, date })}
                            placeholder="YYYY-MM-DD"
                            style={fieldStyle}
                        />
                        <Pressable
                            testID={`${props.testIDPrefix}-date-picker-button`}
                            accessibilityRole="button"
                            accessibilityLabel={props.labels.date}
                            hitSlop={8}
                            onPress={() => openPicker('date')}
                            style={accessoryStyle}
                        >
                            <Icon name="calendar" size={18} color={theme.colors.text.secondary} />
                        </Pressable>
                    </View>
                </View>
                <View style={{ width: 132, gap: 7 }}>
                    <Text style={{ color: theme.colors.text.secondary, fontSize: 13 }}>{props.labels.time}</Text>
                    <View ref={timeAnchorRef} style={{ position: 'relative' }}>
                        <TextInput
                            testID={`${props.testIDPrefix}-time-input`}
                            accessibilityLabel={props.labels.time}
                            value={props.value.time}
                            onChangeText={(time) => props.onChange({ ...props.value, time })}
                            placeholder="09:00"
                            keyboardType="numbers-and-punctuation"
                            style={fieldStyle}
                        />
                        <Pressable
                            testID={`${props.testIDPrefix}-time-picker-button`}
                            accessibilityRole="button"
                            accessibilityLabel={props.labels.time}
                            hitSlop={8}
                            onPress={() => openPicker('time')}
                            style={accessoryStyle}
                        >
                            <Icon name="clock" size={18} color={theme.colors.text.secondary} />
                        </Pressable>
                    </View>
                </View>
            </View>

            {pickerMode ? <DateTimePickerPopover
                mode={pickerMode}
                anchorRef={pickerMode === 'date' ? dateAnchorRef : timeAnchorRef}
                value={pickerValue}
                minimumDate={new Date(props.nowMs)}
                accentColor={theme.colors.text.link}
                onDismiss={() => setPickerMode(null)}
                onChange={(value) => {
                    props.onChange(pickerMode === 'date'
                        ? { ...props.value, date: formatLocalDateInput(value) }
                        : { ...props.value, time: formatLocalTimeInput(value) });
                }}
            /> : null}

            {parsed !== null && parsed <= props.nowMs ? (
                <Text
                    testID={`${props.testIDPrefix}-past-instant`}
                    style={{ color: theme.colors.state.danger.foreground, fontSize: 13 }}
                >
                    {props.labels.pastInstant}
                </Text>
            ) : null}
        </View>
    );
}

/** The instant this reading names, but only when it is a real future moment. */
export function resolveFutureLocalDateTime(
    value: LocalDateTimeDraft,
    nowMs: number,
): number | null {
    const parsed = parseLocalDateTime(value);
    return parsed !== null && parsed > nowMs ? parsed : null;
}
