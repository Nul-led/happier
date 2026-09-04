import * as React from 'react';
import { Linking } from 'react-native';

import { accountDirectoryCredentialStorage, normalizeAccountDirectoryEndpoint } from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import { accountDirectoryAuthClient } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import {
    authenticateSelectedAccountServiceWithKey,
    refreshAndEnrollAccountServiceDirectory,
} from '@/auth/accountDirectory/accountDirectoryKeyAuth';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { useServerAuthStatusByServerId } from '@/components/settings/server/hooks/useServerAuthStatusByServerId';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Modal } from '@/modal';
import {
    type AccountDirectorySession,
    type AccountDirectorySessionSnapshot,
    createAccountDirectoryServiceKey,
    createAccountDirectorySession,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import {
    getServerProfilesGeneration,
    listServerProfiles,
    resolveSelectedAccountServiceEndpoint,
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
import { t } from '@/text';

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
}> | Readonly<{
    serviceKey: string;
    kind: 'supported';
    homeDirectory: boolean;
    homeEnrollment: boolean;
}>;

type RowActionKind = 'set_preferred' | 'remove' | 'enroll' | 'link';
type EnrollmentFailureView = 'rejected' | 'expired' | 'failed' | 'partial_commit';
type EnrollmentView = 'enrolled' | 'approval_required' | EnrollmentFailureView;
type ServiceAttempt = {
    readonly id: number;
    readonly serviceInvalidationRevision: number;
    serviceKey: string;
};

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

function projectEnrollment(result: PreferredDirectoryHomeEnrollmentResult | null): EnrollmentView | null {
    if (!result) return null;
    if (result.kind === 'enrolled') return 'enrolled';
    if (result.kind === 'approval_required') return 'approval_required';
    if (result.kind === 'rejected') return 'rejected';
    if (result.kind === 'expired') return 'expired';
    if (result.kind === 'partial_commit') return 'partial_commit';
    if (result.kind === 'unavailable' && result.reason === 'no_preferred_home') return null;
    return 'failed';
}

function projectEnrollmentFailure(result: PreferredDirectoryHomeEnrollmentResult | null): EnrollmentFailureView | null {
    const view = projectEnrollment(result);
    return view !== null && view !== 'enrolled' && view !== 'approval_required' ? view : null;
}

/**
 * Production Account Service composition. The endpoint and credential namespace stay outside
 * Home profiles/runtime; refresh is the only path that adopts Directory Homes.
 */
export function AccountServiceSettingsSection(): React.ReactElement {
    const endpoint = React.useSyncExternalStore(
        (listener) => subscribeAccountServiceEndpoint(() => listener()),
        resolveSelectedAccountServiceEndpoint,
        resolveSelectedAccountServiceEndpoint,
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
    const [enrollmentFailures, setEnrollmentFailures] = React.useState<Readonly<Partial<Record<string, EnrollmentFailureView>>>>({});
    const [advancedExpanded, setAdvancedExpanded] = React.useState(false);
    const pendingEnrollment = React.useSyncExternalStore(
        subscribePendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
        getPendingPreferredHomeEnrollment,
    );
    const activeAttemptRef = React.useRef<ServiceAttempt | null>(null);
    const attemptSequenceRef = React.useRef(0);
    const serviceInvalidationRevisionRef = React.useRef(0);
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
        shouldInvalidateContinuation: () => boolean;
    }> => {
        const attempt: ServiceAttempt = {
            id: ++attemptSequenceRef.current,
            serviceInvalidationRevision: serviceInvalidationRevisionRef.current,
            serviceKey: targetServiceKey,
        };
        activeAttemptRef.current = attempt;
        return {
            attempt,
            shouldCancel: () => activeAttemptRef.current !== attempt || serviceKeyRef.current !== attempt.serviceKey,
            shouldInvalidateContinuation: () => (
                serviceInvalidationRevisionRef.current !== attempt.serviceInvalidationRevision
                || serviceKeyRef.current !== attempt.serviceKey
            ),
        };
    }, []);

    const invalidateAttempts = React.useCallback(() => {
        activeAttemptRef.current = null;
        attemptSequenceRef.current += 1;
        serviceInvalidationRevisionRef.current += 1;
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
                    const observed = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                        endpointUrl: endpoint.url,
                    });
                    if (cancelled) return;
                    if (observed.kind !== 'supported_account_service') {
                        setConnectionView({ kind: 'disconnected', serviceKey: requestedServiceKey });
                        return;
                    }
                    serverIdentityId = observed.serverIdentityId;
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
            const observed = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                endpointUrl: normalized,
            });
            if (observed.kind !== 'supported_account_service') {
                await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                return;
            }
            setAccountServiceEndpoint({
                url: normalized,
                serverIdentityId: observed.serverIdentityId,
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
        const { attempt, shouldCancel, shouldInvalidateContinuation } = beginAttempt(requestedServiceKey);
        let capabilityValidated = false;
        setCapabilityPresentation({ kind: 'probing', serviceKey: requestedServiceKey });
        try {
            const observed = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                endpointUrl: endpoint.url,
                expectedServerIdentityId: endpoint.serverIdentityId,
            });
            if (shouldCancel()) return;
            if (observed.kind !== 'supported_account_service') {
                if (observed.kind === 'not_account_service') {
                    setCapabilityPresentation({ kind: 'missing', serviceKey: requestedServiceKey });
                    return;
                }
                setCapabilityPresentation({ kind: 'unreachable', serviceKey: requestedServiceKey });
                return;
            }
            const capability = observed.capability;
            const endpointServerIdentityId = observed.serverIdentityId;
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
            setCapabilityPresentation({
                kind: 'supported',
                serviceKey: observedServiceKey,
                homeDirectory: capability.homeDirectory,
                homeEnrollment: capability.homeEnrollment,
            });
            const preferredHomeServerIdentityId = session.snapshot.preferredHomeServerIdentityId;
            if (preferredHomeServerIdentityId) {
                setPendingRowActions((current) => ({ ...current, [preferredHomeServerIdentityId]: 'enroll' }));
            }
            const refreshed = await refreshAndEnrollAccountServiceDirectory(session, {
                entryIntent: 'connect_service',
                shouldCancel,
                shouldInvalidateContinuation,
                enroll: pendingEnrollment?.serviceKey !== observedServiceKey,
            });
            if (shouldCancel()) return;
            if (refreshed.snapshot.status === 'ready') {
                const enrolledHomeServerIdentityId = refreshed.snapshot.preferredHomeServerIdentityId;
                const failure = projectEnrollmentFailure(refreshed.enrollment);
                if (enrolledHomeServerIdentityId) {
                    setEnrollmentFailures((current) => {
                        const next = { ...current };
                        if (failure) next[enrolledHomeServerIdentityId] = failure;
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
        const { attempt, shouldCancel, shouldInvalidateContinuation } = beginAttempt(serviceKey);
        try {
            // One canonical Account Service key ceremony, shared with unauthenticated Welcome.
            // Settings composes it with its connect_service intent and keeps focus unchanged.
            const auth = await authenticateSelectedAccountServiceWithKey({
                endpoint,
                shouldCancel,
                onServiceIdentityObserved: ({ serviceKey: authenticatedServiceKey }) => {
                    attempt.serviceKey = authenticatedServiceKey;
                    serviceKeyRef.current = authenticatedServiceKey;
                    previousServiceKeyRef.current = authenticatedServiceKey;
                    automaticallyHydratedServiceKeyRef.current = authenticatedServiceKey;
                },
            });
            if (auth.kind === 'cancelled') return;
            if (auth.kind === 'invalid_key') {
                await Modal.alertAsync(t('common.error'), t('connect.invalidSecretKey'));
                return;
            }
            if (auth.kind !== 'authenticated') {
                throw new Error('Account Service key login unavailable');
            }
            const authenticatedServiceKey = auth.serviceKey;
            setConnectionView({ kind: 'connected', serviceKey: authenticatedServiceKey });
            setDirectorySessionBinding({ serviceKey: authenticatedServiceKey, session: auth.session });
            setCapabilityPresentation({
                kind: 'supported',
                serviceKey: authenticatedServiceKey,
                homeDirectory: auth.discovery.capability.homeDirectory,
                homeEnrollment: auth.discovery.capability.homeEnrollment,
            });
            const refreshed = await refreshAndEnrollAccountServiceDirectory(auth.session, {
                entryIntent: 'connect_service',
                shouldCancel,
                shouldInvalidateContinuation,
            });
            if (shouldCancel()) return;
            if (refreshed.snapshot.status === 'ready') {
                const preferredIdentity = refreshed.snapshot.preferredHomeServerIdentityId;
                const failure = projectEnrollmentFailure(refreshed.enrollment);
                if (preferredIdentity && failure) {
                    setEnrollmentFailures((current) => ({ ...current, [preferredIdentity]: failure }));
                }
            } else if (isExpiredCredentialError(refreshed.snapshot.error)) {
                setConnectionView({ kind: 'credential_expired', serviceKey: authenticatedServiceKey });
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
            const discovery = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                endpointUrl: endpoint.url,
                expectedServerIdentityId: endpoint.serverIdentityId,
                requestedMethod: { kind: 'oauth' },
            });
            if (shouldCancel()) return;
            if (discovery.kind !== 'supported_account_service' || !discovery.preferredProvisionProviderId) {
                throw new Error('Account Service OAuth unavailable');
            }
            const capability = discovery.capability;
            endpointServerIdentityId = discovery.serverIdentityId;
            const providerId = discovery.preferredProvisionProviderId;
            const canonicalServerUrl = discovery.canonicalServerUrl;
            const authenticatedEndpoint = { ...endpoint, serverIdentityId: endpointServerIdentityId };
            const authenticatedServiceKey = accountServiceKey(authenticatedEndpoint);
            attempt.serviceKey = authenticatedServiceKey;
            serviceKeyRef.current = authenticatedServiceKey;
            previousServiceKeyRef.current = authenticatedServiceKey;
            setAccountServiceEndpoint(authenticatedEndpoint);
            const url = await accountDirectoryAuthClient.startOAuth({
                endpointUrl: endpoint.url,
                endpointServerIdentityId,
                canonicalServerUrl,
                providerId,
                // Linked plaintext/keyless Accounts can complete without
                // manufacturing a Home signing secret. An unlinked identity
                // receives the typed keyed-required result and the callback
                // starts a fresh keyed continuation.
                mode: 'keyless',
                entryIntent: 'connect_service',
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
        const { shouldCancel, shouldInvalidateContinuation } = beginAttempt(serviceKey);
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
                const result = await enrollPreferredDirectoryHome(directorySession, {
                    entryIntent: 'connect_service',
                    shouldCancel,
                    shouldInvalidateContinuation,
                });
                if (shouldCancel()) return;
                setEnrollmentFailures((current) => {
                    const next = { ...current };
                    const failure = projectEnrollmentFailure(result);
                    if (failure) next[homeServerIdentityId] = failure;
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
        const { shouldCancel, shouldInvalidateContinuation } = beginAttempt(serviceKey);
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'enroll' }));
        try {
            const result = pendingEnrollment?.serviceKey === serviceKey
                && pendingEnrollment.homeServerIdentityId === homeServerIdentityId
                ? await resumePendingPreferredHomeEnrollment()
                : await enrollPreferredDirectoryHome(directorySession, {
                    entryIntent: 'connect_service',
                    shouldCancel,
                    shouldInvalidateContinuation,
                });
            if (!result) return;
            if (shouldCancel()) return;
            const enrollment = projectEnrollmentFailure(result);
            setEnrollmentFailures((current) => {
                const next = { ...current };
                if (enrollment) next[homeServerIdentityId] = enrollment;
                else delete next[homeServerIdentityId];
                return next;
            });
        } catch {
            if (!shouldCancel()) {
                setEnrollmentFailures((current) => ({
                    ...current,
                    [homeServerIdentityId]: 'failed',
                }));
            }
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [beginAttempt, directorySession, pendingEnrollment, pendingRowActions, serviceKey]);

    const linkHome = React.useCallback(async (profile: ServerProfile) => {
        const homeServerIdentityId = profile.serverIdentityId?.trim() ?? '';
        if (!homeServerIdentityId || pendingRowActions[homeServerIdentityId]) return;
        if (!connected) {
            await startOAuthForHome(homeServerIdentityId);
            return;
        }

        const { attempt, shouldCancel, shouldInvalidateContinuation } = beginAttempt(serviceKey);
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'link' }));
        try {
            const observed = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                endpointUrl: endpoint.url,
                expectedServerIdentityId: endpoint.serverIdentityId,
            });
            if (shouldCancel()) return;
            if (observed.kind !== 'supported_account_service') {
                throw new Error('Account Service Home linking unavailable');
            }
            const capability = observed.capability;
            const endpointServerIdentityId = observed.serverIdentityId;
            const capturedEndpointServerIdentityId = endpoint.serverIdentityId?.trim() ?? '';
            if (
                capturedEndpointServerIdentityId
                && endpointServerIdentityId !== capturedEndpointServerIdentityId
            ) {
                throw new Error('Account Service identity changed during Home linking');
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
                enrollment = await enrollPreferredDirectoryHome(session, {
                    entryIntent: 'connect_service',
                    shouldCancel,
                    shouldInvalidateContinuation,
                });
            }
            if (shouldCancel()) return;
            if (refreshed.status === 'ready') {
                const preferredIdentity = refreshed.preferredHomeServerIdentityId;
                const failure = projectEnrollmentFailure(enrollment);
                if (preferredIdentity && failure) {
                    setEnrollmentFailures((current) => ({ ...current, [preferredIdentity]: failure }));
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
    const homeDirectoryCapability = visibleCapabilityPresentation?.kind === 'supported'
        ? visibleCapabilityPresentation.homeDirectory
        : directorySession
            ? true
            : null;
    const homeEnrollmentCapability = visibleCapabilityPresentation?.kind === 'supported'
        ? visibleCapabilityPresentation.homeEnrollment
        : directorySession
            ? directorySession.supportsHomeEnrollment
            : null;
    const diagnosticDetail = visibleCapabilityPresentation?.kind === 'probing'
        ? t('settingsAccount.accountServiceDiagnosticChecking')
        : visibleCapabilityPresentation?.kind === 'missing'
            ? t('settingsAccount.accountServiceDiagnosticUnsupported')
            : visibleCapabilityPresentation?.kind === 'unreachable'
                ? t('settingsAccount.accountServiceDiagnosticUnavailable')
                : directorySnapshot?.status === 'error' || directorySnapshot?.status === 'stale'
                    ? t('settingsAccount.accountServiceDiagnosticUnavailable')
                    : directorySnapshot?.status === 'loading'
                        ? t('settingsAccount.accountServiceDiagnosticChecking')
                        : directorySnapshot?.status === 'unsupported'
                            ? t('settingsAccount.accountServiceDiagnosticUnsupported')
                            : visibleConnection.kind === 'connected'
                                ? t('settingsAccount.accountServiceDiagnosticReady')
                                : statusDetail;
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
            <ItemGroup title={t('settingsAccount.accountHomeDiscoveryTitle')}>
                <Item
                    testID="settings-account-service-status"
                    title={endpoint.displayName ?? displayNameForEndpoint(endpoint.url)}
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
                        title={t('settingsAccount.accountServiceSignInService')}
                        subtitle={endpoint.url}
                        subtitleLines={1}
                        subtitleEllipsizeMode="middle"
                        onPress={selectEndpoint}
                        disabled={busy}
                    />
                    <Item
                        testID="settings-account-service-technical-identity"
                        title={t('settingsAccount.accountServiceIdentity')}
                        detail={endpoint.serverIdentityId ?? t('common.unavailable')}
                        mode="info"
                        showChevron={false}
                    />
                    <Item
                        testID="settings-account-service-technical-home-directory"
                        title={t('settingsAccount.accountServiceHomeDirectoryCapability')}
                        detail={homeDirectoryCapability === null
                            ? t('common.unavailable')
                            : t(homeDirectoryCapability ? 'common.yes' : 'common.no')}
                        mode="info"
                        showChevron={false}
                    />
                    <Item
                        testID="settings-account-service-technical-home-enrollment"
                        title={t('settingsAccount.accountServiceHomeEnrollmentCapability')}
                        detail={homeEnrollmentCapability === null
                            ? t('common.unavailable')
                            : t(homeEnrollmentCapability ? 'common.yes' : 'common.no')}
                        mode="info"
                        showChevron={false}
                    />
                    <Item
                        testID="settings-account-service-technical-diagnostics"
                        title={t('settingsAccount.accountServiceDiagnostics')}
                        detail={diagnosticDetail}
                        mode="info"
                        showChevron={false}
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
                        const pendingForHome = pendingEnrollment?.homeServerIdentityId === home.homeServerIdentityId
                            ? pendingEnrollment
                            : null;
                        const enrollmentView: EnrollmentView | null = durablyEnrolled
                            ? 'enrolled'
                            : enrollmentFailures[home.homeServerIdentityId]
                                ?? (pendingForHome
                                    ? pendingForHome.kind === 'approval_required' ? 'approval_required' : 'failed'
                                    : adoptionFailed ? 'failed' : null);
                        const setPreferredTitle = t('settingsAccount.accountServiceSetPreferredHome');
                        const removeTitle = t('settingsAccount.accountServiceRemoveHome');
                        const enrollmentNeedsRetry = enrollmentView === 'failed'
                            || enrollmentView === 'partial_commit';
                        const enrollmentCanRestart = Boolean(pendingForHome)
                            || enrollmentNeedsRetry
                            || enrollmentView === 'rejected'
                            || enrollmentView === 'expired';
                        const enrollTitle = pendingForHome
                            ? t('common.retry')
                            : enrollmentNeedsRetry
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
                            ...(preferred && enrollmentCanRestart ? [{
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
                        const commonActionId = preferred && enrollmentCanRestart
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
                                : enrollmentView === 'rejected'
                                    ? t('connect.pairingRejectedBody')
                                    : enrollmentView === 'expired'
                                        ? t('settingsAccount.accountServiceOAuth.errors.expired.body')
                                        : enrollmentView === 'partial_commit'
                                            ? t('connect.homeEnrollmentPartialCommitBody')
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
