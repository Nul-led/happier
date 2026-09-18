import * as React from 'react';
import { View } from 'react-native';
import { AccountServiceContinuation } from '@/components/account/auth/AccountServiceContinuation';
import { AccountServiceHomeAuthenticationAdapter } from '@/components/account/auth/AccountServiceHomeAuthenticationAdapter';
import { AccountServiceSelectionForm } from '@/components/account/auth/AccountServiceSelectionForm';
import { WizardModalShell } from '@/components/onboarding';
import { AUTHENTICATED_ACCOUNT_ENTRY_ROUTE } from '@/components/navigation/accountEntry/authenticatedAccountEntryRoute';
import { useRouter } from 'expo-router';
import { buildAuthenticatedAccountEntryHref } from '@/components/navigation/accountEntry/authenticatedAccountEntryRoute';
import { useAccountDirectoryActivePolling } from '@/sync/ops/accountDirectory/useAccountDirectoryActivePolling';

import { accountDirectoryCredentialStorage } from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import { accountDirectoryAuthClient, createVerifiedAccountServiceAuthority, type VerifiedAccountServiceAuthority } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { completeAccountServicePostAuth, confirmAccountServiceHomeRelink, resumeAccountServicePostAuth, type AccountPostAuthInput, type AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';
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
    cancelPendingDirectoryHomeEnrollment,
    getPendingDirectoryHomeEnrollment,
    resumePendingDirectoryHomeEnrollment,
    subscribePendingDirectoryHomeEnrollment,
} from '@/sync/ops/accountDirectory/enrollDirectoryHome';
import { revokeAuthenticatedHomeLink } from '@/sync/ops/accountDirectory/provisionAuthenticatedHomeLink';
import { refreshAccountHomeDirectory } from '@/sync/ops/accountDirectory/refreshAccountHomeDirectory';
import { selectAccountServiceEndpoint } from '@/sync/ops/accountDirectory/selectAccountServiceEndpoint';
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
    service: VerifiedAccountServiceAuthority;
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

type RowActionKind = 'set_preferred' | 'remove' | 'enroll' | 'link' | 'unlink';
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

function projectEnrollmentFailure(result: AccountPostAuthResult | null): EnrollmentFailureView | null {
    if (result?.kind !== 'failure') return null;
    if (result.code.source === 'home' && (result.code.code === 'rejected' || result.code.code === 'expired' || result.code.code === 'partial_commit')) return result.code.code;
    return 'failed';
}

/**
 * Production Account Service composition. The endpoint and credential namespace stay outside
 * Home profiles/runtime; refresh is the only path that adopts Directory Homes.
 */
