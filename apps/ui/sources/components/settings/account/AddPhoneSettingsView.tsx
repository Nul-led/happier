import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/context/AuthContext';
import { usePairingSession } from '@/hooks/auth/usePairingSession';
import { QRCode } from '@/components/qr/QRCode';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { Typography } from '@/constants/Typography';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import {
    formatEnrollmentExpiry,
    formatHomeEnrollmentTargetLabel,
    resolveHomeEnrollmentPresentation,
} from '@/auth/pairing/pairingPresentation';
import { PairingLinkDisclosure } from '@/components/auth/pairing/PairingLinkDisclosure';

const ADD_PHONE_QR_SIZE = 240;

const stylesheet = StyleSheet.create((theme) => ({
    scrollView: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
    },
    container: {
        flex: 1,
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    contentWrapper: {
        width: '100%',
        maxWidth: 560,
        paddingVertical: 28,
    },
    title: {
        fontSize: 18,
        color: theme.colors.text.primary,
        marginBottom: 8,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 14,
        color: theme.colors.text.secondary,
        lineHeight: 20,
        ...Typography.default(),
    },
    qrBlock: {
        marginTop: 18,
        marginBottom: 10,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        paddingVertical: 10,
    },
    identityRow: {
        marginTop: 14,
        alignItems: 'center',
    },
    identityLabel: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        lineHeight: 18,
        ...Typography.default(),
    },
    identityValue: {
        marginTop: 3,
        fontSize: 14,
        color: theme.colors.text.primary,
        lineHeight: 20,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    qrUnavailable: {
        width: '100%',
        maxWidth: ADD_PHONE_QR_SIZE,
        paddingHorizontal: 8,
        alignItems: 'center',
    },
    qrUnavailableTitle: {
        fontSize: 14,
        color: theme.colors.text.primary,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    qrUnavailableBody: {
        marginTop: 6,
        fontSize: 13,
        color: theme.colors.text.secondary,
        lineHeight: 18,
        textAlign: 'center',
        ...Typography.default(),
    },
    linkActionsRow: {
        marginTop: 12,
        flexDirection: 'row',
        gap: 12,
    },
    actionButton: {
        flex: 1,
    },
    requestCard: {
        marginTop: 18,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: theme.colors.surface.base,
    },
    requestTitle: {
        fontSize: 15,
        color: theme.colors.text.primary,
        marginBottom: 8,
        ...Typography.default('semiBold'),
    },
    requestBody: {
        fontSize: 14,
        color: theme.colors.text.secondary,
        lineHeight: 20,
        ...Typography.default(),
    },
    footer: {
        marginTop: 16,
        gap: 12,
    },
}));

export const AddPhoneSettingsView = React.memo(function AddPhoneSettingsView() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const auth = useAuth();
    const pairingDecision = useFeatureDecision('auth.pairing.boundQrV2');
    const pairingState = pairingDecision?.state ?? 'unknown';
    const pairingEnabled = pairingState === 'enabled';

    const {
        presentation,
        isStarting: starting,
        startPairing,
        cancelPairing,
    } = usePairingSession({
        enabled: pairingEnabled,
        isAuthenticated: auth.isAuthenticated,
    });

    const [cancelling, setCancelling] = React.useState(false);
    const enrollmentPresentation = resolveHomeEnrollmentPresentation({
        kind: 'trusted_home_display',
        phase: presentation.phase,
    });
    const presentationContext = 'context' in presentation ? presentation.context : null;
    const targetLabel = presentationContext
        ? formatHomeEnrollmentTargetLabel(presentationContext.target.descriptor)
        : null;
    const visibleDeepLink = presentation.phase === 'ready' ? presentation.deepLink : null;

    const startPairingWithAlert = React.useCallback(async () => {
        const res = await startPairing();
        if (!res.ok && auth.isAuthenticated && pairingEnabled) {
            await Modal.alertAsync(
                t(res.reason === 'update_required' ? 'connect.updateRequiredTitle' : 'common.error'),
                t(res.reason === 'update_required' ? 'connect.updateRequiredBody' : 'errors.operationFailed'),
            );
        }
    }, [auth.isAuthenticated, pairingEnabled, startPairing]);

    React.useEffect(() => {
        if (!auth.isAuthenticated) return;
        if (!pairingEnabled) return;
        void startPairingWithAlert();
    }, [auth.isAuthenticated, pairingEnabled, startPairingWithAlert]);

    const cancel = React.useCallback(async () => {
        setCancelling(true);
        try {
            const cancelled = await cancelPairing();
            if (!cancelled.ok) {
                throw new Error(`Failed to cancel pairing session: ${cancelled.status}`);
            }
        } catch {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setCancelling(false);
        }
    }, [cancelPairing]);

    const isAuthenticated = auth.isAuthenticated;
    const canRenderPairing = pairingEnabled && isAuthenticated;

    return (
        <ScrollView style={styles.scrollView} contentContainerStyle={{ flexGrow: 1 }}>
            <View style={styles.container}>
                <View style={styles.contentWrapper}>
                    <Text style={styles.title}>{t('settings.addYourPhone')}</Text>
                    <Text style={styles.subtitle}>{t('connect.addPhoneQrInstructions')}</Text>

                    {!isAuthenticated ? (
                        <View style={styles.requestCard}>
                            <Text style={styles.requestBody}>{t('modals.pleaseSignInFirst')}</Text>
                        </View>
                    ) : null}

                    {isAuthenticated && pairingState === 'unknown' ? (
                        <View style={styles.requestCard}>
                            <Text style={styles.requestBody}>{t('common.loading')}</Text>
                        </View>
                    ) : null}

                    {isAuthenticated && pairingState !== 'unknown' && !pairingEnabled ? (
                        <View style={styles.requestCard}>
                            <Text style={styles.requestBody}>{t('common.unavailable')}</Text>
                        </View>
                    ) : null}

                    {canRenderPairing ? (
                        <>
                            {enrollmentPresentation.contextualFacts !== 'none' && targetLabel && presentationContext ? (
                                <View style={styles.identityRow}>
                                    <Text style={styles.identityLabel}>{t('common.home')}</Text>
                                    <Text style={styles.identityValue} numberOfLines={2}>{targetLabel}</Text>
                                    <Text style={styles.identityLabel}>
                                        {t('connect.expiresAtLabel')}: {formatEnrollmentExpiry(presentationContext.expiresAtMs)}
                                    </Text>
                                </View>
                            ) : null}

                            {presentation.phase === 'generating' || presentation.phase === 'ready' ? (
                                <View style={styles.qrBlock}>
                                <View
                                    testID="add-phone-qr"
                                    accessible
                                    accessibilityLabel={presentation.phase === 'ready' && !presentation.qrAvailable
                                        ? `${t('connect.pairingQrTooLargeTitle')}. ${t('connect.pairingQrTooLargeBody')}`
                                        : targetLabel
                                            ? `${t('connect.addPhoneQrInstructions')} ${t('common.home')}: ${targetLabel}`
                                            : t('connect.addPhoneQrInstructions')}
                                    style={{
                                        width: ADD_PHONE_QR_SIZE,
                                        maxWidth: '100%',
                                        aspectRatio: 1,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                {presentation.phase === 'generating' && starting ? (
                                    <ActivitySpinner size="small" color={theme.colors.text.primary} />
                                ) : presentation.phase === 'ready' && presentation.qrAvailable ? (
                                    <QRCode
                                        data={presentation.deepLink}
                                        size={ADD_PHONE_QR_SIZE}
                                        foregroundColor={theme.colors.text.primary}
                                        backgroundColor={theme.colors.surface.base}
                                    />
                                ) : presentation.phase === 'ready' ? (
                                    <View style={styles.qrUnavailable}>
                                        <Text style={styles.qrUnavailableTitle}>
                                            {t('connect.pairingQrTooLargeTitle')}
                                        </Text>
                                        <Text style={styles.qrUnavailableBody}>
                                            {t('connect.pairingQrTooLargeBody')}
                                        </Text>
                                    </View>
                                ) : (
                                    <Text style={styles.requestBody}>
                                        {t('common.unavailable')}
                                    </Text>
                                )}
                                </View>
                                </View>
                            ) : null}

                            {visibleDeepLink ? (
                                <PairingLinkDisclosure
                                    testIDPrefix="add-phone-pairing-link"
                                    link={visibleDeepLink}
                                />
                            ) : null}

                            <View style={styles.linkActionsRow}>
                                {presentation.phase === 'generating'
                                    || presentation.phase === 'ready'
                                    || presentation.phase === 'expired'
                                    || presentation.phase === 'invalid_request' ? (
                                    <View style={styles.actionButton}>
                                    <RoundButton
                                        testID="add-phone-generate"
                                        size="small"
                                        title={t('connect.generateNewQrCode')}
                                        action={startPairingWithAlert}
                                        display="inverted"
                                        disabled={starting || presentation.phase === 'ready'}
                                    />
                                </View>
                                ) : null}
                            </View>

                            {presentation.phase === 'ready' ? (
                                <View style={styles.footer}>
                                    <RoundButton
                                        testID="add-phone-cancel"
                                        size="normal"
                                        title={t('common.cancel')}
                                        action={cancel}
                                        display="inverted"
                                        disabled={cancelling}
                                        loading={cancelling}
                                    />
                                </View>
                            ) : null}

                            {presentation.phase === 'adding'
                                || presentation.phase === 'retryable_error' ? (
                                <View
                                    testID="add-phone-request-card"
                                    style={styles.requestCard}
                                    accessibilityLiveRegion={enrollmentPresentation.liveRegion}
                                >
                                    <Text style={styles.requestTitle}>{t(enrollmentPresentation.primaryTranslationKey)}</Text>
                                    {enrollmentPresentation.activity ? (
                                        <ActivitySpinner size="small" color={theme.colors.text.primary} />
                                    ) : null}
                                </View>
                            ) : null}

                            {presentation.phase === 'succeeded' ? (
                                <View testID="add-phone-complete" style={styles.requestCard} accessibilityLiveRegion={enrollmentPresentation.liveRegion}>
                                    <Text style={styles.requestTitle}>{t(enrollmentPresentation.primaryTranslationKey)}</Text>
                                    <Text style={styles.requestBody}>
                                        {t('connect.requestingDeviceLabel')}: {presentation.requestedDeviceLabel ?? t('connect.deviceLabel')}
                                    </Text>
                                    {targetLabel ? (
                                        <Text style={styles.requestBody}>{t('common.home')}: {targetLabel}</Text>
                                    ) : null}
                                </View>
                            ) : null}

                            {presentation.phase === 'expired' ? (
                                <View testID="add-phone-expired" style={styles.requestCard} accessibilityLiveRegion={enrollmentPresentation.liveRegion}>
                                    <Text style={styles.requestTitle}>{t(enrollmentPresentation.primaryTranslationKey)}</Text>
                                </View>
                            ) : null}

                            {presentation.phase === 'invalid_request' ? (
                                <View testID="add-phone-invalid-request" style={styles.requestCard} accessibilityLiveRegion={enrollmentPresentation.liveRegion}>
                                    <Text style={styles.requestTitle}>{t('common.error')}</Text>
                                    <Text style={styles.requestBody}>{t(enrollmentPresentation.primaryTranslationKey)}</Text>
                                </View>
                            ) : null}
                        </>
                    ) : null}
                </View>
            </View>
        </ScrollView>
    );
});
