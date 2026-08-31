import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { generateAuthKeyPair, authQRStart } from '@/auth/flows/qrStart';
import { authQRWait } from '@/auth/flows/qrWait';
import {
    parsePairingDeepLink,
    parseHomeQrInviteDeepLink,
} from '@/auth/pairing/pairingUrl';
import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { pairingRequest } from '@/sync/api/account/apiPairingAuth';
import { adoptHomeProfileWithCredentials } from '@/sync/domains/server/adoptHomeProfile';
import {
    computeHomeQrConfirmationCodeV2,
    computeHomeQrBindingProofV2,
    deriveHomeQrBindingKeyV2,
    deriveHomeQrRendezvousSecretV2,
    type HomeQrInviteV2,
} from '@happier-dev/protocol';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import type { HomeQrEnrollmentTarget } from '@/auth/flows/qrStart';
import { resolveHomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { Text } from '@/components/ui/text/Text';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Typography } from '@/constants/Typography';
import { QrCodeScannerView } from '@/components/qr/QrCodeScannerView';
import { trackAccountRestored } from '@/track';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { promptAccountConnectApprovalRequired } from './accountConnectApprovalGuidance';
import {
    formatEnrollmentExpiry,
    formatHomeEnrollmentTargetLabel,
    formatPairingConfirmationCode,
} from '@/auth/pairing/pairingPresentation';

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
    embeddedContainer: {
        flex: 0,
        paddingHorizontal: 0,
    },
    contentWrapper: {
        width: '100%',
        maxWidth: 560,
        paddingVertical: 28,
    },
    embeddedContentWrapper: {
        paddingVertical: 0,
    },
    title: {
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: -0.56,
        color: theme.colors.text.primary,
        marginBottom: 8,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 16,
        color: theme.colors.text.secondary,
        lineHeight: 24,
        textAlign: 'center',
        ...Typography.default(),
    },
    statusCard: {
        marginTop: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: theme.colors.surface.base,
    },
    embeddedStatusCard: {
        marginTop: 10,
    },
    codeLabel: {
        marginTop: 12,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    codeValue: {
        marginTop: 6,
        fontSize: 28,
        lineHeight: 34,
        color: theme.colors.text.primary,
        letterSpacing: 2,
        fontVariant: ['tabular-nums'],
        ...Typography.mono(),
    },
    footer: {
        marginTop: 12,
        alignItems: 'center',
        width: '100%',
        gap: 12,
    },
    embeddedFooter: {
        marginTop: 10,
    },
    footerButton: {
        width: '100%',
        maxWidth: 360,
    },
}));

function resolveDeviceLabel(): string | null {
    const name = Constants.deviceName ?? '';
    const trimmed = String(name).trim();
    if (trimmed) return trimmed;
    if (Platform.OS === 'ios') return 'iPhone';
    if (Platform.OS === 'android') return 'Android';
    return null;
}

export type RestoreScanComputerQrViewProps = Readonly<{
    embedded?: boolean;
    initialPairingLink?: string | null;
    onBack?: () => void;
    onOpenSecretKeyLogin?: () => void;
    onShowQrInstead?: () => void;
}>;

