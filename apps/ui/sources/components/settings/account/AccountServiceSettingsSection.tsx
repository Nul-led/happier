import * as React from 'react';
import { Linking } from 'react-native';

import { accountDirectoryCredentialStorage, normalizeAccountDirectoryEndpoint } from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import { accountDirectoryAuthClient } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { normalizeSecretKey } from '@/auth/recovery/secretKeyBackup';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { resolvePreferredProvisionProviderId } from '@/components/account/auth/useAuthEntryOptions';
import { useServerAuthStatusByServerId } from '@/components/settings/server/hooks/useServerAuthStatusByServerId';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { decodeBase64 } from '@/encryption/base64';
import { Modal } from '@/modal';
import {
    type AccountDirectorySession,
    type AccountDirectorySessionSnapshot,
    createAccountDirectoryServiceKey,
    createAccountDirectorySession,
    parseAccountDirectoryCapability,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import {
    getAccountServiceEndpointSnapshot,
    getServerProfilesGeneration,
    HAPPIER_CLOUD_SERVER_URL,
    listServerProfiles,
    resolveServerProfileScopeId,
    setAccountServiceEndpoint,
    subscribeAccountServiceEndpoint,
    subscribeServerProfiles,
    type AccountServiceEndpointV1,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import {
    cancelPendingPreferredHomeEnrollment,
    enrollPreferredDirectoryHome,
    getPendingPreferredHomeEnrollment,
    resumePendingPreferredHomeEnrollment,
    subscribePendingPreferredHomeEnrollment,
    type PreferredDirectoryHomeEnrollmentResult,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import { provisionAuthenticatedHomeLink } from '@/sync/ops/accountDirectory/provisionAuthenticatedHomeLink';
import { refreshAccountHomeDirectory } from '@/sync/ops/accountDirectory/refreshAccountHomeDirectory';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import { t } from '@/text';
import {
    useAccountDirectoryActivePolling,
    type AccountDirectoryActivePollingOutcome,
} from '@/sync/ops/accountDirectory/useAccountDirectoryActivePolling';

const DEFAULT_ACCOUNT_SERVICE_ENDPOINT: AccountServiceEndpointV1 = {
    url: HAPPIER_CLOUD_SERVER_URL,
    displayName: 'Happier Cloud',
    source: 'default',
};

type AccountServiceConnectionView =
    | Readonly<{ kind: 'loading'; serviceKey: string }>
    | Readonly<{ kind: 'connected'; serviceKey: string }>
    | Readonly<{ kind: 'disconnected'; serviceKey: string }>
    | Readonly<{ kind: 'custody_unavailable'; serviceKey: string }>
    | Readonly<{ kind: 'credential_expired'; serviceKey: string }>;

type DirectorySessionBinding = Readonly<{
    serviceKey: string;
    session: AccountDirectorySession;
}>;

type AccountServiceCapabilityPresentation = Readonly<{
    serviceKey: string;
    kind: 'probing' | 'missing' | 'unreachable';
}>;

type RowActionKind = 'set_preferred' | 'remove' | 'enroll' | 'link';
type EnrollmentView = 'enrolled' | 'approval_required' | 'failed';
type ServiceAttempt = { readonly id: number; serviceKey: string };

function accountServiceKey(endpoint: AccountServiceEndpointV1): string {
    return createAccountDirectoryServiceKey({
        endpoint: endpoint.url,
        serverIdentityId: endpoint.serverIdentityId,
    });
}

function isExpiredCredentialError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('status' in error)) return false;
    const status = error.status;
    return status === 401 || status === 403;
}

function readSelectedEndpoint(): AccountServiceEndpointV1 {
    return getAccountServiceEndpointSnapshot() ?? DEFAULT_ACCOUNT_SERVICE_ENDPOINT;
}

function displayNameForEndpoint(url: string): string {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url;
    }
}

function formatHomeEndpointDetails(home: AccountDirectorySessionSnapshot['homes'][number]): string {
    return home.connectionDescriptor.endpoints.map((connectionEndpoint) => (
        connectionEndpoint.kind === 'https'
            ? connectionEndpoint.url
            : `Iroh ${connectionEndpoint.endpointId}`
    )).join(' · ');
}

async function refreshAndEnrollAccountService(
    session: AccountDirectorySession,
    options: Readonly<{ shouldCancel?: () => boolean; enroll?: boolean }> = {},
): Promise<Readonly<{
    snapshot: AccountDirectorySessionSnapshot;
    enrollment: PreferredDirectoryHomeEnrollmentResult | null;
}>> {
    const refreshed = await refreshAccountHomeDirectory(session, options);
    let enrollment: PreferredDirectoryHomeEnrollmentResult | null = null;
    if (
        refreshed.status === 'ready'
        && session.supportsHomeEnrollment
        && options.enroll !== false
        && options.shouldCancel?.() !== true
    ) {
        enrollment = await enrollPreferredDirectoryHome(session, options);
    }
    return { snapshot: refreshed, enrollment };
}

function projectEnrollment(result: PreferredDirectoryHomeEnrollmentResult | null): EnrollmentView | null {
    if (!result) return null;
    if (result.kind === 'enrolled') return 'enrolled';
    if (result.kind === 'approval_required') return 'approval_required';
    if (result.kind === 'unavailable' && result.reason === 'no_preferred_home') return null;
    return 'failed';
}

/**
 * Production Account Service composition. The endpoint and credential namespace stay outside
 * Home profiles/runtime; refresh is the only path that adopts Directory Homes.
 */
