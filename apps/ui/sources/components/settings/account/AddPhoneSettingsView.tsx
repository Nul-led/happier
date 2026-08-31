import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/context/AuthContext';
import { authAccountApprove } from '@/auth/flows/accountApprove';
import { usePairingSession } from '@/hooks/auth/usePairingSession';
import { pairingConsume } from '@/sync/api/account/apiPairingAuth';
import { decodeBase64 } from '@/encryption/base64';
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
    computeHomeQrConfirmationCodeV2,
    deriveHomeQrBindingKeyV2,
    verifyHomeQrBindingProofV2,
} from '@happier-dev/protocol';
import { resolveProvisioningMaterial } from '@/auth/terminal/resolveProvisioningMaterial';
import {
    buildTerminalResponseV3,
    buildTerminalTokenOnlyResponseV3,
} from '@/auth/terminal/terminalProvisioning';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import {
    formatEnrollmentExpiry,
    formatHomeEnrollmentTargetLabel,
    formatPairingConfirmationCode,
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
    confirmCode: {
        marginTop: 10,
        fontSize: 28,
        lineHeight: 34,
        color: theme.colors.text.primary,
        letterSpacing: 2,
        fontVariant: ['tabular-nums'],
        ...Typography.mono(),
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
        deepLink,
        status,
        approvalContext,
        isExpired,
        isStarting: starting,
        startPairing,
        clearSession,
    } = usePairingSession({
        enabled: pairingEnabled,
        isAuthenticated: auth.isAuthenticated,
    });

    const [approving, setApproving] = React.useState(false);
    const [showLink, setShowLink] = React.useState(false);
    const copyFeedback = useTemporaryCopyFeedback();
    const targetLabel = approvalContext
        ? formatHomeEnrollmentTargetLabel(approvalContext.target.descriptor)
        : null;

    React.useEffect(() => {
        setShowLink(false);
    }, [deepLink]);

    const verifiedRequest = React.useMemo(() => {
        if (!status || status.state !== 'requested' || !approvalContext) return null;
        if (status.pairId !== approvalContext.pairId) return null;
        if (status.homeServerIdentityId !== approvalContext.target.descriptor.homeServerIdentityId) return null;
        if (Date.parse(status.expiresAt) !== approvalContext.expiresAtMs) return null;
        if (Date.now() < approvalContext.issuedAtMs || Date.now() >= approvalContext.expiresAtMs) return null;
        let publicKey: Uint8Array;
        try {
            publicKey = decodeBase64(status.requestedPublicKey, 'base64');
        } catch {
            return null;
        }
        if (publicKey.length !== 32) return null;
        const bindingParams = {
            qrSecret: approvalContext.qrSecret,
            pairId: approvalContext.pairId,
            homeServerIdentityId: approvalContext.target.descriptor.homeServerIdentityId,
            requesterPublicKey: publicKey,
            expiresAtMs: approvalContext.expiresAtMs,
        };
        if (!status.bindingProof || !verifyHomeQrBindingProofV2(bindingParams, status.bindingProof)) return null;
        return {
            publicKey,
            confirmCode: computeHomeQrConfirmationCodeV2(bindingParams),
            expiresAtMs: approvalContext.expiresAtMs,
        };
    }, [approvalContext, status]);

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

    const approve = React.useCallback(async () => {
        if (!status || status.state !== 'requested' || !approvalContext || !verifiedRequest) return;

        setApproving(true);
        try {
            const targetCredentials = await TokenStorage.getCredentialsForServerUrl(
                approvalContext.target.descriptor.canonicalServerUrl,
                { serverId: approvalContext.target.serverId },
            );
            if (!targetCredentials) {
                throw new Error('Captured Home credentials are unavailable');
            }
            const material = resolveProvisioningMaterial(targetCredentials);
            const common = {
                terminalEphemeralPublicKey: verifiedRequest.publicKey,
                pairingSecret: deriveHomeQrBindingKeyV2(approvalContext.qrSecret),
                createdAtMs: approvalContext.issuedAtMs,
                expiresAtMs: approvalContext.expiresAtMs,
            };
            const response = material.type === 'tokenOnly'
                ? buildTerminalTokenOnlyResponseV3(common)
                : buildTerminalResponseV3({ ...common, contentPrivateKey: material.key });

            await authAccountApprove({
                token: targetCredentials.token,
                target: approvalContext.target,
                pairId: approvalContext.pairId,
                publicKey: verifiedRequest.publicKey,
                response,
                homeServerIdentityId: approvalContext.target.descriptor.homeServerIdentityId,
                responseKind: material.type,
            });

            await Modal.alertAsync(t('common.success'), t('common.done'));
            void startPairingWithAlert();
        } catch (e) {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setApproving(false);
        }
    }, [approvalContext, status, startPairingWithAlert, verifiedRequest]);

    const reject = React.useCallback(async () => {
        if (!status || status.state !== 'requested' || !approvalContext || !verifiedRequest) return;

        setApproving(true);
        try {
            const rejected = await pairingConsume(
                { pairId: status.pairId, intent: 'reject' },
                approvalContext.target,
            );
            if (!rejected.ok) {
                throw new Error(`Failed to reject pairing session: ${rejected.status}`);
            }
            void startPairingWithAlert();
        } catch {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setApproving(false);
        }
    }, [approvalContext, status, startPairingWithAlert, verifiedRequest]);

    const cancel = React.useCallback(async () => {
        if (!status || status.state !== 'pending' || !approvalContext) return;

        setApproving(true);
        try {
            const cancelled = await pairingConsume(
                { pairId: status.pairId, intent: 'cancel' },
                approvalContext.target,
            );
            if (!cancelled.ok) {
                throw new Error(`Failed to cancel pairing session: ${cancelled.status}`);
            }
            clearSession();
        } catch {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setApproving(false);
        }
    }, [approvalContext, clearSession, status]);

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
                            {targetLabel && approvalContext ? (
                                <View style={styles.identityRow}>
                                    <Text style={styles.identityLabel}>{t('common.home')}</Text>
                                    <Text style={styles.identityValue} numberOfLines={2}>{targetLabel}</Text>
                                    <Text style={styles.identityLabel}>
                                        {t('connect.expiresAtLabel')}: {formatEnrollmentExpiry(approvalContext.expiresAtMs)}
                                    </Text>
                                </View>
                            ) : null}

                            <View style={styles.qrBlock}>
                                <View
                                    testID="add-phone-qr"
                                    accessible
                                    accessibilityLabel={targetLabel
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
                                {starting ? (
                                    <ActivitySpinner size="small" color={theme.colors.text.primary} />
                                ) : deepLink ? (
                                    <QRCode
                                        data={deepLink}
                                        size={ADD_PHONE_QR_SIZE}
                                        foregroundColor={theme.colors.text.primary}
                                        backgroundColor={theme.colors.surface.base}
                                    />
                                ) : (
                                    <Text style={styles.requestBody}>
                                        {isExpired ? t('connect.pairingQrExpired') : t('common.unavailable')}
                                    </Text>
                                )}
                                </View>
                            </View>

                            {deepLink && showLink ? (
                                <View testID="add-phone-pairing-link" style={styles.linkRow}>
                                    <Text style={styles.linkText} numberOfLines={3}>
                                        {deepLink}
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
                                                    const copied = await setClipboardStringSafe(deepLink);
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
                                {deepLink && !showLink ? (
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
                                <View style={styles.actionButton}>
                                    <RoundButton
                                        testID="add-phone-generate"
                                        size="small"
                                        title={t('connect.generateNewQrCode')}
                                        action={startPairingWithAlert}
                                        display="inverted"
                                        disabled={starting || approving || status !== null}
                                    />
                                </View>
                            </View>

                            {status?.state === 'pending' && approvalContext ? (
                                <View style={styles.footer}>
                                    <RoundButton
                                        testID="add-phone-cancel"
                                        size="normal"
                                        title={t('common.cancel')}
                                        action={cancel}
                                        display="inverted"
                                        disabled={approving}
                                        loading={approving}
                                    />
                                </View>
                            ) : null}

                            {status?.state === 'requested' && verifiedRequest ? (
                                <View
                                    testID="add-phone-request-card"
                                    style={styles.requestCard}
                                    accessibilityLiveRegion="polite"
                                >
                                    <Text style={styles.requestTitle}>{t('connect.pairingRequestTitle')}</Text>
                                    {targetLabel ? (
                                        <Text style={styles.requestBody}>
                                            {t('common.home')}: {targetLabel}
                                        </Text>
                                    ) : null}
                                    {status.requestedDeviceLabel ? (
                                        <Text style={styles.requestBody}>
                                            {t('connect.deviceLabel')}: <Text testID="add-phone-request-device-label">{status.requestedDeviceLabel}</Text>
                                        </Text>
                                    ) : null}
                                    <Text style={[styles.requestBody, { marginTop: 10 }]}>
                                        {t('connect.expiresAtLabel')}: {formatEnrollmentExpiry(verifiedRequest.expiresAtMs)}
                                    </Text>
                                    <Text style={[styles.requestBody, { marginTop: 10 }]}>{t('connect.confirmCodeLabel')}</Text>
                                    <Text
                                        testID="add-phone-request-confirm-code"
                                        style={styles.confirmCode}
                                        accessibilityLabel={`${t('connect.confirmCodeLabel')}: ${formatPairingConfirmationCode(verifiedRequest.confirmCode)}`}
                                    >
                                        {formatPairingConfirmationCode(verifiedRequest.confirmCode)}
                                    </Text>
                                    <Text style={[styles.requestBody, { marginTop: 10 }]}>
                                        {t('connect.confirmCodeComparisonBody')}
                                    </Text>
                                    <View style={styles.footer}>
                                        <RoundButton
                                            testID="add-phone-reject"
                                            size="normal"
                                            title={t('approvals.reject')}
                                            action={reject}
                                            display="inverted"
                                            disabled={approving}
                                        />
                                        <RoundButton
                                            testID="add-phone-approve"
                                            size="normal"
                                            title={t('connect.approveButton')}
                                            action={approve}
                                            disabled={approving}
                                            loading={approving}
                                        />
                                    </View>
                                </View>
                            ) : null}
                        </>
                    ) : null}
                </View>
            </View>
        </ScrollView>
    );
});