export const RestoreScanComputerQrView = React.memo(function RestoreScanComputerQrView(props: RestoreScanComputerQrViewProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const isFocused = useIsFocused();
    const embedded = props.embedded === true;
    const pairingDecision = useFeatureDecision('auth.pairing.desktopQrMobileScan');
    const pairingState = pairingDecision?.state ?? 'unknown';

    const [phase, setPhase] = React.useState<'idle' | 'requesting' | 'waiting' | 'securing'>('idle');
    const [confirmCode, setConfirmCode] = React.useState<string | null>(null);
    const [activeInvite, setActiveInvite] = React.useState<HomeQrInviteV2 | null>(null);
    const nextAttemptIdRef = React.useRef(0);
    const activeAttemptRef = React.useRef<{
        id: number;
        controller: AbortController;
        cancellable: boolean;
    } | null>(null);

    const isCurrentAttempt = React.useCallback((attemptId: number) => (
        activeAttemptRef.current?.id === attemptId
        && activeAttemptRef.current.controller.signal.aborted === false
    ), []);

    const beginEnrollmentAttempt = React.useCallback((invite: HomeQrInviteV2) => {
        if (activeAttemptRef.current) return null;
        const attempt = {
            id: nextAttemptIdRef.current + 1,
            controller: new AbortController(),
            cancellable: true,
        };
        nextAttemptIdRef.current = attempt.id;
        activeAttemptRef.current = attempt;
        setPhase('requesting');
        setConfirmCode(null);
        setActiveInvite(invite);
        return attempt;
    }, []);

    const cancelEnrollmentAttempt = React.useCallback(() => {
        const attempt = activeAttemptRef.current;
        if (!attempt || !attempt.cancellable) return;
        attempt.controller.abort();
        activeAttemptRef.current = null;
        setPhase('idle');
        setConfirmCode(null);
        setActiveInvite(null);
    }, []);

    const handleBack = React.useCallback(() => {
        if (props.onBack) {
            props.onBack();
            return;
        }
        router.back();
    }, [props.onBack, router]);

    const openSecretKeyLogin = React.useCallback(() => {
        if (embedded && props.onOpenSecretKeyLogin) {
            props.onOpenSecretKeyLogin();
            return;
        }
        router.push('/restore/manual');
    }, [embedded, props.onOpenSecretKeyLogin, router]);

    const openShowQrInstead = React.useCallback(() => {
        if (embedded && props.onShowQrInstead) {
            props.onShowQrInstead();
            return;
        }
        router.push('/restore/show-qr');
    }, [embedded, props.onShowQrInstead, router]);

    const scrollViewStyle: StyleProp<ViewStyle> = props.embedded
        ? [styles.scrollView, { backgroundColor: 'transparent' }]
        : styles.scrollView;
    const containerStyle: StyleProp<ViewStyle> = [styles.container, embedded ? styles.embeddedContainer : null];
    const contentWrapperStyle: StyleProp<ViewStyle> = [styles.contentWrapper, embedded ? styles.embeddedContentWrapper : null];

    type ScannedEnrollmentLink =
        | Readonly<{ kind: 'accountConnect' }>
        | Readonly<{ kind: 'inviteV2'; invite: HomeQrInviteV2 }>
        | Readonly<{ kind: 'pairingV1'; pairId: string; secret: string; serverUrl: string | null }>;

    const classifyScannedLink = React.useCallback((rawUrl: string): ScannedEnrollmentLink | null => {
        if (parseAccountConnectDeepLink(rawUrl)) return { kind: 'accountConnect' };
        const invite = parseHomeQrInviteDeepLink(rawUrl);
        if (invite) return { kind: 'inviteV2', invite: invite.invite };
        const legacy = parsePairingDeepLink(rawUrl);
        if (legacy) return { kind: 'pairingV1', pairId: legacy.pairId, secret: legacy.secret, serverUrl: legacy.serverUrl };
        return null;
    }, []);

    /** Persist the enrollment result under the explicit target Home without touching focus. */
    const completeEnrollment = React.useCallback(async (
        credentials: AuthCredentials,
        target: HomeQrEnrollmentTarget,
        enrolledIdentity: string | null,
    ): Promise<boolean> => {
        try {
            const descriptor = target.descriptor;
            // A QR credential is authority-bearing. Persist only after the target Home
            // identity has been bound either by the V2 invite or the Home response.
            if (!enrolledIdentity || enrolledIdentity !== descriptor.homeServerIdentityId) return false;
            await adoptHomeProfileWithCredentials({
                descriptor,
                source: 'qr',
                preserveUserLabel: true,
                credentials,
            });
            return true;
        } catch {
            return false;
        }
    }, []);

    const processPairingLink = React.useCallback(
        async (rawUrl: string) => {
            const link = classifyScannedLink(rawUrl.trim());
            if (!link) {
                await Modal.alertAsync(t('common.error'), t('modals.invalidAuthUrl'));
                return;
            }
            if (link.kind === 'accountConnect') {
                const action = await promptAccountConnectApprovalRequired();
                if (action === 'showQr') {
                    openShowQrInstead();
                }
                return;
            }
            if (link.kind === 'pairingV1') {
                // No independently bound released V1 fixture exists. Recognition is
                // retained only to direct users to the current Home QR flow.
                const action = await promptAccountConnectApprovalRequired();
                if (action === 'showQr') openShowQrInstead();
                return;
            }

            const attempt = beginEnrollmentAttempt(link.invite);
            if (!attempt) return;

            let target: HomeQrEnrollmentTarget | null = null;
            let didComplete = false;
            try {
                const transportResolution = await resolveHomeEnrollmentTransport(link.invite.home);
                const resolvedTarget = transportResolution.ok
                    ? transportResolution.transport
                    : null;
                if (!isCurrentAttempt(attempt.id)) {
                    await resolvedTarget?.close().catch(() => {});
                    return;
                }
                target = resolvedTarget;
                if (!target || Date.now() > link.invite.expiresAtMs) {
                    await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                    return;
                }

                const keypair = generateAuthKeyPair();
                const qrSecret = decodeBase64(link.invite.qrSecretBase64Url, 'base64url');
                const bindingProof = computeHomeQrBindingProofV2({
                    qrSecret,
                    pairId: link.invite.pairId,
                    homeServerIdentityId: link.invite.home.homeServerIdentityId,
                    requesterPublicKey: keypair.publicKey,
                    expiresAtMs: link.invite.expiresAtMs,
                });
                const v2RequestContext = {
                    pairId: link.invite.pairId,
                    homeServerIdentityId: link.invite.home.homeServerIdentityId,
                    expiresAtMs: link.invite.expiresAtMs,
                    bindingProof,
                };
                const started = await authQRStart(keypair, target, { signal: attempt.controller.signal });
                if (!isCurrentAttempt(attempt.id)) return;
                if (!started) {
                    await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                    return;
                }

                // V2 joins derive the rendezvous secret from QR-only material; V1 links
                // keep their released reader semantics.
                const rendezvousSecret = encodeBase64(deriveHomeQrRendezvousSecretV2(qrSecret), 'base64url');

                const pairingRes = await pairingRequest({
                    pairId: link.invite.pairId,
                    secret: rendezvousSecret,
                    publicKey: encodeBase64(keypair.publicKey),
                    deviceLabel: resolveDeviceLabel() ?? undefined,
                    homeServerIdentityId: v2RequestContext.homeServerIdentityId,
                    expiresAtMs: v2RequestContext.expiresAtMs,
                    bindingProof: v2RequestContext.bindingProof,
                }, target, { signal: attempt.controller.signal });
                if (!isCurrentAttempt(attempt.id)) return;

                if (!pairingRes.ok) {
                    if (pairingRes.reason === 'not_found') {
                        await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                    } else if (pairingRes.reason === 'already_requested') {
                        await Modal.alertAsync(
                            t('connect.pairingAlreadyRequestedTitle'),
                            t('connect.pairingAlreadyRequestedBody'),
                        );
                    } else {
                        await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                    }
                    return;
                }

                // The confirmation code is computed from QR-only material for V2 invites;
                // the server echo is never the authorization primitive.
                const resolvedConfirmCode = computeHomeQrConfirmationCodeV2({
                    qrSecret,
                    pairId: link.invite.pairId,
                    homeServerIdentityId: link.invite.home.homeServerIdentityId,
                    requesterPublicKey: keypair.publicKey,
                    expiresAtMs: link.invite.expiresAtMs,
                });

                setConfirmCode(resolvedConfirmCode);

                setPhase('waiting');
                const result = await authQRWait(keypair, target, {
                    shouldCancel: () => !isCurrentAttempt(attempt.id),
                    signal: attempt.controller.signal,
                    expiresAtMs: link.invite.expiresAtMs,
                    v2Context: {
                        pairId: link.invite.pairId,
                        homeServerIdentityId: link.invite.home.homeServerIdentityId,
                        bindingSecret: deriveHomeQrBindingKeyV2(qrSecret),
                        bindingProof,
                        issuedAtMs: link.invite.issuedAtMs,
                        expiresAtMs: link.invite.expiresAtMs,
                    },
                });

                if (!isCurrentAttempt(attempt.id)) return;

                if (result.ok) {
                    // Credential persistence/profile adoption cannot be rolled back as one unit.
                    // Once authorization succeeds, stop presenting Cancel before entering that
                    // commit boundary so a late press cannot claim the attempt was cancelled.
                    attempt.cancellable = false;
                    setPhase('securing');
                    const stored = await completeEnrollment(result.credentials, target, result.homeServerIdentityId);
                    if (!isCurrentAttempt(attempt.id)) return;
                    if (!stored) {
                        await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                        return;
                    }
                    didComplete = true;
                    trackAccountRestored();
                    await Modal.alertAsync(
                        formatHomeEnrollmentTargetLabel(link.invite.home),
                        t('connect.homeAddedPreservedFocusBody'),
                    );
                    router.replace('/');
                } else {
                    if (result.reason === 'cancelled') {
                        return;
                    }
                    if (result.reason === 'expired') {
                        await Modal.alertAsync(
                            t('modals.authRequestExpired'),
                            t('modals.authRequestExpiredDescription'),
                            [{ text: t('connect.startAgain') }],
                        );
                    } else if (result.reason === 'rejected') {
                        await Modal.alertAsync(
                            t('connect.pairingRejectedTitle'),
                            t('connect.pairingRejectedBody'),
                            [{ text: t('connect.requestAgain') }],
                        );
                    } else if (result.reason === 'wrong_target') {
                        await Modal.alertAsync(
                            t('connect.wrongHomeTitle'),
                            t('connect.wrongHomeBody'),
                            [{ text: t('connect.scanCorrectHome') }],
                        );
                    } else if (result.reason === 'legacy_provisioning_unavailable') {
                        await Modal.alertAsync(
                            t('connect.updateRequiredTitle'),
                            t('connect.updateRequiredBody'),
                            [{ text: t('common.ok') }],
                        );
                    } else {
                        await Modal.alertAsync(
                            t('connect.unsupportedEnrollmentResponseTitle'),
                            t('connect.unsupportedEnrollmentResponseBody'),
                            [{ text: t('common.ok') }],
                        );
                    }
                }
            } catch {
                if (isCurrentAttempt(attempt.id)) {
                    await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                }
            } finally {
                await target?.close().catch(() => {});
                if (activeAttemptRef.current?.id === attempt.id) {
                    activeAttemptRef.current = null;
                    if (!didComplete) {
                        setPhase('idle');
                        setConfirmCode(null);
                        setActiveInvite(null);
                    }
                }
            }
        },
        [beginEnrollmentAttempt, classifyScannedLink, completeEnrollment, isCurrentAttempt, openShowQrInstead, router],
    );

    const processedInitialPairingLinkRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        const initialPairingLink = typeof props.initialPairingLink === 'string'
            ? props.initialPairingLink.trim()
            : '';
        if (
            !initialPairingLink
            || !isFocused
            || pairingState !== 'enabled'
            || phase !== 'idle'
            || processedInitialPairingLinkRef.current === initialPairingLink
        ) {
            return;
        }
        processedInitialPairingLinkRef.current = initialPairingLink;
        void processPairingLink(initialPairingLink);
    }, [isFocused, pairingState, phase, processPairingLink, props.initialPairingLink]);

    React.useEffect(() => {
        return () => {
            const attempt = activeAttemptRef.current;
            activeAttemptRef.current = null;
            attempt?.controller.abort();
        };
    }, []);

    const statusText =
        phase === 'idle'
            ? t('connect.scanComputerQrInstructions')
                : phase === 'requesting'
                    ? t('common.loading')
                    : phase === 'waiting'
                        ? t('connect.waitingForApproval')
                        : t('connect.securingCredentials');

    if (pairingState === 'unknown') {
        const frame = (
            <View style={containerStyle}>
                <View style={contentWrapperStyle}>
                    {embedded ? null : <Text style={styles.title}>{t('connect.restoreAccount')}</Text>}
                    <Text style={styles.subtitle}>{t('common.loading')}</Text>

                    <View style={[styles.statusCard, embedded ? styles.embeddedStatusCard : null]}>
                        <ActivitySpinner size="small" color={theme.colors.text.primary} />
                    </View>

                    <View style={[styles.footer, embedded ? styles.embeddedFooter : null]}>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-open-manual"
                                size="small"
                                title={t('connect.restoreWithSecretKeyInstead')}
                                display="inverted"
                                action={async () => {
                                    openSecretKeyLogin();
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-show-qr-instead"
                                size="small"
                                title={t('connect.showQrInstead')}
                                display="inverted"
                                action={async () => {
                                    router.push('/restore/show-qr');
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-scan-cancel"
                                size="small"
                                title={t('common.back')}
                                display="inverted"
                                onPress={handleBack}
                            />
                        </View>
                    </View>
                </View>
            </View>
        );

        return embedded ? frame : (
            <ScrollView style={scrollViewStyle} contentContainerStyle={{ flexGrow: 1 }}>
                {frame}
            </ScrollView>
        );
    }

    if (pairingState !== 'enabled') {
        const frame = (
            <View style={containerStyle}>
                <View style={contentWrapperStyle}>
                    {embedded ? null : <Text style={styles.title}>{t('connect.restoreAccount')}</Text>}
                    <Text style={styles.subtitle}>{t('connect.scanComputerQrUnavailableBody')}</Text>

                    <View style={[styles.statusCard, embedded ? styles.embeddedStatusCard : null]}>
                        <Text style={styles.codeLabel}>{t('connect.scanComputerQrUnavailableTitle')}</Text>
                    </View>

                    <View style={[styles.footer, embedded ? styles.embeddedFooter : null]}>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-open-manual"
                                size="small"
                                title={t('connect.restoreWithSecretKeyInstead')}
                                display="inverted"
                                action={async () => {
                                    openSecretKeyLogin();
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-show-qr-instead"
                                size="small"
                                title={t('connect.showQrInstead')}
                                display="inverted"
                                action={async () => {
                                    router.push('/restore/show-qr');
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-scan-cancel"
                                size="small"
                                title={t('common.back')}
                                display="inverted"
                                onPress={handleBack}
                            />
                        </View>
                    </View>
                </View>
            </View>
        );

        return embedded ? frame : (
            <ScrollView style={scrollViewStyle} contentContainerStyle={{ flexGrow: 1 }}>
                {frame}
            </ScrollView>
        );
    }

    if (phase === 'idle') {
        return (
            <QrCodeScannerView
                active={isFocused}
                testIDPrefix="restore-scan"
                title={t('connect.restoreAccount')}
                subtitle={t('connect.scanComputerQrInstructions')}
                permissionRequiredMessage={t('modals.cameraPermissionsRequiredToScanQr')}
                embedded={props.embedded}
                onCancel={handleBack}
                onScan={async (data) => {
                    if (typeof data === 'string' && data.trim()) {
                        await processPairingLink(data.trim());
                    }
                }}
                footer={
                    <>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-enter-pairing-link"
                                size="normal"
                                title={t('connect.enterUrlManually')}
                                action={async () => {
                                    const url = await Modal.prompt(
                                        t('connect.enterUrlManually'),
                                        undefined,
                                        {
                                            placeholder: 'happier:///pair?v=2&payload=…',
                                            confirmText: t('common.continue'),
                                            cancelText: t('common.cancel'),
                                        },
                                    );
                                    if (typeof url === 'string' && url.trim()) {
                                        await processPairingLink(url.trim());
                                    }
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-open-manual"
                                size="small"
                                title={t('connect.restoreWithSecretKeyInstead')}
                                display="inverted"
                                action={async () => {
                                    openSecretKeyLogin();
                                }}
                            />
                        </View>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-show-qr-instead"
                                size="small"
                                title={t('connect.showQrInstead')}
                                display="inverted"
                                action={async () => {
                                    openShowQrInstead();
                                }}
                            />
                        </View>
                    </>
                }
            />
        );
    }

    const frame = (
        <View style={containerStyle}>
            <View style={contentWrapperStyle}>
                {embedded ? null : <Text style={styles.title}>{t('connect.restoreAccount')}</Text>}
                <Text
                    testID={phase === 'securing' ? 'restore-enrollment-securing' : undefined}
                    style={styles.subtitle}
                    accessibilityLiveRegion="polite"
                >
                    {statusText}
                </Text>

                <View style={[styles.statusCard, embedded ? styles.embeddedStatusCard : null]}>
                    <ActivitySpinner size="small" color={theme.colors.text.primary} />
                    {activeInvite ? (
                        <>
                            <Text style={styles.codeLabel}>{t('common.home')}</Text>
                            <Text style={styles.codeValue} numberOfLines={2}>
                                {formatHomeEnrollmentTargetLabel(activeInvite.home)}
                            </Text>
                            <Text style={styles.codeLabel}>
                                {t('connect.requestingDeviceLabel')}: {resolveDeviceLabel() ?? t('connect.thisDevice')}
                            </Text>
                            <Text style={styles.codeLabel}>
                                {t('connect.expiresAtLabel')}: {formatEnrollmentExpiry(activeInvite.expiresAtMs)}
                            </Text>
                        </>
                    ) : null}
                    {confirmCode ? (
                        <>
                            <Text style={styles.codeLabel}>{t('connect.confirmCodeLabel')}</Text>
                            <Text
                                testID="restore-scan-confirm-code"
                                style={styles.codeValue}
                                accessibilityLabel={`${t('connect.confirmCodeLabel')}: ${formatPairingConfirmationCode(confirmCode)}`}
                            >
                                {formatPairingConfirmationCode(confirmCode)}
                            </Text>
                            <Text style={styles.codeLabel}>{t('connect.confirmCodeComparisonBody')}</Text>
                        </>
                    ) : null}
                </View>

                {phase !== 'securing' ? (
                    <View style={[styles.footer, embedded ? styles.embeddedFooter : null]}>
                        <View style={styles.footerButton}>
                            <RoundButton
                                testID="restore-enrollment-cancel"
                                size="small"
                                title={t('common.cancel')}
                                display="inverted"
                                onPress={cancelEnrollmentAttempt}
                            />
                        </View>
                    </View>
                ) : null}
            </View>
        </View>
    );

    return embedded ? frame : (
        <ScrollView style={scrollViewStyle} contentContainerStyle={{ flexGrow: 1 }}>
            {frame}
        </ScrollView>
    );
});
