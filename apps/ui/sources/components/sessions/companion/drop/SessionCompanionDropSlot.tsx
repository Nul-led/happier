import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { useSessionCompanionDropView } from './sessionCompanionDropStore';

const stylesheet = StyleSheet.create((theme) => ({
    slot: {
        marginTop: 12,
        height: 72,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: theme.colors.border.strong,
    },
    slotHovering: {
        borderStyle: 'solid',
        borderColor: theme.colors.text.link,
        backgroundColor: theme.colors.surface.selected,
    },
    label: { ...Typography.default('semiBold'), fontSize: 13, color: theme.colors.text.secondary },
    labelHovering: { color: theme.colors.text.link },
}));

/**
 * The "Keep beside your chat" slot that appears in the Companion rail only while a
 * Board card is being dragged (lab CM). It subscribes to two booleans; pointer
 * movement never re-renders the column.
 */
export const SessionCompanionDropSlot = React.memo(function SessionCompanionDropSlot(props: Readonly<{
    sessionId: string;
    testID: string;
}>) {
    const { theme } = useUnistyles();
    const view = useSessionCompanionDropView(props.sessionId);
    if (!view.dragging) return null;
    return (
        <View
            testID={props.testID}
            style={[stylesheet.slot, view.hovering ? stylesheet.slotHovering : null]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            <Icon name="stack-simple" size={15} color={view.hovering ? theme.colors.text.link : theme.colors.text.secondary} />
            <Text style={[stylesheet.label, view.hovering ? stylesheet.labelHovering : null]}>
                {t('sessionCompanion.drop.keepBesideChat')}
            </Text>
        </View>
    );
});
