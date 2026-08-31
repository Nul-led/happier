import * as React from 'react';
import { Linking } from 'react-native';
import type { AccountDirectoryCapabilities } from '@happier-dev/protocol';

import { accountDirectoryCredentialStorage, normalizeAccountDirectoryEndpoint } from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import { accountDirectoryAuthClient } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { normalizeSecretKey } from '@/auth/recovery/secretKeyBackup';
import { TokenStorage, type AccountDirectoryCredentialTarget } from '@/auth/storage/tokenStorage';
import { resolvePreferredProvisionProviderId } from '@/components/account/auth/useAuthEntryOptions';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { decodeBase64 } from '@/encryption/base64';
import { Modal } from '@/modal';
import {
    type AccountDirectorySession,
    type AccountDirectorySessionSnapshot,
    createAccountDirectorySession,
    parseAccountDirectoryCapability,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import {
    getAccountServiceEndpointSnapshot,
    getActiveServerSnapshot,
    HAPPIER_CLOUD_SERVER_URL,
    resolveServerProfileForPortableIdentity,
    setAccountServiceEndpoint,
    subscribeAccountServiceEndpoint,
    type AccountServiceEndpointV1,
} from '@/sync/domains/server/serverProfiles';
import {
    enrollPreferredDirectoryHome,
    type PreferredDirectoryHomeEnrollmentResult,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import { provisionAuthenticatedHomeLink } from '@/sync/ops/accountDirectory/provisionAuthenticatedHomeLink';
import { refreshAccountHomeDirectory } from '@/sync/ops/accountDirectory/refreshAccountHomeDirectory';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import { t } from '@/text';

const DEFAULT_ACCOUNT_SERVICE_ENDPOINT: AccountServiceEndpointV1 = {
    url: HAPPIER_CLOUD_SERVER_URL,
    displayName: 'Happier Cloud',
    source: 'default',
};

type DirectoryView = Readonly<{
    session: AccountDirectorySession;
    snapshot: AccountDirectorySessionSnapshot;
}>;

type AccountServiceConnectionView =
    | Readonly<{ kind: 'loading'; serviceKey: string }>
    | Readonly<{ kind: 'connected'; serviceKey: string }>
    | Readonly<{ kind: 'disconnected'; serviceKey: string }>
    | Readonly<{ kind: 'credential_expired'; serviceKey: string }>;

type AccountServiceDirectoryView =
    | Readonly<{ kind: 'idle'; serviceKey: string }>
    | Readonly<{ kind: 'loading'; serviceKey: string; previous: DirectoryView | null }>
    | Readonly<{ kind: 'ready'; serviceKey: string; value: DirectoryView }>
    | Readonly<{ kind: 'unsupported'; serviceKey: string }>
    | Readonly<{ kind: 'unavailable'; serviceKey: string; previous: DirectoryView | null }>;

type RowActionKind = 'set_preferred' | 'remove' | 'enroll';
type EnrollmentView = 'enrolled' | 'approval_required' | 'failed';

function accountServiceKey(endpoint: AccountServiceEndpointV1): string {
    return `${normalizeAccountDirectoryEndpoint(endpoint.url)}\u0000${endpoint.serverIdentityId?.trim() ?? ''}`;
}

function retainedDirectoryValue(view: AccountServiceDirectoryView): DirectoryView | null {
    if (view.kind === 'ready') return view.value;
    if (view.kind === 'loading' || view.kind === 'unavailable') return view.previous;
    return null;
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

async function refreshAndEnrollAccountService(
    target: AccountDirectoryCredentialTarget,
    capability: AccountDirectoryCapabilities,
    homeLinkIntent?: Readonly<{
        homeServerIdentityId: string;
        issuerServerIdentityId: string;
    }>,
): Promise<Readonly<{
    session: AccountDirectorySession;
    snapshot: AccountDirectorySessionSnapshot;
    enrollment: PreferredDirectoryHomeEnrollmentResult | null;
}> | null> {
    const session = createAccountDirectorySession(target, { capability });
    if (homeLinkIntent) {
        const provisionInput = {
            session,
            homeServerIdentityId: homeLinkIntent.homeServerIdentityId,
            issuerServerIdentityId: homeLinkIntent.issuerServerIdentityId,
            capability,
        } as const;
        let provisioned = await provisionAuthenticatedHomeLink(provisionInput);
        if (provisioned.kind === 'relink_required') {
            const confirmed = await Modal.confirm(
                t('settingsAccount.accountServiceRelinkConfirmTitle'),
                t('settingsAccount.accountServiceRelinkConfirmBody'),
                {
                    confirmText: t('common.continue'),
                    cancelText: t('common.cancel'),
                },
            );
            if (!confirmed) return null;
            provisioned = await provisionAuthenticatedHomeLink({ ...provisionInput, relink: true });
        }
        if (provisioned.kind !== 'linked') {
            throw new Error('Authenticated Home relationship provisioning failed');
        }
    }
    const refreshed = await refreshAccountHomeDirectory(session);
    let enrollment: PreferredDirectoryHomeEnrollmentResult | null = null;
    if (refreshed.status === 'ready') {
        enrollment = await enrollPreferredDirectoryHome(session);
    }
    return { session, snapshot: refreshed, enrollment };
}

function projectEnrollment(result: PreferredDirectoryHomeEnrollmentResult | null): EnrollmentView | null {
    if (!result) return null;
    if (result.kind === 'enrolled') return 'enrolled';
    if (result.kind === 'approval_required') return 'approval_required';
    if (result.kind === 'unavailable' && result.reason === 'no_preferred_home') return null;
    return 'failed';
}

async function captureAuthenticatedFocusedHomeIdentity(): Promise<string | null> {
    const active = getActiveServerSnapshot();
    const resolved = resolveServerProfileForPortableIdentity(active.serverId);
    if (resolved.kind !== 'resolved') return null;
    const homeServerIdentityId = resolved.profile.serverIdentityId?.trim() ?? '';
    if (!homeServerIdentityId || homeServerIdentityId !== resolved.serverIdentityId) return null;
    const credentials = await TokenStorage.getCredentialsForServerUrl(
        resolved.profile.serverUrl,
        { serverId: homeServerIdentityId },
    ).catch(() => null);
    return credentials ? homeServerIdentityId : null;
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
    const serviceKey = accountServiceKey(endpoint);
    const [busy, setBusy] = React.useState(false);
    const [connectionView, setConnectionView] = React.useState<AccountServiceConnectionView>({
        kind: 'loading',
        serviceKey,
    });
    const [directoryView, setDirectoryView] = React.useState<AccountServiceDirectoryView>({
        kind: 'idle',
        serviceKey,
    });
    const [pendingRowActions, setPendingRowActions] = React.useState<Readonly<Record<string, RowActionKind>>>({});
    const [enrollmentViews, setEnrollmentViews] = React.useState<Readonly<Record<string, EnrollmentView>>>({});
    const serviceKeyRef = React.useRef(serviceKey);
    serviceKeyRef.current = serviceKey;

    const visibleConnection = connectionView.serviceKey === serviceKey
        ? connectionView
        : { kind: 'loading', serviceKey } as const;
    const visibleDirectory = directoryView.serviceKey === serviceKey
        ? directoryView
        : { kind: 'idle', serviceKey } as const;
    const retainedDirectory = retainedDirectoryValue(visibleDirectory);
    const connected = visibleConnection.kind === 'connected';
    const directoryRefreshing = visibleDirectory.kind === 'loading';

    React.useEffect(() => {
        let cancelled = false;
        const requestedServiceKey = serviceKey;
        setConnectionView({ kind: 'loading', serviceKey: requestedServiceKey });
        setDirectoryView((current) => current.serviceKey === requestedServiceKey
            ? current
            : { kind: 'idle', serviceKey: requestedServiceKey });
        setPendingRowActions({});
        setEnrollmentViews({});
        accountDirectoryCredentialStorage.get({
            endpoint: endpoint.url,
            ...(endpoint.serverIdentityId ? { serverIdentityId: endpoint.serverIdentityId } : {}),
        })
            .then((credentials) => {
                if (cancelled) return;
                setConnectionView({
                    kind: credentials ? 'connected' : 'disconnected',
                    serviceKey: requestedServiceKey,
                });
                if (!credentials) setDirectoryView({ kind: 'idle', serviceKey: requestedServiceKey });
            })
            .catch(() => {
                if (!cancelled) {
                    setConnectionView({ kind: 'disconnected', serviceKey: requestedServiceKey });
                    setDirectoryView({ kind: 'idle', serviceKey: requestedServiceKey });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [endpoint.serverIdentityId, endpoint.url, serviceKey]);

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
        const previous = retainedDirectoryValue(visibleDirectory);
        const requestedServiceKey = serviceKey;
        const homeServerIdentityIdPromise = captureAuthenticatedFocusedHomeIdentity();
        setDirectoryView({ kind: 'loading', serviceKey: requestedServiceKey, previous });
        try {
            const homeServerIdentityId = await homeServerIdentityIdPromise;
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
            if (serviceKeyRef.current !== requestedServiceKey) return;
            if (observed.status !== 'ready') {
                setDirectoryView({ kind: 'unavailable', serviceKey: requestedServiceKey, previous });
                return;
            }
            const capability = parseAccountDirectoryCapability(
                observed.features.capabilities.accountDirectory,
            );
            const endpointServerIdentityId = observed.serverIdentityId?.trim() ?? '';
            if (!endpointServerIdentityId) {
                setDirectoryView({ kind: 'unavailable', serviceKey: requestedServiceKey, previous });
                return;
            }
            if (capability?.homeDirectory !== true) {
                setDirectoryView({ kind: 'unsupported', serviceKey: requestedServiceKey });
                return;
            }
            const observedEndpoint = { ...endpoint, serverIdentityId: endpointServerIdentityId };
            const observedServiceKey = accountServiceKey(observedEndpoint);
            if (observedServiceKey !== requestedServiceKey) {
                setDirectoryView({ kind: 'loading', serviceKey: observedServiceKey, previous: null });
                setConnectionView({ kind: 'loading', serviceKey: observedServiceKey });
                setPendingRowActions({});
                setEnrollmentViews({});
                setAccountServiceEndpoint(observedEndpoint);
            }
            const preferredHomeServerIdentityId = previous?.snapshot.preferredHomeServerIdentityId ?? null;
            if (preferredHomeServerIdentityId) {
                setPendingRowActions((current) => ({ ...current, [preferredHomeServerIdentityId]: 'enroll' }));
            }
            const refreshed = await refreshAndEnrollAccountService({
                endpoint: endpoint.url,
                serverIdentityId: endpointServerIdentityId,
            }, capability, homeServerIdentityId
                ? {
                    homeServerIdentityId,
                    issuerServerIdentityId: endpointServerIdentityId,
                }
                : undefined);
            if (!refreshed) {
                setDirectoryView({ kind: 'unavailable', serviceKey: observedServiceKey, previous: null });
                return;
            }
            if (refreshed.snapshot.status === 'ready') {
                setDirectoryView({ kind: 'ready', serviceKey: observedServiceKey, value: refreshed });
                const enrolledHomeServerIdentityId = refreshed.snapshot.preferredHomeServerIdentityId;
                const enrollment = projectEnrollment(refreshed.enrollment);
                if (enrolledHomeServerIdentityId && enrollment) {
                    setEnrollmentViews((current) => ({ ...current, [enrolledHomeServerIdentityId]: enrollment }));
                }
            } else if (isExpiredCredentialError(refreshed.snapshot.error)) {
                setConnectionView({ kind: 'credential_expired', serviceKey: observedServiceKey });
                setDirectoryView({ kind: 'unavailable', serviceKey: observedServiceKey, previous });
            } else if (refreshed.snapshot.status === 'unsupported') {
                setDirectoryView({ kind: 'unsupported', serviceKey: observedServiceKey });
            } else {
                setDirectoryView({ kind: 'unavailable', serviceKey: observedServiceKey, previous });
            }
        } catch {
            if (serviceKeyRef.current === requestedServiceKey) {
                setDirectoryView({ kind: 'unavailable', serviceKey: requestedServiceKey, previous });
            }
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                for (const [homeServerIdentityId, action] of Object.entries(next)) {
                    if (action === 'enroll') delete next[homeServerIdentityId];
                }
                return next;
            });
        }
    }, [connected, directoryRefreshing, endpoint, serviceKey, visibleDirectory]);

    const loginWithKey = React.useCallback(async () => {
        if (busy) return;
        const homeServerIdentityIdPromise = captureAuthenticatedFocusedHomeIdentity();
        setBusy(true);
        try {
            const homeServerIdentityId = await homeServerIdentityIdPromise;
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
            const capability = parseAccountDirectoryCapability(
                observed.status === 'ready'
                    ? observed.features.capabilities.accountDirectory
                    : null,
            );
            const endpointServerIdentityId = observed.status === 'ready'
                ? observed.serverIdentityId?.trim() ?? ''
                : '';
            if (capability?.homeDirectory !== true || !endpointServerIdentityId) {
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
            setDirectoryView({ kind: 'idle', serviceKey: authenticatedServiceKey });
            setAccountServiceEndpoint(authenticatedEndpoint);
            await accountDirectoryAuthClient.loginWithKey({
                endpointUrl: endpoint.url,
                endpointServerIdentityId,
                secret,
            });
            setConnectionView({ kind: 'connected', serviceKey: authenticatedServiceKey });
            const refreshed = await refreshAndEnrollAccountService({
                endpoint: endpoint.url,
                serverIdentityId: endpointServerIdentityId,
            }, capability, homeServerIdentityId
                ? { homeServerIdentityId, issuerServerIdentityId: endpointServerIdentityId }
                : undefined);
            if (refreshed?.snapshot.status === 'ready') {
                setDirectoryView({ kind: 'ready', serviceKey: authenticatedServiceKey, value: refreshed });
            } else {
                setDirectoryView({ kind: 'unavailable', serviceKey: authenticatedServiceKey, previous: null });
            }
        } catch {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, endpoint]);

    const login = React.useCallback(async () => {
        if (busy) return;
        const homeServerIdentityIdPromise = captureAuthenticatedFocusedHomeIdentity();
        setBusy(true);
        let endpointServerIdentityId = '';
        let pendingMayExist = false;
        try {
            const homeServerIdentityId = await homeServerIdentityIdPromise;
            const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint.url, force: true });
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
            setAccountServiceEndpoint({ ...endpoint, serverIdentityId: endpointServerIdentityId });
            const url = await accountDirectoryAuthClient.startOAuth({
                endpointUrl: endpoint.url,
                endpointServerIdentityId,
                providerId,
                mode: 'keyed',
                returnTo: '/settings/account',
                ...(homeServerIdentityId ? { homeServerIdentityId } : {}),
            });
            pendingMayExist = true;
            if (!isSafeExternalAuthUrl(url)) throw new Error('Invalid Account Service OAuth URL');
            await Linking.openURL(url);
        } catch {
            if (pendingMayExist) {
                await TokenStorage.clearPendingAccountDirectoryAuth({
                    endpoint: endpoint.url,
                    serverIdentityId: endpointServerIdentityId,
                }).catch(() => false);
            }
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setBusy(false);
        }
    }, [busy, endpoint]);

    const disconnect = React.useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const removed = await accountDirectoryCredentialStorage.logout({
                endpoint: endpoint.url,
                ...(endpoint.serverIdentityId ? { serverIdentityId: endpoint.serverIdentityId } : {}),
            });
            if (!removed) {
                await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
                return;
            }
            setConnectionView({ kind: 'disconnected', serviceKey });
            setDirectoryView({ kind: 'idle', serviceKey });
            setPendingRowActions({});
        } finally {
            setBusy(false);
        }
    }, [busy, endpoint.serverIdentityId, endpoint.url, serviceKey]);

    const setPreferredHome = React.useCallback(async (homeServerIdentityId: string) => {
        if (!retainedDirectory || pendingRowActions[homeServerIdentityId]) return;
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'set_preferred' }));
        try {
            await retainedDirectory.session.setPreferredHome(homeServerIdentityId);
            const snapshot = await retainedDirectory.session.refresh();
            const value = { session: retainedDirectory.session, snapshot };
            setDirectoryView(snapshot.status === 'ready'
                ? { kind: 'ready', serviceKey, value }
                : { kind: 'unavailable', serviceKey, previous: retainedDirectory });
        } catch {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [pendingRowActions, retainedDirectory, serviceKey]);

    const removeHome = React.useCallback(async (homeServerIdentityId: string, label: string) => {
        if (!retainedDirectory || pendingRowActions[homeServerIdentityId]) return;
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
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'remove' }));
        try {
            await retainedDirectory.session.deleteHome(homeServerIdentityId);
            const snapshot = await retainedDirectory.session.refresh();
            const value = { session: retainedDirectory.session, snapshot };
            setDirectoryView(snapshot.status === 'ready'
                ? { kind: 'ready', serviceKey, value }
                : { kind: 'unavailable', serviceKey, previous: retainedDirectory });
        } catch {
            await Modal.alertAsync(t('common.error'), t('errors.operationFailed'));
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [pendingRowActions, retainedDirectory, serviceKey]);

    const enrollHome = React.useCallback(async (homeServerIdentityId: string) => {
        if (!retainedDirectory || pendingRowActions[homeServerIdentityId]) return;
        setPendingRowActions((current) => ({ ...current, [homeServerIdentityId]: 'enroll' }));
        try {
            const result = await enrollPreferredDirectoryHome(retainedDirectory.session);
            const enrollment = projectEnrollment(result);
            if (enrollment) {
                setEnrollmentViews((current) => ({ ...current, [homeServerIdentityId]: enrollment }));
            }
        } finally {
            setPendingRowActions((current) => {
                const next = { ...current };
                delete next[homeServerIdentityId];
                return next;
            });
        }
    }, [pendingRowActions, retainedDirectory]);

    const statusDetail = visibleConnection.kind === 'loading'
        ? t('settingsAccount.accountServiceCheckingConnection')
        : visibleConnection.kind === 'connected'
            ? t('settingsAccount.statusActive')
            : visibleConnection.kind === 'credential_expired'
                ? t('settingsAccount.accountServiceReconnectRequired')
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
        : visibleDirectory.kind === 'loading' && !retainedDirectory
            ? (
                <Item
                    testID="settings-account-service-directory-loading"
                    mode="info"
                    title={t('settingsAccount.accountServiceDiscoveringHomes')}
                    loading
                    showChevron={false}
                />
            )
            : visibleDirectory.kind === 'unsupported'
                ? (
                    <Item
                        testID="settings-account-service-directory-unsupported"
                        mode="info"
                        title={t('settingsAccount.accountServiceDiscoveryUnsupported')}
                        subtitle={t('settingsAccount.accountServiceDiscoveryUnsupportedDescription')}
                        showChevron={false}
                    />
                )
                : visibleDirectory.kind === 'unavailable'
                    ? (
                        <Item
                            testID="settings-account-service-directory-unavailable"
                            mode="info"
                            title={t('settingsAccount.accountServiceDiscoveryUnavailable')}
                            subtitle={t('settingsAccount.accountServiceDiscoveryUnavailableDescription')}
                            showChevron={false}
                        />
                    )
                    : visibleDirectory.kind === 'ready' && visibleDirectory.value.snapshot.homes.length === 0
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
            <ItemGroup title={endpoint.displayName ?? endpoint.url}>
                <Item
                    testID="settings-account-service-select"
                    title={t('settingsAccount.server')}
                    subtitle={endpoint.url}
                    subtitleLines={1}
                    subtitleEllipsizeMode="middle"
                    onPress={selectEndpoint}
                    disabled={busy}
                />
                <Item
                    testID="settings-account-service-status"
                    title={t('settingsAccount.status')}
                    detail={statusDetail}
                    accessibilityLiveRegion="polite"
                    showChevron={false}
                />
                {connected ? (
                    <>
                        <Item
                            testID="settings-account-service-refresh"
                            title={t('common.refresh')}
                            subtitle={t('settingsAccount.accountServiceDiscoveryDescription')}
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
                ) : canAuthenticate ? (
                    <>
                        <Item
                            testID="settings-account-service-login"
                            title={t('common.login')}
                            onPress={login}
                            disabled={busy}
                            loading={busy}
                            showChevron={false}
                        />
                        <Item
                            testID="settings-account-service-key-login"
                            title={t('navigation.restoreWithSecretKey')}
                            onPress={loginWithKey}
                            disabled={busy}
                            showChevron={false}
                        />
                    </>
                ) : null}
            </ItemGroup>
            {(directoryNotice || retainedDirectory) ? (
                <ItemGroup
                    title={t('settingsAccount.accountServiceHomes')}
                    footer={t('settingsAccount.accountServiceDiscoveryDescription')}
                >
                    {directoryNotice}
                    {retainedDirectory?.snapshot.homes.map((home) => {
                        const preferred = retainedDirectory.snapshot.preferredHomeServerIdentityId === home.homeServerIdentityId;
                        const testID = `settings-account-service-home-${home.homeServerIdentityId}`;
                        const pendingAction = pendingRowActions[home.homeServerIdentityId];
                        const enrollmentView = enrollmentViews[home.homeServerIdentityId];
                        const setPreferredTitle = t('settingsAccount.accountServiceSetPreferredHome');
                        const removeTitle = t('settingsAccount.accountServiceRemoveHome');
                        const enrollTitle = enrollmentView === 'failed'
                            ? t('settingsAccount.accountServiceRetryHomeConnection')
                            : t('settingsAccount.accountServiceConnectHome');
                        const actions = [
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
                            ...(preferred && enrollmentView !== 'enrolled' ? [{
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
                                subtitle={home.canonicalServerUrl}
                                subtitleLines={1}
                                subtitleEllipsizeMode="middle"
                                detail={statusLabel || undefined}
                                detailTestID={preferred ? `${testID}-preferred` : undefined}
                                accessibilityLabel={statusLabel ? `${home.label}, ${statusLabel}` : home.label}
                                mode="info"
                                rightElement={(
                                    <ItemRowActions
                                        title={home.label}
                                        actions={actions}
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
