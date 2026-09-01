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
import { CopiedPill } from '@/components/ui/copy/CopiedPill';
import { useTemporaryCopyFeedback } from '@/components/ui/copy/useTemporaryCopyFeedback';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import {
    formatEnrollmentExpiry,
    formatHomeEnrollmentTargetLabel,
} from '@/auth/pairing/pairingPresentation';

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
    linkRow: {
        marginTop: 8,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface.base,
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
    linkText: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        lineHeight: 16,
        ...Typography.mono(),
    },
    linkWarning: {
        marginBottom: 8,
        fontSize: 13,
        color: theme.colors.text.secondary,
        lineHeight: 18,
        ...Typography.default(),
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
    const pairingDecision = useFeatureDecision('auth.pairing.desktopQrMobileScan');
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
    const [showLink, setShowLink] = React.useState(false);
    const copyFeedback = useTemporaryCopyFeedback();
    const presentationContext = 'context' in presentation ? presentation.context : null;
    const targetLabel = presentationContext
        ? formatHomeEnrollmentTargetLabel(presentationContext.target.descriptor)
        : null;
    const visibleDeepLink = presentation.phase === 'ready' ? presentation.deepLink : null;

    React.useEffect(() => {
        setShowLink(false);
    }, [visibleDeepLink]);

    const startPairingWithAlert = React.useCallback(async () => {
        const res = await startPairing();
        if (!res.ok && auth.isAuthenticated && pairingEnabled) {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
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
                            {targetLabel && presentationContext ? (
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

                            {visibleDeepLink && showLink ? (
                                <View testID="add-phone-pairing-link" style={styles.linkRow}>
                                    <Text style={styles.linkWarning}>
                                        {t('connect.pairingLinkSecurityWarning')}
                                    </Text>
                                    <Text style={styles.linkText} numberOfLines={3}>
                                        {visibleDeepLink}
                                    </Text>
                                    <CopiedPill visible={copyFeedback.isCopied()} testID="add-phone-pairing-link-copy-feedback" />
                                    <View style={styles.linkActionsRow}>
                                        <View style={styles.actionButton}>
                                            <RoundButton
                                                testID="add-phone-copy-link"
                                                size="small"
                                                title={t('common.copy')}
                                                display="inverted"
                                                action={async () => {
                                                    const copied = await setClipboardStringSafe(visibleDeepLink);
                                                    if (!copied) {
                                                        await Modal.alertAsync(t('common.error'), t('items.failedToCopyToClipboard'));
                                                        return;
                                                    }
                                                    copyFeedback.markCopied();
                                                }}
                                            />
                                        </View>
                                    </View>
                                </View>
                            ) : null}

                            <View style={styles.linkActionsRow}>
                                {visibleDeepLink && !showLink ? (
                                    <View style={styles.actionButton}>
                                        <RoundButton
                                            testID="add-phone-show-link"
                                            size="small"
                                            title={t('connect.showPairingLink')}
                                            action={async () => setShowLink(true)}
                                            display="inverted"
                                        />
                                    </View>
                                ) : null}
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

                            {presentation.phase === 'verifying'
                                || presentation.phase === 'adding'
                                || presentation.phase === 'retryable_error' ? (
                                <View
                                    testID="add-phone-request-card"
                                    style={styles.requestCard}
                                    accessibilityLiveRegion="polite"
                                >
                                    <Text style={styles.requestTitle}>{t('connect.securingCredentials')}</Text>
                                    <Text style={styles.requestBody}>{t('common.loading')}</Text>
                                </View>
                            ) : null}

                            {presentation.phase === 'succeeded' ? (
                                <View testID="add-phone-complete" style={styles.requestCard} accessibilityLiveRegion="polite">
                                    <Text style={styles.requestTitle}>{t('common.success')}</Text>
                                    <Text style={styles.requestBody}>
                                        {t('connect.requestingDeviceLabel')}: {presentation.requestedDeviceLabel ?? t('connect.deviceLabel')}
                                    </Text>
                                    {targetLabel ? (
                                        <Text style={styles.requestBody}>{t('common.home')}: {targetLabel}</Text>
                                    ) : null}
                                </View>
                            ) : null}

                            {presentation.phase === 'expired' ? (
                                <View testID="add-phone-expired" style={styles.requestCard} accessibilityLiveRegion="polite">
                                    <Text style={styles.requestTitle}>{t('connect.pairingQrExpired')}</Text>
                                </View>
                            ) : null}

                            {presentation.phase === 'invalid_request' ? (
                                <View testID="add-phone-invalid-request" style={styles.requestCard} accessibilityLiveRegion="polite">
                                    <Text style={styles.requestTitle}>{t('common.error')}</Text>
                                    <Text style={styles.requestBody}>{t('errors.operationFailed')}</Text>
                                </View>
                            ) : null}
                        </>
                    ) : null}
                </View>
            </View>
        </ScrollView>
    );
});
