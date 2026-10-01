import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    chip: {
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: theme.colors.surface.inset,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    headerText: {
        ...Typography.default('semiBold'),
        flexShrink: 1,
        color: theme.colors.text.secondary,
        fontSize: 12.5,
    },
    quote: {
        ...Typography.default(),
        color: theme.colors.text.secondary,
        fontSize: 13,
        lineHeight: 19,
    },
}));

/**
 * The conversation an Agent conversation was started from, as one chip: where it came from and how
 * many messages it carries, with the messages themselves when this surface holds them (the draft).
 * The draft and the running conversation's header draw the same chip.
 */
export const ExecutionRunContextChip = React.memo((props: Readonly<{
    /** The source conversation's title; null while it is unknown. */
    title: string | null;
    messageCount: number;
    /** The selected messages as text, when this surface has them. */
    quote?: string | null;
    testID?: string;
}>) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const label = props.title
        ? t('sessionConversation.context.fromConversation', { title: props.title, count: props.messageCount })
        : t('sessionConversation.context.fromUntitled', { count: props.messageCount });
    return (
        <View testID={props.testID} style={styles.chip}>
            <View style={styles.header}>
                <Icon name="chat-circle" size={14} color={theme.colors.text.secondary} />
                <Text numberOfLines={1} style={styles.headerText}>{label}</Text>
            </View>
            {props.quote ? <Text numberOfLines={6} style={styles.quote}>{props.quote}</Text> : null}
        </View>
    );
});