export function AccountServiceSettingsSection(): React.ReactElement {
    const router = useRouter();
    const continuationAbortRef = React.useRef<AbortController | null>(null);
    React.useEffect(() => () => continuationAbortRef.current?.abort(), []);
    const [continuationResults, setContinuationResults] = React.useState<Readonly<Record<string, { input: AccountPostAuthInput; result: AccountPostAuthResult }>>>({});
    const [homeAuthentication, setHomeAuthentication] = React.useState<Readonly<{
        input: AccountPostAuthInput; previous: AccountPostAuthResult; homeServerIdentityId: string;
    }> | null>(null);
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
    const [selectingEndpoint, setSelectingEndpoint] = React.useState(false);
    const pendingEnrollment = React.useSyncExternalStore(
        subscribePendingDirectoryHomeEnrollment,
        getPendingDirectoryHomeEnrollment,
        getPendingDirectoryHomeEnrollment,
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
    const verifiedAccountServiceName = directorySessionBinding?.serviceKey === serviceKey
        ? directorySessionBinding.service.snapshot.features.accountServicePresentation?.displayName?.trim() || undefined
        : undefined;
    const verifiedAccountServiceIdentity = directorySessionBinding?.serviceKey === serviceKey
        ? directorySessionBinding.service.serverIdentityId
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
        continuationAbortRef.current?.abort();
        activeAttemptRef.current = null;
        attemptSequenceRef.current += 1;
        serviceInvalidationRevisionRef.current += 1;
        return cancelPendingDirectoryHomeEnrollment();
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
                    await setAccountServiceEndpoint({ ...endpoint, serverIdentityId });
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

    const refreshDirectory = React.useCallback(async () => {
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
                await setAccountServiceEndpoint(observedEndpoint);
            }
            const session = directorySessionBinding?.serviceKey === observedServiceKey
                ? directorySessionBinding.session
                : createAccountDirectorySession({
                    endpoint: endpoint.url,
                    serverIdentityId: endpointServerIdentityId,
                }, { capability });
            if (session !== directorySessionBinding?.session) {
                setDirectorySessionBinding({ serviceKey: observedServiceKey, session, service: createVerifiedAccountServiceAuthority(observed) });
            }
            capabilityValidated = true;
            setCapabilityPresentation({
                kind: 'supported',
                serviceKey: observedServiceKey,
                homeDirectory: capability.homeDirectory,
                homeEnrollment: capability.homeEnrollment,
            });
            const refreshed = await refreshAccountHomeDirectory(session, { shouldCancel });
            if (!shouldCancel() && isExpiredCredentialError(refreshed.error)) {
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
        void refreshDirectory();
    }, [connected, directoryRefreshing, refreshDirectory, serviceKey]);

    const startAccountJourney = React.useCallback(async (source?: string | AccountPostAuthInput) => {
        if (busy) return;
        setBusy(true);
        try {
            if (typeof source === 'object') {
                router.push(buildAuthenticatedAccountEntryHref({
                    service: source.service,
                    intent: source.intent,
                    returnTo: '/settings/account',
                }));
                return;
            }
            const discovery = await accountDirectoryAuthClient.discoverAuthenticationMethods({
                endpointUrl: endpoint.url,
                expectedServerIdentityId: endpoint.serverIdentityId,
            });
            if (discovery.kind !== 'supported_account_service') throw new Error('Account Service unavailable');
            router.push(buildAuthenticatedAccountEntryHref({
                service: { endpointUrl: discovery.endpointUrl, serverIdentityId: discovery.serverIdentityId },
                intent: source
                    ? { kind: 'link', homeServerIdentityId: source }
                    : { kind: 'refresh' },
                returnTo: '/settings/account',
            }));
        } catch {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, endpoint, router]);

    const login = React.useCallback(() => startAccountJourney(), [startAccountJourney]);

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
            t('settingsAccount.accountServiceRemoveHomeConfirmTitle', { label, accountService: verifiedAccountServiceName }),
            t('settingsAccount.accountServiceRemoveHomeConfirmBody', { label, accountService: verifiedAccountServiceName }),
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
    }, [beginAttempt, directorySession, pendingRowActions, serviceKey, verifiedAccountServiceName]);

    const unlinkHome = React.useCallback(async (homeServerIdentityId: string, label: string) => {
        if (!verifiedAccountServiceIdentity || pendingRowActions[homeServerIdentityId]) return;
        const confirmed = await Modal.confirm(
            t('settingsAccount.accountServiceUnlinkHomeConfirmTitle', { label, accountService: verifiedAccountServiceName }),
            t('settingsAccount.accountServiceUnlinkHomeConfirmBody', { label, accountService: verifiedAccountServiceName }),
            {
                confirmText: t('settingsAccount.accountServiceUnlinkHomeConfirmAction'),
                cancelText: t('common.cancel'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        const shouldCancel = () => serviceKeyRef.current !== serviceKey;
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'unlink' }));
        try {
            const result = await revokeAuthenticatedHomeLink({
                homeServerIdentityId,
                issuerServerIdentityId: verifiedAccountServiceIdentity,
                shouldCancel,
            });
            if (result.kind !== 'unlinked' && !shouldCancel()) {
                await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
            }
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [pendingRowActions, serviceKey, verifiedAccountServiceIdentity, verifiedAccountServiceName]);

    const continueHome = React.useCallback(async (homeServerIdentityId: string, kind: 'link' | 'enroll') => {
        if (!directorySessionBinding || pendingRowActions[homeServerIdentityId]) return;
        if (pendingEnrollment?.serviceKey === serviceKey && pendingEnrollment.homeServerIdentityId === homeServerIdentityId) {
            const result = await resumePendingDirectoryHomeEnrollment();
            if (result) setContinuationResults((current) => ({ ...current, [homeServerIdentityId]: { input: pendingEnrollment.input, result } }));
            return;
        }
        continuationAbortRef.current?.abort();
        const controller = new AbortController();
        continuationAbortRef.current = controller;
        const input = { service: directorySessionBinding.service, session: directorySessionBinding.session,
            intent: { kind, homeServerIdentityId }, signal: controller.signal } as const;
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: kind }));
        try {
            const previous = continuationResults[homeServerIdentityId]?.result;
            let result = pendingEnrollment?.homeServerIdentityId === homeServerIdentityId
                ? await resumePendingDirectoryHomeEnrollment()
                : previous?.kind === 'failure' && previous.recovery === 'retry_stage'
                    ? await resumeAccountServicePostAuth(input, previous)
                    : await completeAccountServicePostAuth(input);
            if (result?.kind === 'failure' && result.recovery === 'relink_home') {
                const confirmed = await Modal.confirm(t('settingsAccount.accountServiceRelinkConfirmTitle', { accountService: verifiedAccountServiceName }),
                    t('settingsAccount.accountServiceRelinkConfirmBody', { accountService: verifiedAccountServiceName }),
                    { confirmText: t('common.continue'), cancelText: t('common.cancel') });
                if (confirmed && !controller.signal.aborted) result = await confirmAccountServiceHomeRelink(input);
            }
            if (!result || controller.signal.aborted) return;
            setContinuationResults((current) => ({ ...current, [homeServerIdentityId]: { input, result } }));
            if (result.kind === 'failure' && result.recovery === 'reauthenticate_account') {
                setConnectionView({ kind: 'credential_expired', serviceKey });
            }
            setEnrollmentFailures((current) => {
                const next = { ...current };
                const failure = projectEnrollmentFailure(result);
                if (failure) next[homeServerIdentityId] = failure;
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
    }, [continuationResults, directorySessionBinding, pendingEnrollment, pendingRowActions, serviceKey, verifiedAccountServiceName]);

    const enrollHome = React.useCallback((homeServerIdentityId: string) => continueHome(homeServerIdentityId, 'enroll'), [continueHome]);
    const linkHome = React.useCallback(async (profile: ServerProfile) => {
        const identity = profile.serverIdentityId;
        if (!identity) return;
        if (!connected) await startAccountJourney(identity);
        else await continueHome(identity, 'link');
    }, [connected, continueHome, startAccountJourney]);

    useAccountDirectoryActivePolling(async () => {
        if (!pendingEnrollment || pendingEnrollment.serviceKey !== serviceKey) return 'completed';
        const result = await resumePendingDirectoryHomeEnrollment();
        if (result && result.kind !== 'approval_required') {
            setContinuationResults((current) => ({ ...current, [pendingEnrollment.homeServerIdentityId]: { input: pendingEnrollment.input, result } }));
        }
        return result?.kind === 'failure' && result.recovery === 'retry_stage' ? 'backoff' : 'completed';
    }, pendingEnrollment?.serviceKey === serviceKey);

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
                ? t('settingsAccount.accountServiceReconnectRequired', { accountService: verifiedAccountServiceName })
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
                title={t('settingsAccount.accountServiceReconnectRequired', { accountService: verifiedAccountServiceName })}
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
                                subtitle={t('settingsAccount.accountServiceHomesEmptyDescription', { accountService: verifiedAccountServiceName })}
                                showChevron={false}
                            />
                        )
                        : null;

    if (selectingEndpoint) {
        return (
            <WizardModalShell
                testID="settings-account-service-selection"
                title={t('settingsAccount.accountServiceSignInService')}
                subtitle={endpoint.url}
                layoutPresentation="fullscreen"
                stepIndex={0}
                stepCount={1}
                showSkip={false}
                showBack={false}
            >
                <AccountServiceSelectionForm
                    currentEndpoint={endpoint}
                    onBack={() => setSelectingEndpoint(false)}
                    onSelect={async (entered, options) => {
                        const result = await selectAccountServiceEndpoint(entered, options);
                        if (result.kind === 'selected') setSelectingEndpoint(false);
                        return result;
                    }}
                />
            </WizardModalShell>
        );
    }

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
                        onPress={() => setSelectingEndpoint(true)}
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
                    {connected ? (
                        <>
                            <Item
                                testID="settings-account-service-refresh"
                                title={t('common.refresh')}
                                onPress={refreshDirectory}
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
                        const retained = continuationResults[home.homeServerIdentityId];
                        const continuation = retained?.input.session.serviceKey === serviceKey ? retained : undefined;
                        if (continuation?.result.kind === 'home_material_required' || continuation?.result.kind === 'failure') {
                            return <View key={home.homeServerIdentityId} testID={`settings-account-service-material-${home.homeServerIdentityId}`}>
                                {homeAuthentication?.input === continuation.input ? <AccountServiceHomeAuthenticationAdapter
                                    {...homeAuthentication} returnTo={AUTHENTICATED_ACCOUNT_ENTRY_ROUTE} accountEntryReturnTo="/settings/account"
                                    onBack={() => setHomeAuthentication(null)}
                                    onResult={(result) => {
                                        setContinuationResults((current) => ({ ...current,
                                            [home.homeServerIdentityId]: { input: homeAuthentication.input, result } }));
                                        setHomeAuthentication(null);
                                        setEnrollmentFailures((current) => {
                                            const next = { ...current };
                                            const failure = projectEnrollmentFailure(result);
                                            if (failure) next[home.homeServerIdentityId] = failure;
                                            else delete next[home.homeServerIdentityId];
                                            return next;
                                        });
                                    }} /> : <AccountServiceContinuation input={continuation.input} result={continuation.result}
                                    onReauthenticate={startAccountJourney}
                                    onOpenHomeAuthentication={(input, homeServerIdentityId, previous) => setHomeAuthentication({ input, homeServerIdentityId, previous })}
                                    onResult={(result, input) => setContinuationResults((current) => ({ ...current,
                                        [home.homeServerIdentityId]: { input: input ?? continuation.input, result } }))}
                                    onBack={() => router.back()} />}
                            </View>;
                        }
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
                        const removeTitle = t('settingsAccount.accountServiceRemoveHome', { accountService: verifiedAccountServiceName });
                        const enrollmentNeedsRetry = pendingForHome?.kind === 'transport_unavailable';
                        const enrollmentCanRestart = Boolean(pendingForHome)
                            || enrollmentNeedsRetry
                            || enrollmentView === 'expired';
                        const enrollTitle = pendingForHome
                            ? t('common.retry')
                            : enrollmentNeedsRetry
                            ? t('settingsAccount.accountServiceRetryHomeConnection')
                            : t('settingsAccount.accountServiceConnectHome');
                        const homeSignedIn = Boolean(profile && authStatusByProfileId[resolveServerProfileScopeId(profile)] === 'signedIn');
                        const actions = [
                            ...(profile && homeSignedIn ? [{
                                id: `${testID}-link`,
                                inlineTestID: `${testID}-link`,
                                title: t('settingsAccount.accountServiceLinkThisHome'),
                                icon: pendingAction === 'link'
                                    ? <ActivitySpinner size="small" />
                                    : 'link' as const,
                                disabled: Boolean(pendingAction) || busy,
                                onPress: () => { void linkHome(profile); },
                            }, {
                                id: `${testID}-unlink`,
                                inlineTestID: `${testID}-unlink`,
                                title: t('settingsAccount.accountServiceUnlinkHome', { accountService: verifiedAccountServiceName }),
                                icon: pendingAction === 'unlink'
                                    ? <ActivitySpinner size="small" />
                                    : 'link-break' as const,
                                disabled: Boolean(pendingAction) || busy,
                                destructive: true,
                                onPress: () => { void unlinkHome(home.homeServerIdentityId, home.label); },
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
                            ...(!durablyEnrolled || enrollmentCanRestart ? [{
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
                        const commonActionId = !durablyEnrolled || enrollmentCanRestart
                            ? `${testID}-enroll`
                            : !preferred
                                ? `${testID}-set-preferred`
                                : homeSignedIn
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
                                subtitle={t('settingsAccount.accountServiceLinkThisHomeDescription', {
                                    accountService: verifiedAccountServiceName,
                                })}
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