export function AccountServiceSettingsSection(): React.ReactElement {
    const endpoint = React.useSyncExternalStore(
        (listener) => subscribeAccountServiceEndpoint(() => listener()),
        readSelectedEndpoint,
        readSelectedEndpoint,
    );
    const profileGeneration = React.useSyncExternalStore(
        (listener) => subscribeServerProfiles(() => listener()),
        getServerProfilesGeneration,
        getServerProfilesGeneration,
    );
    const profiles = React.useMemo(() => listServerProfiles(), [profileGeneration]);
    const authStatusByProfileId = useServerAuthStatusByServerId(profiles);
    const serviceKey = accountServiceKey(endpoint);
    const [busy, setBusy] = React.useState(false);
    const [connectionView, setConnectionView] = React.useState<AccountServiceConnectionView>({
        kind: 'loading',
        serviceKey,
    });
    const [directorySessionBinding, setDirectorySessionBinding] = React.useState<DirectorySessionBinding | null>(null);
    const [capabilityPresentation, setCapabilityPresentation] = React.useState<AccountServiceCapabilityPresentation | null>(null);
    const [pendingRowActions, setPendingRowActions] = React.useState<Readonly<Record<string, RowActionKind>>>({});
    const [enrollmentFailures, setEnrollmentFailures] = React.useState<Readonly<Record<string, true>>>({});
    const [advancedExpanded, setAdvancedExpanded] = React.useState(false);
    const pendingEnrollment = React.useSyncExternalStore(
        subscribePendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
    );
    const activeAttemptRef = React.useRef<ServiceAttempt | null>(null);
    const attemptSequenceRef = React.useRef(0);
    const pendingResumeInFlightRef = React.useRef(false);
    const previousServiceKeyRef = React.useRef<string | null>(null);
    const automaticallyHydratedServiceKeyRef = React.useRef<string | null>(null);
    const serviceKeyRef = React.useRef(serviceKey);
    serviceKeyRef.current = serviceKey;

    const visibleConnection = connectionView.serviceKey === serviceKey
        ? connectionView
        : { kind: 'loading', serviceKey } as const;
    const directorySession = directorySessionBinding?.serviceKey === serviceKey
        ? directorySessionBinding.session
        : null;
    const subscribeDirectorySession = React.useCallback((listener: () => void) => (
        directorySession?.subscribe(() => listener()) ?? (() => {})
    ), [directorySession]);
    const getDirectorySnapshot = React.useCallback(() => directorySession?.snapshot ?? null, [directorySession]);
    const directorySnapshot = React.useSyncExternalStore(
        subscribeDirectorySession,
        getDirectorySnapshot,
        getDirectorySnapshot,
    );
    const connected = visibleConnection.kind === 'connected';
    const visibleCapabilityPresentation = capabilityPresentation?.serviceKey === serviceKey
        ? capabilityPresentation
        : null;
    const directoryRefreshing = visibleCapabilityPresentation?.kind === 'probing'
        || directorySnapshot?.status === 'loading';

    const beginAttempt = React.useCallback((targetServiceKey: string): Readonly<{
        attempt: ServiceAttempt;
        shouldCancel: () => boolean;
    }> => {
        const attempt: ServiceAttempt = { id: ++attemptSequenceRef.current, serviceKey: targetServiceKey };
        activeAttemptRef.current = attempt;
        return {
            attempt,
            shouldCancel: () => activeAttemptRef.current !== attempt || serviceKeyRef.current !== attempt.serviceKey,
        };
    }, []);

    const invalidateAttempts = React.useCallback(() => {
        activeAttemptRef.current = null;
        attemptSequenceRef.current += 1;
        return cancelPendingPreferredHomeEnrollment();
    }, []);

    React.useEffect(() => {
        let cancelled = false;
        const requestedServiceKey = serviceKey;
        const previousServiceKey = previousServiceKeyRef.current;
        previousServiceKeyRef.current = requestedServiceKey;
        if (previousServiceKey !== null && previousServiceKey !== requestedServiceKey) {
            void invalidateAttempts();
        }
        setConnectionView((current) => (
            current.kind === 'credential_expired' && current.serviceKey === requestedServiceKey
                ? current
                : { kind: 'loading', serviceKey: requestedServiceKey }
        ));
        setDirectorySessionBinding((current) => current?.serviceKey === requestedServiceKey ? current : null);
        setCapabilityPresentation((current) => current?.serviceKey === requestedServiceKey ? current : null);
        setPendingRowActions({});
        setEnrollmentFailures({});
        void (async () => {
            try {
                let serverIdentityId = endpoint.serverIdentityId?.trim() ?? '';
                let observedIdentity = false;
                if (!serverIdentityId) {
                    const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
                    if (cancelled) return;
                    const capability = parseAccountDirectoryCapability(
                        observed.status === 'ready'
                            ? observed.features.capabilities.accountDirectory
                            : null,
                    );
                    serverIdentityId = observed.status === 'ready'
                        ? observed.serverIdentityId?.trim() ?? ''
                        : '';
                    if (!serverIdentityId || capability?.homeDirectory !== true) {
                        setConnectionView({ kind: 'disconnected', serviceKey: requestedServiceKey });
                        return;
                    }
                    observedIdentity = true;
                }
                const credentials = await accountDirectoryCredentialStorage.get({
                    endpoint: endpoint.url,
                    serverIdentityId,
                });
                if (cancelled) return;
                const resolvedServiceKey = accountServiceKey({ ...endpoint, serverIdentityId });
                if (observedIdentity) {
                    setAccountServiceEndpoint({ ...endpoint, serverIdentityId });
                }
                setConnectionView((current) => (
                    current.kind === 'credential_expired' && current.serviceKey === resolvedServiceKey
                        ? current
                        : {
                            kind: credentials ? 'connected' : 'disconnected',
                            serviceKey: resolvedServiceKey,
                        }
                ));
            } catch {
                if (!cancelled) {
                    setConnectionView({ kind: 'custody_unavailable', serviceKey: requestedServiceKey });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [endpoint.serverIdentityId, endpoint.url, invalidateAttempts, serviceKey]);

    React.useEffect(() => {
        if (pendingEnrollment && pendingEnrollment.serviceKey !== serviceKey) {
            void invalidateAttempts();
        }
    }, [invalidateAttempts, pendingEnrollment, serviceKey]);

    useAccountDirectoryActivePolling(async (): Promise<AccountDirectoryActivePollingOutcome> => {
        if (!pendingEnrollment || pendingEnrollment.serviceKey !== serviceKey) return 'success';
        const homeServerIdentityId = pendingEnrollment.homeServerIdentityId;
        if (pendingResumeInFlightRef.current) return 'success';
        const resumedServiceKey = serviceKey;
        const resumedAttemptRevision = attemptSequenceRef.current;
        pendingResumeInFlightRef.current = true;
        try {
            const result = await resumePendingPreferredHomeEnrollment();
            if (
                serviceKeyRef.current !== resumedServiceKey
                || attemptSequenceRef.current !== resumedAttemptRevision
                || !result
                || result.kind === 'approval_required'
            ) return 'success';
            if (result.kind === 'cancelled') return 'success';
            setEnrollmentFailures((current) => {
                const next = { ...current };
                if (result.kind === 'enrolled') delete next[homeServerIdentityId];
                else next[homeServerIdentityId] = true;
                return next;
            });
            return result.kind === 'transport_unavailable' || result.kind === 'failed'
                ? 'transient'
                : 'success';
        } catch {
            if (
                serviceKeyRef.current === resumedServiceKey
                && attemptSequenceRef.current === resumedAttemptRevision
            ) {
                setEnrollmentFailures((current) => ({ ...current, [homeServerIdentityId]: true }));
            }
            return 'transient';
        } finally {
            pendingResumeInFlightRef.current = false;
        }
    }, Boolean(pendingEnrollment && pendingEnrollment.serviceKey === serviceKey));

    const selectEndpoint = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const raw = await Modal.prompt(
                t('settingsAccount.server'),
                undefined,
                {
                    defaultValue: endpoint.url,
                    placeholder: t('common.urlPlaceholder'),
                    confirmText: t('common.use'),
                    cancelText: t('common.cancel'),
                },
            );
            if (raw === null) return;
            const normalized = normalizeAccountDirectoryEndpoint(raw);
            if (!normalized) {
                await Modal.alertAsync(t('common.error'), t('errors.invalidFormat'));
                return;
            }
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: normalized, force: true });
            const capability = parseAccountDirectoryCapability(
                observed.status === 'ready'
                    ? observed.features.capabilities.accountDirectory
                    : null,
            );
            const serverIdentityId = observed.status === 'ready'
                ? observed.serverIdentityId?.trim() ?? ''
                : '';
            if (!serverIdentityId || capability?.homeDirectory !== true) {
                await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                return;
            }
            setAccountServiceEndpoint({
                url: normalized,
                serverIdentityId,
                displayName: displayNameForEndpoint(normalized),
                source: 'user',
            });
        } finally {
            setBusy(false);
        }
    }, [busy, endpoint.url]);

    const refreshAndEnroll = React.useCallback(async () => {
        if (!connected || directoryRefreshing) return;
        const requestedServiceKey = serviceKey;
        const { attempt, shouldCancel } = beginAttempt(requestedServiceKey);
        let capabilityValidated = false;
        setCapabilityPresentation({ kind: 'probing', serviceKey: requestedServiceKey });
        try {
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
            if (shouldCancel()) return;
            if (observed.status !== 'ready') {
                setCapabilityPresentation({ kind: 'unreachable', serviceKey: requestedServiceKey });
                return;
            }
            const capability = parseAccountDirectoryCapability(
                observed.features.capabilities.accountDirectory,
            );
            const endpointServerIdentityId = observed.serverIdentityId?.trim() ?? '';
            if (!endpointServerIdentityId) {
                setCapabilityPresentation({ kind: 'unreachable', serviceKey: requestedServiceKey });
                return;
            }
            if (capability?.homeDirectory !== true) {
                setCapabilityPresentation({ kind: 'missing', serviceKey: requestedServiceKey });
                return;
            }
            const observedEndpoint = { ...endpoint, serverIdentityId: endpointServerIdentityId };
            const observedServiceKey = accountServiceKey(observedEndpoint);
            if (observedServiceKey !== requestedServiceKey) {
                attempt.serviceKey = observedServiceKey;
                serviceKeyRef.current = observedServiceKey;
                previousServiceKeyRef.current = observedServiceKey;
                automaticallyHydratedServiceKeyRef.current = observedServiceKey;
                setConnectionView({ kind: 'loading', serviceKey: observedServiceKey });
                setPendingRowActions({});
                setEnrollmentFailures({});
                setAccountServiceEndpoint(observedEndpoint);
            }
            const session = directorySessionBinding?.serviceKey === observedServiceKey
                ? directorySessionBinding.session
                : createAccountDirectorySession({
                    endpoint: endpoint.url,
                    serverIdentityId: endpointServerIdentityId,
                }, { capability });
            if (session !== directorySessionBinding?.session) {
                setDirectorySessionBinding({ serviceKey: observedServiceKey, session });
            }
            capabilityValidated = true;
            setCapabilityPresentation(null);
            const preferredHomeServerIdentityId = session.snapshot.preferredHomeServerIdentityId;
            if (preferredHomeServerIdentityId) {
                setPendingRowActions((current) => ({ ...current, [preferredHomeServerIdentityId]: 'enroll' }));
            }
            const refreshed = await refreshAndEnrollAccountService(session, {
                shouldCancel,
                enroll: pendingEnrollment?.serviceKey !== observedServiceKey,
            });
            if (shouldCancel()) return;
            if (refreshed.snapshot.status === 'ready') {
                const enrolledHomeServerIdentityId = refreshed.snapshot.preferredHomeServerIdentityId;
                const enrollment = projectEnrollment(refreshed.enrollment);
                if (enrolledHomeServerIdentityId) {
                    setEnrollmentFailures((current) => {
                        const next = { ...current };
                        if (enrollment === 'failed') next[enrolledHomeServerIdentityId] = true;
                        else delete next[enrolledHomeServerIdentityId];
                        return next;
                    });
                }
            } else if (isExpiredCredentialError(refreshed.snapshot.error)) {
                setConnectionView({ kind: 'credential_expired', serviceKey: observedServiceKey });
            }
        } catch {
            if (!shouldCancel()) {
                if (!capabilityValidated) {
                    setCapabilityPresentation({ kind: 'unreachable', serviceKey: requestedServiceKey });
                }
                await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
            }
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                for (const [homeServerIdentityId, action] of Object.entries(next)) {
                    if (action === 'enroll') delete next[homeServerIdentityId];
                }
                return next;
            });
        }
    }, [beginAttempt, connected, directoryRefreshing, directorySessionBinding, endpoint, pendingEnrollment, serviceKey]);

    React.useEffect(() => {
        if (!connected || directoryRefreshing) return;
        if (automaticallyHydratedServiceKeyRef.current === serviceKey) return;
        automaticallyHydratedServiceKeyRef.current = serviceKey;
        void refreshAndEnroll();
    }, [connected, directoryRefreshing, refreshAndEnroll, serviceKey]);

    const loginWithKey = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        const { attempt, shouldCancel } = beginAttempt(serviceKey);
        try {
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
            if (shouldCancel()) return;
            const capability = parseAccountDirectoryCapability(
                observed.status === 'ready'
                    ? observed.features.capabilities.accountDirectory
                    : null,
            );
            const endpointServerIdentityId = observed.status === 'ready'
                ? observed.serverIdentityId?.trim() ?? ''
                : '';
            const canonicalServerUrl = observed.status === 'ready'
                ? normalizeAccountDirectoryEndpoint(
                    observed.features.capabilities.server.canonicalServerUrl ?? '',
                )
                : null;
            const supportsKeyAcquisition = observed.status === 'ready'
                && observed.features.capabilities.auth.keyChallenge.v2 === true;
            if (
                capability?.homeDirectory !== true
                || !endpointServerIdentityId
                || !canonicalServerUrl
                || !supportsKeyAcquisition
            ) {
                throw new Error('Account Service key login unavailable');
            }

            const rawSecret = await Modal.prompt(
                t('connect.secretKeyInputLabel'),
                t('connect.restoreWithSecretKeyDescription'),
                {
                    inputType: 'secure-text',
                    confirmText: t('common.login'),
                    cancelText: t('common.cancel'),
                },
            );
            if (rawSecret === null) return;

            let secret: Uint8Array;
            try {
                secret = decodeBase64(normalizeSecretKey(rawSecret), 'base64url');
                if (secret.length !== 32) throw new Error('Invalid secret key length');
            } catch {
                await Modal.alertAsync(t('common.error'), t('connect.invalidSecretKey'));
                return;
            }

            const authenticatedEndpoint = { ...endpoint, serverIdentityId: endpointServerIdentityId };
            const authenticatedServiceKey = accountServiceKey(authenticatedEndpoint);
            attempt.serviceKey = authenticatedServiceKey;
            serviceKeyRef.current = authenticatedServiceKey;
            previousServiceKeyRef.current = authenticatedServiceKey;
            automaticallyHydratedServiceKeyRef.current = authenticatedServiceKey;
            setAccountServiceEndpoint(authenticatedEndpoint);
            await accountDirectoryAuthClient.loginWithKey({
                endpointUrl: endpoint.url,
                endpointServerIdentityId,
                canonicalServerUrl,
                secret,
            });
            if (shouldCancel()) return;
            setConnectionView({ kind: 'connected', serviceKey: authenticatedServiceKey });
            const session = createAccountDirectorySession({
                endpoint: endpoint.url,
                serverIdentityId: endpointServerIdentityId,
            }, { capability });
            setDirectorySessionBinding({ serviceKey: authenticatedServiceKey, session });
            const refreshed = await refreshAndEnrollAccountService(session, { shouldCancel });
            if (shouldCancel()) return;
            if (refreshed.snapshot.status === 'ready') {
                const preferredIdentity = refreshed.snapshot.preferredHomeServerIdentityId;
                if (preferredIdentity && projectEnrollment(refreshed.enrollment) === 'failed') {
                    setEnrollmentFailures((current) => ({ ...current, [preferredIdentity]: true }));
                }
            }
        } catch {
            if (!shouldCancel()) await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setBusy(false);
        }
    }, [beginAttempt, busy, endpoint, serviceKey]);

    const startOAuthForHome = React.useCallback(async (homeServerIdentityId?: string) => {
        if (busy) return;
        setBusy(true);
        const { attempt, shouldCancel } = beginAttempt(serviceKey);
        let endpointServerIdentityId = '';
        let pendingMayExist = false;
        try {
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
            if (shouldCancel()) return;
            const capability = parseAccountDirectoryCapability(
                observed.status === 'ready'
                    ? observed.features.capabilities.accountDirectory
                    : null,
            );
            endpointServerIdentityId = observed.status === 'ready'
                ? observed.serverIdentityId?.trim() ?? ''
                : '';
            const providerId = observed.status === 'ready'
                ? resolvePreferredProvisionProviderId(observed.features)
                : null;
            if (capability?.homeDirectory !== true || !endpointServerIdentityId || !providerId) {
                throw new Error('Account Service OAuth unavailable');
            }
            const authenticatedEndpoint = { ...endpoint, serverIdentityId: endpointServerIdentityId };
            const authenticatedServiceKey = accountServiceKey(authenticatedEndpoint);
            attempt.serviceKey = authenticatedServiceKey;
            serviceKeyRef.current = authenticatedServiceKey;
            previousServiceKeyRef.current = authenticatedServiceKey;
            setAccountServiceEndpoint(authenticatedEndpoint);
            const url = await accountDirectoryAuthClient.startOAuth({
                endpointUrl: endpoint.url,
                endpointServerIdentityId,
                providerId,
                mode: 'keyed',
                returnTo: '/settings/account',
                ...(homeServerIdentityId ? { homeServerIdentityId } : {}),
            });
            pendingMayExist = true;
            if (shouldCancel()) throw new Error('Account Service OAuth attempt cancelled');
            if (!isSafeExternalAuthUrl(url)) throw new Error('Invalid Account Service OAuth URL');
            await Linking.openURL(url);
        } catch {
            if (pendingMayExist) {
                await TokenStorage.clearPendingAccountDirectoryAuth({
                    endpoint: endpoint.url,
                    serverIdentityId: endpointServerIdentityId,
                }).catch(() => false);
            }
            if (!shouldCancel()) await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setBusy(false);
        }
    }, [beginAttempt, busy, endpoint, serviceKey]);

    const login = React.useCallback(async () => {
        await startOAuthForHome();
    }, [startOAuthForHome]);

    const disconnect = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        const cancellation = invalidateAttempts();
        try {
            await cancellation;
            const removed = directorySession
                ? await directorySession.logout()
                : endpoint.serverIdentityId?.trim()
                    ? await accountDirectoryCredentialStorage.logout({
                        endpoint: endpoint.url,
                        serverIdentityId: endpoint.serverIdentityId,
                    })
                    : false;
            if (!removed) {
                await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                return;
            }
            setConnectionView({ kind: 'disconnected', serviceKey });
            setDirectorySessionBinding(null);
            setCapabilityPresentation(null);
            setPendingRowActions({});
            setEnrollmentFailures({});
        } finally {
            setBusy(false);
        }
    }, [busy, directorySession, endpoint.serverIdentityId, endpoint.url, invalidateAttempts, serviceKey]);

    const setPreferredHome = React.useCallback(async (homeServerIdentityId: string) => {
        if (!directorySession || pendingRowActions[homeServerIdentityId]) return;
        const { shouldCancel } = beginAttempt(serviceKey);
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'set_preferred' }));
        try {
            await directorySession.setPreferredHome(homeServerIdentityId);
            if (shouldCancel()) return;
            const snapshot = await directorySession.refresh();
            if (shouldCancel()) return;
            if (
                snapshot.status === 'ready'
                && snapshot.preferredHomeServerIdentityId === homeServerIdentityId
            ) {
                setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'enroll' }));
                const result = await enrollPreferredDirectoryHome(directorySession, { shouldCancel });
                if (shouldCancel()) return;
                setEnrollmentFailures((current) => {
                    const next = { ...current };
                    if (projectEnrollment(result) === 'failed') next[homeServerIdentityId] = true;
                    else delete next[homeServerIdentityId];
                    return next;
                });
            }
        } catch {
            if (!shouldCancel()) await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [beginAttempt, directorySession, pendingRowActions, serviceKey]);

    const removeHome = React.useCallback(async (homeServerIdentityId: string, label: string) => {
        if (!directorySession || pendingRowActions[homeServerIdentityId]) return;
        const confirmed = await Modal.confirm(
            t('settingsAccount.accountServiceRemoveHomeConfirmTitle'),
            t('settingsAccount.accountServiceRemoveHomeConfirmBody', { label }),
            {
                confirmText: t('common.remove'),
                cancelText: t('common.cancel'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        const { shouldCancel } = beginAttempt(serviceKey);
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'remove' }));
        try {
            await directorySession.deleteHome(homeServerIdentityId);
            if (shouldCancel()) return;
            await directorySession.refresh();
            if (shouldCancel()) return;
        } catch {
            if (!shouldCancel()) await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [beginAttempt, directorySession, pendingRowActions, serviceKey]);

    const enrollHome = React.useCallback(async (homeServerIdentityId: string) => {
        if (!directorySession || pendingRowActions[homeServerIdentityId]) return;
        const { shouldCancel } = beginAttempt(serviceKey);
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'enroll' }));
        try {
            const result = await enrollPreferredDirectoryHome(directorySession, { shouldCancel });
            if (shouldCancel()) return;
            const enrollment = projectEnrollment(result);
            setEnrollmentFailures((current) => {
                const next = { ...current };
                if (enrollment === 'failed') next[homeServerIdentityId] = true;
                else delete next[homeServerIdentityId];
                return next;
            });
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [beginAttempt, directorySession, pendingRowActions, serviceKey]);

    const linkHome = React.useCallback(async (profile: ServerProfile) => {
        const homeServerIdentityId = profile.serverIdentityId?.trim() ?? '';
        if (!homeServerIdentityId || pendingRowActions[homeServerIdentityId]) return;
        if (!connected) {
            await startOAuthForHome(homeServerIdentityId);
            return;
        }

        const { attempt, shouldCancel } = beginAttempt(serviceKey);
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'link' }));
        try {
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
            if (shouldCancel()) return;
            const capability = parseAccountDirectoryCapability(
                observed.status === 'ready' ? observed.features.capabilities.accountDirectory : null,
            );
            const endpointServerIdentityId = observed.status === 'ready'
                ? observed.serverIdentityId?.trim() ?? ''
                : '';
            if (capability?.homeDirectory !== true || !endpointServerIdentityId) {
                throw new Error('Account Service Home linking unavailable');
            }
            const observedEndpoint = { ...endpoint, serverIdentityId: endpointServerIdentityId };
            const observedServiceKey = accountServiceKey(observedEndpoint);
            if (observedServiceKey !== serviceKey) {
                attempt.serviceKey = observedServiceKey;
                serviceKeyRef.current = observedServiceKey;
                previousServiceKeyRef.current = observedServiceKey;
                automaticallyHydratedServiceKeyRef.current = observedServiceKey;
                setAccountServiceEndpoint(observedEndpoint);
            }
            const session = directorySessionBinding?.serviceKey === observedServiceKey
                ? directorySessionBinding.session
                : createAccountDirectorySession({
                    endpoint: endpoint.url,
                    serverIdentityId: endpointServerIdentityId,
                }, { capability });
            if (session !== directorySessionBinding?.session) {
                setDirectorySessionBinding({ serviceKey: observedServiceKey, session });
            }
            const provisionInput = {
                session,
                homeServerIdentityId,
                issuerServerIdentityId: endpointServerIdentityId,
                capability,
                shouldCancel,
            } as const;
            let provisioned = await provisionAuthenticatedHomeLink(provisionInput);
            if (shouldCancel()) return;
            if (provisioned.kind === 'relink_required') {
                const confirmed = await Modal.confirm(
                    t('settingsAccount.accountServiceRelinkConfirmTitle'),
                    t('settingsAccount.accountServiceRelinkConfirmBody'),
                    {
                        confirmText: t('common.continue'),
                        cancelText: t('common.cancel'),
                    },
                );
                if (!confirmed || shouldCancel()) return;
                provisioned = await provisionAuthenticatedHomeLink({ ...provisionInput, relink: true });
            }
            if (provisioned.kind !== 'linked' || shouldCancel()) {
                throw new Error('Authenticated Home relationship provisioning failed');
            }
            const refreshed = await refreshAccountHomeDirectory(session, { shouldCancel });
            if (shouldCancel()) return;
            let enrollment: PreferredDirectoryHomeEnrollmentResult | null = null;
            if (refreshed.status === 'ready') {
                enrollment = await enrollPreferredDirectoryHome(session, { shouldCancel });
            }
            if (shouldCancel()) return;
            if (refreshed.status === 'ready') {
                const preferredIdentity = refreshed.preferredHomeServerIdentityId;
                if (preferredIdentity && projectEnrollment(enrollment) === 'failed') {
                    setEnrollmentFailures((current) => ({ ...current, [preferredIdentity]: true }));
                }
            }
        } catch {
            if (!shouldCancel()) await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [beginAttempt, connected, directorySessionBinding, endpoint, pendingRowActions, serviceKey, startOAuthForHome]);

    const linkableProfiles = profiles.filter((profile) => {
        const identity = profile.serverIdentityId?.trim() ?? '';
        return Boolean(identity) && authStatusByProfileId[resolveServerProfileScopeId(profile)] === 'signedIn';
    });
    const linkableProfileByIdentity = new Map(linkableProfiles.map((profile) => [
        profile.serverIdentityId!.trim(),
        profile,
    ]));
    const directoryHomeIdentityIds = new Set(
        directorySnapshot?.homes.map((home) => home.homeServerIdentityId) ?? [],
    );
    const localHomesMissingFromDirectory = linkableProfiles.filter((profile) => (
        !directoryHomeIdentityIds.has(profile.serverIdentityId!.trim())
    ));

    const statusDetail = visibleConnection.kind === 'loading'
        ? t('settingsAccount.accountServiceCheckingConnection')
        : visibleConnection.kind === 'connected'
            ? t('settingsAccount.statusActive')
            : visibleConnection.kind === 'credential_expired'
                ? t('settingsAccount.accountServiceReconnectRequired')
                : visibleConnection.kind === 'custody_unavailable'
                    ? t('common.unavailable')
                : t('settingsAccount.statusNotAuthenticated');
    const canAuthenticate = visibleConnection.kind === 'disconnected'
        || visibleConnection.kind === 'credential_expired';
    const directoryNotice = visibleConnection.kind === 'credential_expired'
        ? (
            <Item
                testID="settings-account-service-directory-credential-expired"
                mode="info"
                title={t('settingsAccount.accountServiceReconnectRequired')}
                subtitle={t('settingsAccount.accountServiceReconnectDescription')}
                showChevron={false}
            />
        )
        : directorySnapshot?.status === 'loading' && directorySnapshot.homes.length === 0
            ? (
                <Item
                    testID="settings-account-service-directory-loading"
                    mode="info"
                    title={t('settingsAccount.accountServiceDiscoveringHomes')}
                    loading
                    showChevron={false}
                />
            )
            : visibleCapabilityPresentation?.kind === 'missing' || directorySnapshot?.status === 'unsupported'
                ? (
                    <Item
                        testID="settings-account-service-directory-unsupported"
                        mode="info"
                        title={t('settingsAccount.accountServiceDiscoveryUnsupported')}
                        subtitle={t('settingsAccount.accountServiceDiscoveryUnsupportedDescription')}
                        showChevron={false}
                    />
                )
                : visibleCapabilityPresentation?.kind === 'unreachable'
                    || directorySnapshot?.status === 'error'
                    || directorySnapshot?.status === 'stale'
                    ? (
                        <Item
                            testID="settings-account-service-directory-unavailable"
                            mode="info"
                            title={t('settingsAccount.accountServiceDiscoveryUnavailable')}
                            subtitle={t('settingsAccount.accountServiceDiscoveryUnavailableDescription')}
                            showChevron={false}
                        />
                    )
                    : directorySnapshot?.status === 'ready' && directorySnapshot.homes.length === 0
                        ? (
                            <Item
                                testID="settings-account-service-directory-empty"
                                mode="info"
                                title={t('settingsAccount.accountServiceHomesEmpty')}
                                subtitle={t('settingsAccount.accountServiceHomesEmptyDescription')}
                                showChevron={false}
                            />
                        )
                        : null;

    return (
        <>
            <ItemGroup title={endpoint.displayName ?? displayNameForEndpoint(endpoint.url)}>
                <Item
                    testID="settings-account-service-status"
                    title={t('settingsAccount.status')}
                    detail={statusDetail}
                    accessibilityLiveRegion="polite"
                    showChevron={false}
                />
                {connected ? (
                    null
                ) : canAuthenticate ? (
                    <Item
                        testID="settings-account-service-login"
                        title={t('settingsAccount.accountServiceOAuth.title')}
                        onPress={login}
                        disabled={busy}
                        loading={busy}
                        showChevron={false}
                    />
                ) : null}
                <ExpandableItem
                    testID="settings-account-service-advanced"
                    expanded={advancedExpanded}
                    onExpandedChange={setAdvancedExpanded}
                    header={({ headerProps }) => (
                        <Item {...headerProps} title={t('settingsSession.handoff.advanced.title')} />
                    )}
                >
                    <Item
                        testID="settings-account-service-select"
                        title={t('settingsAccount.server')}
                        subtitle={endpoint.url}
                        detail={endpoint.serverIdentityId}
                        subtitleLines={1}
                        subtitleEllipsizeMode="middle"
                        onPress={selectEndpoint}
                        disabled={busy}
                    />
                    {directorySnapshot?.refreshedAtMs ? (
                        <Item
                            testID="settings-account-service-technical-last-refresh"
                            title={t('common.refresh')}
                            detail={new Date(directorySnapshot.refreshedAtMs).toLocaleString()}
                            mode="info"
                            showChevron={false}
                        />
                    ) : null}
                    {directorySnapshot?.preferredHomeServerIdentityId ? (
                        <Item
                            testID="settings-account-service-technical-preferred"
                            title={t('settingsAccount.accountServicePreferredHome')}
                            detail={directorySnapshot.homes.find((home) => (
                                home.homeServerIdentityId === directorySnapshot.preferredHomeServerIdentityId
                            ))?.label ?? directorySnapshot.preferredHomeServerIdentityId}
                            mode="info"
                            showChevron={false}
                        />
                    ) : null}
                    {directorySnapshot?.homes.map((home) => {
                        const endpointDetails = formatHomeEndpointDetails(home);
                        const technicalDetails = endpointDetails === home.canonicalServerUrl
                            ? home.canonicalServerUrl
                            : `${home.canonicalServerUrl} · ${endpointDetails}`;
                        return (
                            <Item
                                key={`technical-${home.homeServerIdentityId}`}
                                testID={`settings-account-service-technical-home-${home.homeServerIdentityId}`}
                                title={home.label}
                                subtitle={technicalDetails}
                                subtitleLines={2}
                                subtitleEllipsizeMode="middle"
                                mode="info"
                                showChevron={false}
                            />
                        );
                    })}
                    {canAuthenticate ? (
                        <Item
                            testID="settings-account-service-key-login"
                            title={t('navigation.restoreWithSecretKey')}
                            onPress={loginWithKey}
                            disabled={busy}
                            showChevron={false}
                        />
                    ) : null}
                    {connected ? (
                        <>
                            <Item
                                testID="settings-account-service-refresh"
                                title={t('common.refresh')}
                                onPress={refreshAndEnroll}
                                disabled={directoryRefreshing}
                                loading={directoryRefreshing}
                                showChevron={false}
                            />
                            <Item
                                testID="settings-account-service-disconnect"
                                title={t('settingsAccount.tapToDisconnect')}
                                onPress={disconnect}
                                disabled={busy}
                                showChevron={false}
                            />
                        </>
                    ) : null}
                </ExpandableItem>
            </ItemGroup>
            {(directoryNotice || directorySnapshot || localHomesMissingFromDirectory.length > 0) ? (
                <ItemGroup
                    title={t('settingsAccount.accountServiceHomes')}
                    footer={t('settingsAccount.accountServiceDiscoveryDescription')}
                >
                    {directoryNotice}
                    {directorySnapshot?.homes.map((home) => {
                        const preferred = directorySnapshot.preferredHomeServerIdentityId === home.homeServerIdentityId;
                        const testID = `settings-account-service-home-${home.homeServerIdentityId}`;
                        const pendingAction = pendingRowActions[home.homeServerIdentityId];
                        const profile = linkableProfileByIdentity.get(home.homeServerIdentityId)
                            ?? profiles.find((candidate) => candidate.id === home.homeServerIdentityId);
                        const durablyEnrolled = profile
                            ? authStatusByProfileId[resolveServerProfileScopeId(profile)] === 'signedIn'
                            : false;
                        const reconciliation = directorySnapshot.reconciliation;
                        const adoptionFailed = (
                            reconciliation?.kind === 'completed'
                            || reconciliation?.kind === 'cancelled'
                        ) && reconciliation.failures.some((failure) => (
                            failure.homeServerIdentityId === home.homeServerIdentityId
                        ));
                        const enrollmentView: EnrollmentView | null = durablyEnrolled
                            ? 'enrolled'
                            : pendingEnrollment?.homeServerIdentityId === home.homeServerIdentityId
                                ? 'approval_required'
                                : enrollmentFailures[home.homeServerIdentityId] || adoptionFailed
                                    ? 'failed'
                                    : null;
                        const setPreferredTitle = t('settingsAccount.accountServiceSetPreferredHome');
                        const removeTitle = t('settingsAccount.accountServiceRemoveHome');
                        const enrollTitle = enrollmentView === 'failed'
                            ? t('settingsAccount.accountServiceRetryHomeConnection')
                            : t('settingsAccount.accountServiceConnectHome');
                        const actions = [
                            ...(profile && authStatusByProfileId[resolveServerProfileScopeId(profile)] === 'signedIn' ? [{
                                id: `${testID}-link`,
                                inlineTestID: `${testID}-link`,
                                title: t('settingsAccount.accountServiceLinkThisHome'),
                                icon: pendingAction === 'link'
                                    ? <ActivitySpinner size="small" />
                                    : 'link' as const,
                                disabled: Boolean(pendingAction) || busy,
                                onPress: () => { void linkHome(profile); },
                            }] : []),
                            ...(!preferred ? [{
                                id: `${testID}-set-preferred`,
                                inlineTestID: `${testID}-set-preferred`,
                                title: setPreferredTitle,
                                icon: pendingAction === 'set_preferred'
                                    ? <ActivitySpinner size="small" />
                                    : 'star' as const,
                                disabled: Boolean(pendingAction),
                                onPress: () => { void setPreferredHome(home.homeServerIdentityId); },
                            }] : []),
                            ...(preferred && enrollmentView === 'failed' ? [{
                                id: `${testID}-enroll`,
                                inlineTestID: `${testID}-enroll`,
                                title: enrollTitle,
                                icon: pendingAction === 'enroll'
                                    ? <ActivitySpinner size="small" />
                                    : 'link' as const,
                                disabled: Boolean(pendingAction),
                                onPress: () => { void enrollHome(home.homeServerIdentityId); },
                            }] : []),
                            {
                                id: `${testID}-remove`,
                                inlineTestID: `${testID}-remove`,
                                title: removeTitle,
                                icon: pendingAction === 'remove'
                                    ? <ActivitySpinner size="small" />
                                    : 'trash' as const,
                                disabled: Boolean(pendingAction),
                                destructive: true,
                                onPress: () => { void removeHome(home.homeServerIdentityId, home.label); },
                            },
                        ];
                        const commonActionId = preferred && enrollmentView === 'failed'
                            ? `${testID}-enroll`
                            : !preferred
                                ? `${testID}-set-preferred`
                                : profile && authStatusByProfileId[resolveServerProfileScopeId(profile)] === 'signedIn'
                                    ? `${testID}-link`
                                    : null;
                        const preferredLabel = t('settingsAccount.accountServicePreferredHome');
                        const enrollmentLabel = enrollmentView === 'enrolled'
                            ? t('settingsAccount.accountServiceHomeConnected')
                            : enrollmentView === 'approval_required'
                                ? t('settingsAccount.accountServiceHomeApprovalRequired')
                                : enrollmentView === 'failed'
                                    ? t('settingsAccount.accountServiceHomeConnectionFailed')
                                    : null;
                        const statusLabel = [preferred ? preferredLabel : null, enrollmentLabel].filter(Boolean).join(' · ');
                        return (
                            <Item
                                key={home.homeServerIdentityId}
                                testID={testID}
                                title={home.label}
                                detail={statusLabel || undefined}
                                detailTestID={preferred ? `${testID}-preferred` : undefined}
                                accessibilityLabel={statusLabel ? `${home.label}, ${statusLabel}` : home.label}
                                mode="info"
                                rightElement={(
                                    <ItemRowActions
                                        title={home.label}
                                        actions={actions}
                                        compactThreshold={Number.MAX_SAFE_INTEGER}
                                        compactActionIds={commonActionId ? [commonActionId] : []}
                                    />
                                )}
                                rightElementOutsidePressable
                                showChevron={false}
                            />
                        );
                    })}
                    {localHomesMissingFromDirectory.map((profile) => {
                        const homeServerIdentityId = profile.serverIdentityId!.trim();
                        const testID = `settings-account-service-local-home-${homeServerIdentityId}`;
                        const linking = pendingRowActions[homeServerIdentityId] === 'link';
                        const actions = [{
                            id: `${testID}-link`,
                            inlineTestID: `${testID}-link`,
                            title: t('settingsAccount.accountServiceLinkThisHome'),
                            icon: linking ? <ActivitySpinner size="small" /> : 'link' as const,
                            disabled: Boolean(pendingRowActions[homeServerIdentityId]) || busy,
                            onPress: () => { void linkHome(profile); },
                        }];
                        return (
                            <Item
                                key={profile.id}
                                testID={testID}
                                title={profile.name}
                                subtitle={t('settingsAccount.accountServiceLinkThisHomeDescription').replace(
                                    '{accountService}',
                                    endpoint.displayName ?? displayNameForEndpoint(endpoint.url),
                                )}
                                mode="info"
                                rightElement={(
                                    <ItemRowActions
                                        title={profile.name}
                                        actions={actions}
                                        compactThreshold={Number.MAX_SAFE_INTEGER}
                                        compactActionIds={actions.map((action) => action.id)}
                                    />
                                )}
                                rightElementOutsidePressable
                                showChevron={false}
                            />
                        );
                    })}
                </ItemGroup>
            ) : null}
        </>
    );
}
