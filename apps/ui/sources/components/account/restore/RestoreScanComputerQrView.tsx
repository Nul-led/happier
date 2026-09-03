import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useIsFocused, usePreventRemove } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { generateAuthKeyPair, authQRStart } from '@/auth/flows/qrStart';
import { authQRWait } from '@/auth/flows/qrWait';
import {
    classifyLegacyPairingDeepLink,
    parseHomeQrInviteDeepLink,
} from '@/auth/pairing/pairingUrl';
import { promptLegacyPairingUpdateRequired } from '@/auth/pairing/legacyPairingUpdateRequired';
import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useFeatureDecision } from '@/hooks/server/useFeatureDecision';
import { pairingRequest, pairingStart, pairingStatus, type PairingRequestResult } from '@/sync/api/account/apiPairingAuth';
import {
    adoptHomeProfileWithCanonicalUrlMigration,
    adoptHomeProfileWithCredentials,
    HomeProfileAdoptionPartialCommitError,
    HomeProfileCanonicalUrlMigrationPartialCommitError,
} from '@/sync/domains/server/adoptHomeProfile';
import {
    computeHomeQrBindingProofV2,
    createHomeCredentialDestinationDigestV1,
    deriveHomeQrBindingKeyV2,
    deriveHomeQrRendezvousSecretV2,
    deriveHomeQrRendezvousVerifierV2,
    readServerEnabledBit,
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
import { trackAccountRestored, trackAuthEnrollmentTransientRetry } from '@/track';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { promptAccountConnectApprovalRequired } from './accountConnectApprovalGuidance';
import {
    formatEnrollmentExpiry,
    formatHomeEnrollmentTargetLabel,
    resolveHomeEnrollmentPresentation,
} from '@/auth/pairing/pairingPresentation';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import { enrollmentPollingBackoffMs } from '@/auth/enrollment/enrollmentPollingBackoff';
import { completeTrustedHomeQrPairingRequest, InvalidTrustedHomeQrRequestError } from '@/auth/pairing/completeTrustedHomeQrPairingRequest';
import {
    buildHomeConnectionDescriptorForProfile,
    resolveServerProfileForPortableIdentity,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { AccountCompletionError } from '@/auth/flows/accountCompletion';
import { PairingLinkDisclosure } from '@/components/auth/pairing/PairingLinkDisclosure';
import type { HomeQrEntryIntent } from '@/auth/pairing/homeQrEntryIntent';
import { openEnrolledHomeOrReturnToShell } from '@/auth/pairing/openEnrolledHome';

const DESKTOP_QR_SCAN_FEATURE_ID = 'auth.pairing.desktopQrMobileScan' as const;

type ScannedHomeEnrollmentPartialCommitError =
    | HomeProfileAdoptionPartialCommitError
    | HomeProfileCanonicalUrlMigrationPartialCommitError;

export type ScannedHomeEnrollmentPartialCommit = Readonly<{
    kind: 'partial_commit';
    error: ScannedHomeEnrollmentPartialCommitError;
}>;

/** Keeps owner-provided recovery facts intact at the forward QR caller boundary. */
export function classifyScannedHomeEnrollmentPartialCommit(
    error: unknown,
): ScannedHomeEnrollmentPartialCommit | null {
    return error instanceof HomeProfileAdoptionPartialCommitError
        || error instanceof HomeProfileCanonicalUrlMigrationPartialCommitError
        ? { kind: 'partial_commit', error }
        : null;
}

function isTransientEnrollmentStatus(status: number): boolean {
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

async function waitForEnrollmentRetry(params: Readonly<{
    expiresAtMs: number;
    failureCount: number;
    signal: AbortSignal;
}>): Promise<boolean> {
    const remainingMs = params.expiresAtMs - Date.now();
    if (remainingMs <= 0 || params.signal.aborted) return false;
    const delayMs = Math.min(enrollmentPollingBackoffMs(params.failureCount), remainingMs);
    return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            params.signal.removeEventListener('abort', handleAbort);
            resolve(!params.signal.aborted && Date.now() < params.expiresAtMs);
        }, delayMs);
        const handleAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        params.signal.addEventListener('abort', handleAbort, { once: true });
    });
}

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
    detailLabel: {
        marginTop: 12,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    identityValue: {
        marginTop: 4,
        fontSize: 16,
        lineHeight: 22,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
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
    entryIntent: HomeQrEntryIntent;
    embedded?: boolean;
    initialPairingLink?: string | null;
    onBack?: () => void;
    onOpenSecretKeyLogin?: () => void;
    onShowQrInstead?: () => void;
    onNavigationLockChange?: (locked: boolean) => void;
}>;

export const RestoreScanComputerQrView = React.memo(function RestoreScanComputerQrView(props: RestoreScanComputerQrViewProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const isFocused = useIsFocused();
    const embedded = props.embedded === true;
    const pairingDecision = useFeatureDecision(DESKTOP_QR_SCAN_FEATURE_ID);
    // The focused Home may decide only its own server capability. Keep its
    // server-axis result out of local scanner admission; after parsing, the
    // exact QR target is probed and decides whether enrollment is supported.
    const pairingState = pairingDecision === null
        ? 'unknown'
        : pairingDecision.blockedBy === 'server'
            ? 'enabled'
            : pairingDecision.state;

    const [phase, setPhase] = React.useState<'idle' | 'requesting' | 'securing'>('idle');
    const [activeInvite, setActiveInvite] = React.useState<HomeQrInviteV2 | null>(null);
    const [navigationLocked, setNavigationLocked] = React.useState(false);
    const [shellNavigationRequested, setShellNavigationRequested] = React.useState(false);
    usePreventRemove(navigationLocked, () => undefined);
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
        setActiveInvite(invite);
        return attempt;
    }, []);

    const cancelEnrollmentAttempt = React.useCallback(() => {
        const attempt = activeAttemptRef.current;
        if (!attempt || !attempt.cancellable) return;
        attempt.controller.abort();
        activeAttemptRef.current = null;
        setPhase('idle');
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
        | Readonly<{ kind: 'pairingV1' }>;

    const classifyScannedLink = React.useCallback((rawUrl: string): ScannedEnrollmentLink | null => {
        if (parseAccountConnectDeepLink(rawUrl)) return { kind: 'accountConnect' };
        const invite = parseHomeQrInviteDeepLink(rawUrl);
        if (invite) return { kind: 'inviteV2', invite: invite.invite };
        if (classifyLegacyPairingDeepLink(rawUrl)) return { kind: 'pairingV1' };
        return null;
    }, []);

    React.useEffect(() => {
        props.onNavigationLockChange?.(navigationLocked);
        return () => props.onNavigationLockChange?.(false);
    }, [navigationLocked, props.onNavigationLockChange]);

    React.useEffect(() => {
        if (!shellNavigationRequested || navigationLocked) return;
        router.replace('/');
    }, [navigationLocked, router, shellNavigationRequested]);

    /** Persist the enrollment result under the explicit target Home without touching focus. */
    const completeEnrollment = React.useCallback(async (
        credentials: AuthCredentials,
        enrolledIdentity: string | null,
        observedDescriptor: HomeQrInviteV2['home'],
    ): Promise<
        | Readonly<{ kind: 'completed'; profile: ServerProfile }>
        | ScannedHomeEnrollmentPartialCommit
        | Readonly<{ kind: 'failed' }>
    > => {
        try {
            const descriptor = observedDescriptor;
            // A QR credential is authority-bearing. Persist only after the target Home
            // identity has been bound either by the V2 invite or the Home response.
            if (!enrolledIdentity || enrolledIdentity !== descriptor.homeServerIdentityId) return { kind: 'failed' };
            const existingResolution = resolveServerProfileForPortableIdentity(enrolledIdentity);
            const existingProfile = existingResolution.kind === 'resolved'
                ? existingResolution.profile
                : null;
            if (
                existingProfile
                && (existingProfile.canonicalServerUrl ?? existingProfile.serverUrl) !== descriptor.canonicalServerUrl
            ) {
                // Lane 04 remains the sole owner of same-identity URL migration,
                // including descriptor revision adjudication and old-slot cleanup.
                await adoptHomeProfileWithCanonicalUrlMigration({
                    descriptor,
                    source: 'qr',
                    preserveUserLabel: true,
                });
            }
            const profile = await adoptHomeProfileWithCredentials({
                descriptor,
                source: 'qr',
                preserveUserLabel: true,
                credentials,
            });
            return { kind: 'completed', profile };
        } catch (error) {
            return classifyScannedHomeEnrollmentPartialCommit(error) ?? { kind: 'failed' };
        }
    }, []);

    const openRetainedHomeOrReturnToShell = React.useCallback(async (
        profileId: string,
        targetLabel: string,
        attemptId: number,
    ): Promise<void> => {
        const result = await openEnrolledHomeOrReturnToShell({
            profileId,
            targetLabel,
            isCurrent: () => isCurrentAttempt(attemptId),
        });
        if (result !== 'cancelled' && isCurrentAttempt(attemptId)) {
            setShellNavigationRequested(true);
        }
    }, [isCurrentAttempt]);

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
                const action = await promptLegacyPairingUpdateRequired();
                if (action === 'cancel') handleBack();
                return;
            }

            const attempt = beginEnrollmentAttempt(link.invite);
            if (!attempt) return;

            let target: HomeQrEnrollmentTarget | null = null;
            try {
                if (Date.now() > link.invite.expiresAtMs) {
                    await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                    return;
                }

                if (link.invite.direction === 'requester_displays') {
                    // The enrolled scanner resolves the trusted Home from its stored registry by
                    // the invite identity. Focus is neither a selector nor a fallback.
                    const storedProfileResolution = resolveServerProfileForPortableIdentity(
                        link.invite.home.homeServerIdentityId,
                    );
                    const storedProfile = storedProfileResolution.kind === 'resolved'
                        ? storedProfileResolution.profile
                        : null;
                    const storedDescriptor = storedProfile
                        ? buildHomeConnectionDescriptorForProfile(storedProfile)
                        : null;
                    if (
                        !storedProfile
                        || !storedDescriptor
                        || storedProfile.serverIdentityId !== link.invite.home.homeServerIdentityId
                        || storedDescriptor.homeServerIdentityId !== link.invite.home.homeServerIdentityId
                    ) {
                        await Modal.alertAsync(t('connect.wrongHomeTitle'), t('connect.wrongHomeBody'));
                        return;
                    }
                    const transportResolution = await resolveHomeEnrollmentTransport(storedDescriptor);
                    if (!isCurrentAttempt(attempt.id)) {
                        if (transportResolution.ok) await transportResolution.transport.close().catch(() => {});
                        return;
                    }
                    if (!transportResolution.ok) {
                        await Modal.alertAsync(t('connect.scanComputerQrUnavailableTitle'), t('connect.scanComputerQrUnavailableBody'));
                        return;
                    }
                    target = { ...transportResolution.transport, serverId: storedProfile.id };
                    const targetFeatureSnapshot = await probeServerFeaturesAtUrl({
                        endpointUrl: target.endpointUrl,
                        runtimeOrigin: target.runtimeOrigin,
                        serverId: storedProfile.id,
                        force: true,
                        signal: attempt.controller.signal,
                    });
                    if (!isCurrentAttempt(attempt.id)) return;
                    if (
                        targetFeatureSnapshot.status !== 'ready'
                        || targetFeatureSnapshot.serverIdentityId !== storedDescriptor.homeServerIdentityId
                        || readServerEnabledBit(targetFeatureSnapshot.features, DESKTOP_QR_SCAN_FEATURE_ID) !== true
                    ) {
                        await Modal.alertAsync(t('connect.scanComputerQrUnavailableTitle'), t('connect.scanComputerQrUnavailableBody'));
                        return;
                    }

                    const qrSecret = decodeBase64(link.invite.qrSecretBase64Url, 'base64url');
                    let startFailures = 0;
                    while (true) {
                        const started = await pairingStart({
                            direction: 'requester_displays',
                            secretHash: encodeBase64(deriveHomeQrRendezvousVerifierV2(qrSecret), 'base64url'),
                            pairId: link.invite.pairId,
                            expiresAtMs: link.invite.expiresAtMs,
                        }, target);
                        if (!isCurrentAttempt(attempt.id)) return;
                        if (started.ok) break;
                        if (!isTransientEnrollmentStatus(started.status)) {
                            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                            return;
                        }
                        startFailures += 1;
                        if (!await waitForEnrollmentRetry({
                            expiresAtMs: link.invite.expiresAtMs,
                            failureCount: startFailures,
                            signal: attempt.controller.signal,
                        })) {
                            if (isCurrentAttempt(attempt.id)) {
                                await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                            }
                            return;
                        }
                    }

                    let statusFailures = 0;
                    while (true) {
                        const status = await pairingStatus({ pairId: link.invite.pairId }, target);
                        if (!isCurrentAttempt(attempt.id)) return;
                        if (status.ok && status.data.state === 'pending') {
                            statusFailures = 0;
                        } else if (status.ok && status.data.state === 'requested') {
                            const expectedRequesterPublicKey = decodeBase64(link.invite.requesterPublicKeyBase64Url, 'base64url');
                            // This is the Home-authority commit boundary. The shared owner checks
                            // the exact key, Home, expiry, direction and proof before responding.
                            attempt.cancellable = false;
                            setNavigationLocked(true);
                            setPhase('securing');
                            let completed = false;
                            try {
                                await completeTrustedHomeQrPairingRequest({
                                    context: {
                                        direction: link.invite.direction,
                                        pairId: link.invite.pairId,
                                        target,
                                        qrSecret,
                                        issuedAtMs: link.invite.issuedAtMs,
                                        expiresAtMs: link.invite.expiresAtMs,
                                        expectedRequesterPublicKeyBase64: encodeBase64(expectedRequesterPublicKey),
                                    },
                                    status: status.data,
                                    signal: attempt.controller.signal,
                                });
                                if (!isCurrentAttempt(attempt.id)) return;
                                completed = true;
                            } catch (error) {
                                if (!isCurrentAttempt(attempt.id)) return;
                                if (error instanceof AccountCompletionError && error.retryable) {
                                    statusFailures += 1;
                                } else if (error instanceof InvalidTrustedHomeQrRequestError) {
                                    await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                                    return;
                                } else {
                                    await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                                    return;
                                }
                            }
                            // Success is decided by this attempt's own completion, not by an
                            // earlier transient poll failure that the retry already recovered.
                            if (completed) {
                                await Modal.alertAsync(
                                    formatHomeEnrollmentTargetLabel(storedDescriptor),
                                    t('connect.requesterDeviceAddedBody'),
                                );
                                handleBack();
                                return;
                            }
                        } else if (
                            'reason' in status
                            && (status.reason === 'not_found'
                                || (status.reason === 'http_error' && isTransientEnrollmentStatus(status.status)))
                        ) {
                            statusFailures += 1;
                        } else {
                            await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                            return;
                        }
                        if (!await waitForEnrollmentRetry({
                            expiresAtMs: link.invite.expiresAtMs,
                            failureCount: Math.max(1, statusFailures),
                            signal: attempt.controller.signal,
                        })) {
                            if (isCurrentAttempt(attempt.id)) {
                                await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                            }
                            return;
                        }
                    }
                }

                let transportFailureCount = 0;
                while (!target) {
                    const transportResolution = await resolveHomeEnrollmentTransport(link.invite.home);
                    const resolvedTarget = transportResolution.ok
                        ? transportResolution.transport
                        : null;
                    if (!isCurrentAttempt(attempt.id)) {
                        await resolvedTarget?.close().catch(() => {});
                        return;
                    }
                    if (transportResolution.ok) {
                        target = transportResolution.transport;
                        break;
                    }
                    if (transportResolution.reason !== 'iroh_transport_unavailable') {
                        await Modal.alertAsync(
                            t('connect.scanComputerQrUnavailableTitle'),
                            t('connect.scanComputerQrUnavailableBody'),
                        );
                        return;
                    }

                    transportFailureCount += 1;
                    trackAuthEnrollmentTransientRetry();
                    const shouldRetry = await waitForEnrollmentRetry({
                        expiresAtMs: link.invite.expiresAtMs,
                        failureCount: transportFailureCount,
                        signal: attempt.controller.signal,
                    });
                    if (!shouldRetry) {
                        if (isCurrentAttempt(attempt.id)) {
                            await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                        }
                        return;
                    }
                }

                let featureProbeFailureCount = 0;
                let observedHomeDescriptor: HomeQrInviteV2['home'] | null = null;
                while (true) {
                    const targetFeatureSnapshot = await probeServerFeaturesAtUrl({
                        endpointUrl: target.endpointUrl,
                        runtimeOrigin: target.runtimeOrigin,
                        serverId: target.serverId ?? link.invite.home.homeServerIdentityId,
                        force: true,
                        signal: attempt.controller.signal,
                    });
                    if (!isCurrentAttempt(attempt.id)) return;

                    if (
                        targetFeatureSnapshot.status === 'error'
                        && targetFeatureSnapshot.reason !== 'identity_conflict'
                    ) {
                        featureProbeFailureCount += 1;
                        trackAuthEnrollmentTransientRetry();
                        const shouldRetry = await waitForEnrollmentRetry({
                            expiresAtMs: link.invite.expiresAtMs,
                            failureCount: featureProbeFailureCount,
                            signal: attempt.controller.signal,
                        });
                        if (!shouldRetry) {
                            if (isCurrentAttempt(attempt.id)) {
                                await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                            }
                            return;
                        }
                        continue;
                    }

                    if (
                        targetFeatureSnapshot.status !== 'ready'
                        || targetFeatureSnapshot.serverIdentityId !== link.invite.home.homeServerIdentityId
                        || readServerEnabledBit(targetFeatureSnapshot.features, DESKTOP_QR_SCAN_FEATURE_ID) !== true
                    ) {
                        await Modal.alertAsync(
                            t('connect.scanComputerQrUnavailableTitle'),
                            t('connect.scanComputerQrUnavailableBody'),
                        );
                        return;
                    }
                    const publishedDescriptor = targetFeatureSnapshot.features.homeConnectionDescriptor;
                    try {
                        if (
                            !publishedDescriptor
                            || publishedDescriptor.homeServerIdentityId !== link.invite.home.homeServerIdentityId
                            || createHomeCredentialDestinationDigestV1(publishedDescriptor)
                                !== createHomeCredentialDestinationDigestV1(link.invite.home)
                        ) {
                            await Modal.alertAsync(
                                t('connect.scanComputerQrUnavailableTitle'),
                                t('connect.scanComputerQrUnavailableBody'),
                            );
                            return;
                        }
                    } catch {
                        await Modal.alertAsync(
                            t('connect.scanComputerQrUnavailableTitle'),
                            t('connect.scanComputerQrUnavailableBody'),
                        );
                        return;
                    }
                    observedHomeDescriptor = publishedDescriptor;
                    break;
                }

                const keypair = generateAuthKeyPair();
                const qrSecret = decodeBase64(link.invite.qrSecretBase64Url, 'base64url');
                const bindingProof = computeHomeQrBindingProofV2({
                    direction: link.invite.direction,
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
                let startFailureCount = 0;
                while (true) {
                    const startResult = await authQRStart(keypair, target, { signal: attempt.controller.signal });
                    if (!isCurrentAttempt(attempt.id)) return;
                    if (startResult.ok) break;
                    if (startResult.reason === 'cancelled') return;
                    if (startResult.reason !== 'transient') {
                        await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                        return;
                    }
                    startFailureCount += 1;
                    trackAuthEnrollmentTransientRetry();
                    const shouldRetry = await waitForEnrollmentRetry({
                        expiresAtMs: link.invite.expiresAtMs,
                        failureCount: startFailureCount,
                        signal: attempt.controller.signal,
                    });
                    if (!shouldRetry) {
                        if (isCurrentAttempt(attempt.id)) {
                            await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                        }
                        return;
                    }
                }

                // V2 joins derive the rendezvous secret from QR-only material; V1 links
                // keep their released reader semantics.
                const rendezvousSecret = encodeBase64(deriveHomeQrRendezvousSecretV2(qrSecret), 'base64url');

                // Submitting the bound request is the direct-QR authorization boundary.
                // From here, the trusted Home may complete automatically, so local Cancel
                // must not claim the enrollment was revoked.
                attempt.cancellable = false;
                setNavigationLocked(true);
                setPhase('securing');
                const pairingParams = {
                    pairId: link.invite.pairId,
                    secret: rendezvousSecret,
                    publicKey: encodeBase64(keypair.publicKey),
                    deviceLabel: resolveDeviceLabel() ?? undefined,
                    homeServerIdentityId: v2RequestContext.homeServerIdentityId,
                    expiresAtMs: v2RequestContext.expiresAtMs,
                    bindingProof: v2RequestContext.bindingProof,
                };
                let pairingFailureCount = 0;
                let pairingRes: PairingRequestResult;
                while (true) {
                    pairingRes = await pairingRequest(pairingParams, target, { signal: attempt.controller.signal });
                    if (!isCurrentAttempt(attempt.id)) return;
                    if (pairingRes.ok) break;
                    if (pairingRes.reason !== 'http_error' || !isTransientEnrollmentStatus(pairingRes.status)) break;
                    pairingFailureCount += 1;
                    trackAuthEnrollmentTransientRetry();
                    const shouldRetry = await waitForEnrollmentRetry({
                        expiresAtMs: link.invite.expiresAtMs,
                        failureCount: pairingFailureCount,
                        signal: attempt.controller.signal,
                    });
                    if (!shouldRetry) {
                        if (isCurrentAttempt(attempt.id)) {
                            await Modal.alertAsync(t('modals.authRequestExpired'), t('modals.authRequestExpiredDescription'));
                        }
                        return;
                    }
                }

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

                const result = await authQRWait(keypair, target, {
                    shouldCancel: () => !isCurrentAttempt(attempt.id),
                    signal: attempt.controller.signal,
                    expiresAtMs: link.invite.expiresAtMs,
                    v2Context: {
                        direction: link.invite.direction,
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
                    setNavigationLocked(true);
                    setPhase('securing');
                    if (!observedHomeDescriptor) return;
                    const stored = await completeEnrollment(
                        result.credentials,
                        result.homeServerIdentityId,
                        observedHomeDescriptor,
                    );
                    if (!isCurrentAttempt(attempt.id)) return;
                    if (stored.kind === 'partial_commit') {
                        const partialCommitHome = {
                            ...link.invite.home,
                            homeServerIdentityId: stored.error.serverIdentityId,
                            canonicalServerUrl: stored.error instanceof HomeProfileAdoptionPartialCommitError
                                ? stored.error.canonicalServerUrl
                                : stored.error.toCanonicalServerUrl,
                        };
                        await Modal.alertAsync(
                            formatHomeEnrollmentTargetLabel(partialCommitHome),
                            t('connect.homeEnrollmentPartialCommitBody'),
                            [{ text: t('common.ok') }],
                        );
                        return;
                    }
                    if (stored.kind === 'failed') {
                        await Modal.alertAsync(t('common.error'), t('errors.authenticationFailed'));
                        return;
                    }
                    if (stored.kind !== 'completed') return;
                    trackAccountRestored();
                    if (props.entryIntent === 'add_home') {
                        await Modal.alertAsync(
                            formatHomeEnrollmentTargetLabel(link.invite.home),
                            t('connect.homeAddedPreservedFocusBody'),
                        );
                        if (isCurrentAttempt(attempt.id)) setShellNavigationRequested(true);
                        return;
                    }

                    await openRetainedHomeOrReturnToShell(
                        stored.profile.id,
                        formatHomeEnrollmentTargetLabel(link.invite.home),
                        attempt.id,
                    );
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
                    setNavigationLocked(false);
                    activeAttemptRef.current = null;
                    setPhase('idle');
                    setActiveInvite(null);
                }
            }
        },
        [beginEnrollmentAttempt, classifyScannedLink, completeEnrollment, handleBack, isCurrentAttempt, openRetainedHomeOrReturnToShell, openShowQrInstead, props.entryIntent, router],
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
            // Irreversible Home-side completion may continue after unmount, but
            // clearing local ownership prevents stale UI/navigation dispatch.
            if (attempt?.cancellable) attempt.controller.abort();
        };
    }, []);

    const enrollmentPresentation = resolveHomeEnrollmentPresentation({ kind: 'scanner', phase });
    const statusText = t(enrollmentPresentation.primaryTranslationKey);

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
                        <Text style={styles.detailLabel}>{t('connect.scanComputerQrUnavailableTitle')}</Text>
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
                title={t('connect.scanExistingHomeQrTitle')}
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
                        <PairingLinkDisclosure testIDPrefix="restore-pairing-link">
                            <RoundButton
                                testID="restore-enter-pairing-link"
                                size="normal"
                                title={t('connect.enterUrlManually')}
                                action={async () => {
                                    const url = await Modal.prompt(
                                        t('connect.enterUrlManually'),
                                        t('connect.pairingLinkSecurityWarning'),
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
                        </PairingLinkDisclosure>
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
                    accessibilityLiveRegion={enrollmentPresentation.liveRegion}
                >
                    {statusText}
                </Text>

                <View style={[styles.statusCard, embedded ? styles.embeddedStatusCard : null]}>
                    {enrollmentPresentation.activity ? (
                        <ActivitySpinner size="small" color={theme.colors.text.primary} />
                    ) : null}
                    {enrollmentPresentation.contextualFacts !== 'none' && activeInvite ? (
                        <>
                            <Text style={styles.detailLabel}>{t('common.home')}</Text>
                            <Text style={styles.identityValue} numberOfLines={2}>
                                {formatHomeEnrollmentTargetLabel(activeInvite.home)}
                            </Text>
                            <Text style={styles.detailLabel}>
                                {t('connect.requestingDeviceLabel')}: {resolveDeviceLabel() ?? t('connect.thisDevice')}
                            </Text>
                            <Text style={styles.detailLabel}>
                                {t('connect.expiresAtLabel')}: {formatEnrollmentExpiry(activeInvite.expiresAtMs)}
                            </Text>
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
