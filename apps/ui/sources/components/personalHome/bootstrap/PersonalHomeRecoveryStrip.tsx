import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { SystemTaskRunState } from '@/components/systemTasks/types';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { PersonalHomeDiagnosticDetails } from '../setup/PersonalHomeDiagnosticDetails';
import type { NormalizedSetupDetail } from './personalHomeBootstrapTypes';

const styles = StyleSheet.create((theme) => ({
    root: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: 16,
        paddingBottom: 20,
        gap: 10,
        backgroundColor: theme.colors.background.canvas,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.default,
    },
    message: { ...Typography.default(), color: theme.colors.text.secondary, fontSize: 13, lineHeight: 19 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    button: {
        minHeight: 44,
        alignSelf: 'flex-start',
        borderRadius: 12,
        paddingHorizontal: 16,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.button.primary.background,
        backgroundColor: theme.colors.button.primary.background,
    },
    secondaryButton: { backgroundColor: theme.colors.background.canvas, borderColor: theme.colors.border.default },
    buttonText: { ...Typography.default('semiBold'), color: theme.colors.button.primary.tint },
    secondaryButtonText: { ...Typography.default('semiBold'), color: theme.colors.text.primary },
    details: { width: '100%' },
}));

/**
 * Post-shell recovery for secondary Personal Home work such as profile completion or daemon
 * preparation. The usable Home stays released while the same controller operation is retried.
 */
export const PersonalHomeRecoveryStrip = React.memo(function PersonalHomeRecoveryStrip(props: Readonly<{
    kind: 'profile' | 'computer';
    activeTask?: SystemTaskRunState | null;
    detail?: NormalizedSetupDetail;
    onOpenDetails?: () => void;
    onRetry?: () => void;
}>) {
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const message = props.kind === 'computer'
        ? t('personalHome.bootstrap.computerRecoveryBody')
        : t('personalHome.bootstrap.profileRecoveryBody');
    const hasDetails = props.onOpenDetails != null || props.activeTask != null || props.detail != null;
    const openDetails = React.useCallback(() => {
        if (props.onOpenDetails) {
            props.onOpenDetails();
            return;
        }
        setDetailsOpen((value) => !value);
    }, [props.onOpenDetails]);
    return (
        <View
            testID="personal-home-recovery-strip"
            accessibilityLiveRegion="polite"
            style={styles.root}
        >
            <Text style={styles.message}>{message}</Text>
            <View style={styles.actions}>
                {props.onRetry ? (
                    <Pressable
                        testID="personal-home-recovery-retry"
                        accessibilityRole="button"
                        accessibilityLabel={t('common.retry')}
                        onPress={props.onRetry}
                        style={styles.button}
                    >
                        <Text style={styles.buttonText}>{t('common.retry')}</Text>
                    </Pressable>
                ) : null}
                {hasDetails ? (
                    <Pressable
                        testID="personal-home-recovery-details"
                        accessibilityRole="button"
                        accessibilityLabel={t('common.details')}
                        accessibilityState={props.onOpenDetails ? undefined : { expanded: detailsOpen }}
                        onPress={openDetails}
                        style={[styles.button, styles.secondaryButton]}
                    >
                        <Text style={styles.secondaryButtonText}>{t('common.details')}</Text>
                    </Pressable>
                ) : null}
            </View>
            {detailsOpen && (props.activeTask || props.detail) ? (
                <View testID="personal-home-recovery-details-panel" style={styles.details}>
                    <PersonalHomeDiagnosticDetails detail={props.detail} activeTask={props.activeTask} />
                </View>
            ) : null}
        </View>
    );
});
