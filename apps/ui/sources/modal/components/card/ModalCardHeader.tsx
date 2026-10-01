import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useDeviceType } from '@/utils/platform/responsive';

import { ModalCloseButton } from './ModalCloseButton';

type ModalCardHeaderProps = Readonly<{
    leading?: React.ReactNode;
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
    onClose?: () => void;
    testID?: string;
    titleTestID?: string;
    subtitleTestID?: string;
    closeButtonTestID?: string;
    style?: StyleProp<ViewStyle>;
}>;

/**
 * The task-modal title band (craft pass S3): a compact row — title, optional actions, close — with no
 * divider, so the content starts right under it. It is the one card header; search and the command
 * palette pass `header: 'none'` to the card chrome and render none.
 */
const TITLE_BAND_MIN_HEIGHT = 52;

const stylesheet = StyleSheet.create((theme) => ({
    header: {
        minHeight: TITLE_BAND_MIN_HEIGHT,
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    headerWithSubtitle: {
        alignItems: 'flex-start',
        paddingTop: 14,
    },
    headerLeadingWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
        gap: 10,
    },
    titleWrap: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    title: {
        fontSize: 15,
        lineHeight: 20,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    actionsWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    stacked: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 10,
        gap: 8,
    },
    stackedTop: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    stackedActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
    },
}));

export function ModalCardHeader(props: ModalCardHeaderProps) {
    useUnistyles();
    const styles = stylesheet;
    const hasVisibleTitle = props.title != null || props.subtitle != null;
    const showClose = typeof props.onClose === 'function';
    const stackOnPhone = useDeviceType() === 'phone';

    if (!hasVisibleTitle && !props.leading && !props.actions && !showClose) {
        return null;
    }

    // A phone card is too narrow to share one row between the title and wide actions (a machine chip
    // squeezed the title into a two-word column): the title keeps the row with the close button, and
    // the subtitle and the actions take the full width beneath it.
    if (stackOnPhone && props.actions != null && hasVisibleTitle) {
        return (
            <View testID={props.testID ?? 'modal-card-header'} style={[styles.stacked, props.style]}>
                <View style={styles.stackedTop}>
                    <View style={styles.headerLeadingWrap}>
                        {props.leading}
                        <View style={styles.titleWrap}>
                            {props.title != null ? (
                                <Text testID={props.titleTestID} style={styles.title}>{props.title}</Text>
                            ) : null}
                        </View>
                    </View>
                    {showClose ? <ModalCloseButton testID={props.closeButtonTestID} onPress={props.onClose} /> : null}
                </View>
                {props.subtitle != null ? (
                    <Text testID={props.subtitleTestID} style={styles.subtitle}>{props.subtitle}</Text>
                ) : null}
                <View style={styles.stackedActions} testID="modal-card-header-actions-row">{props.actions}</View>
            </View>
        );
    }

    return (
        <View
            testID={props.testID ?? 'modal-card-header'}
            style={[styles.header, props.subtitle != null ? styles.headerWithSubtitle : null, props.style]}
        >
            <View style={styles.headerLeadingWrap}>
                {props.leading}
                {hasVisibleTitle ? (
                    <View style={styles.titleWrap}>
                        {props.title != null ? (
                            <Text testID={props.titleTestID} style={styles.title}>{props.title}</Text>
                        ) : null}
                        {props.subtitle != null ? (
                            <Text testID={props.subtitleTestID} style={styles.subtitle}>{props.subtitle}</Text>
                        ) : null}
                    </View>
                ) : (
                    <View style={styles.titleWrap} />
                )}
            </View>

            <View style={styles.actionsWrap}>
                {props.actions}
                {showClose ? <ModalCloseButton testID={props.closeButtonTestID} onPress={props.onClose} /> : null}
            </View>
        </View>
    );
}
