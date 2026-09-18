import { HappierPressable } from '@happier-dev/plugin-ui/presentation';
import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { WelcomeActionAdmissionContext } from './WelcomeActionList';

export const WelcomeActionCard = React.memo(function WelcomeActionCard(props: Readonly<{
    testID: string;
    actionId?: string;
    title: string;
    subtitle?: string;
    primary?: boolean;
    iconName?: IconName;
    /**
     * Back/Cancel and other escapes leave the current task instead of competing
     * with it. Admission exists to stop a second *mutation* while one is in
     * flight; locking the way out behind a multi-second KDF or network wait
     * would strand the person inside it. An escape is therefore not an admitted
     * action: it stays operable and runs immediately.
     */
    escape?: boolean;
    onPress: () => Promise<void> | void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const admission = React.useContext(WelcomeActionAdmissionContext);
    const primary = props.primary === true;
    const escape = props.escape === true;
    const actionId = props.actionId ?? props.testID;
    const pending = !escape && admission.pendingActionId === actionId;
    const subtitleId = props.subtitle ? `welcome-action-description-${encodeURIComponent(actionId)}` : undefined;
    const foreground = primary ? theme.colors.button.primary.tint : theme.colors.text.primary;
    const subtitleColor = primary ? theme.colors.button.primary.tint : theme.colors.text.secondary;

    return (
        <HappierPressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={props.title}
            accessibilityHint={props.subtitle}
            describedById={subtitleId}
            disabled={!escape && admission.pendingActionId !== null}
            busy={pending}
            onPress={escape ? () => props.onPress() : () => admission.run(actionId, props.onPress)}
            style={({ pressed, hovered, focused }) => [
                styles.card,
                primary
                    ? { backgroundColor: theme.colors.button.primary.background, borderColor: theme.colors.button.primary.background }
                    : { backgroundColor: hovered ? theme.colors.surface.elevated : theme.colors.surface.base, borderColor: theme.colors.border.default },
                pressed ? styles.pressed : null,
                focused ? styles.focused : null,
            ]}
        >
            <View testID={`${props.testID}-text`} style={styles.textBlock}>
                <Text testID={`${props.testID}-title`} style={[styles.title, { color: foreground }]}>{props.title}</Text>
                {props.subtitle ? <Text nativeID={subtitleId} testID={`${props.testID}-subtitle`} style={[styles.subtitle, { color: subtitleColor }]}>{props.subtitle}</Text> : null}
            </View>
            {pending ? <ActivitySpinner color={foreground} /> : props.iconName ? (
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Icon testID={`${props.testID}-icon`} name={props.iconName} size={20} color={foreground} />
                </View>
            ) : null}
        </HappierPressable>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    card: {
        minHeight: 66,
        borderWidth: 1,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
    },
    pressed: { opacity: 0.88 },
    focused: { borderColor: theme.colors.border.focus },
    textBlock: { flex: 1, gap: 0 },
    title: { ...Typography.default('semiBold'), fontSize: 16, lineHeight: 22 },
    subtitle: { ...Typography.default(), fontSize: 13, lineHeight: 18 },
}));
