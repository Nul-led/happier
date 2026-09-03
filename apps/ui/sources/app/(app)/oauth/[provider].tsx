import React from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import {
    useAuth,
    type AuthCredentialLifecycleResult,
} from '@/auth/context/AuthContext';
import { Modal } from '@/modal';
import { HappyError } from '@/utils/errors/errors';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { t } from '@/text';
import {
    AccountDirectoryStorageReadError,
    TokenStorage,
    normalizeAccountDirectoryEndpoint,
    type PendingAccountDirectoryAuth,
} from '@/auth/storage/tokenStorage';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { authChallenge } from '@/auth/flows/challenge';
import {
    createServerFetchAtEndpoint,
    serverFetch,
} from '@/sync/http/client';
import { isSessionSharingSupported } from '@/sync/api/capabilities/sessionSharingSupport';
import { getAuthProvider } from '@/auth/providers/registry';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { accountDirectoryAuthClient } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { buildContentKeyBinding } from '@/auth/oauth/contentKeyBinding';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { resolveRoutineServerSelectionScope } from '@/sync/domains/server/selection/serverSelectionScope';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { Text, TextInput } from '@/components/ui/text/Text';
import { getRandomBytes } from '@/platform/cryptoRandom';
import { trackAccountCreated, trackAccountRestored } from '@/track';

import { WizardModalShell } from '@/components/onboarding/ui/WizardModalShell';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { normalizeInternalReturnPath } from '@/utils/path/routeUtils';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import {
    createAccountDirectoryServiceKey,
    createAccountDirectorySession,
    parseAccountDirectoryCapability,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import { refreshAccountHomeDirectory } from '@/sync/ops/accountDirectory/refreshAccountHomeDirectory';
import {
    cancelPendingPreferredHomeEnrollment,
    enrollPreferredDirectoryHome,
    finalizePreferredHomeEnrollmentEntryIntent,
} from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import { provisionAuthenticatedHomeLink } from '@/sync/ops/accountDirectory/provisionAuthenticatedHomeLink';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import {
    getAccountServiceEndpointSnapshot,
    resolveServerProfileScopeId,
    resolveServerProfileForPortableIdentity,
} from '@/sync/domains/server/serverProfiles';
import {
    guardAccountEncryptionFirstKeyCredentialMutation,
    resumeAccountEncryptionFirstKeyExternalAuth,
} from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';
import {
    presentFirstKeyCredentialLifecycle,
} from '@/components/account/presentFirstKeyCredentialLifecycle';
import {
    AccountServiceOAuthJourney,
    type AccountServiceOAuthFailure,
    type AccountServiceOAuthJourneyState,
    type AccountServiceOAuthStage,
    type AccountServiceApprovalOutcome,
} from '@/components/account/auth/AccountServiceOAuthJourney';

const ACCOUNT_ENCRYPTION_FIRST_KEY_PURPOSE =
    'account_encryption_first_key';
const ACCOUNT_DIRECTORY_PURPOSE = 'account_directory';

type AccountDirectoryOAuthReturnInput = Readonly<{
    providerId: string;
    purpose: string | null;
    credentialTarget: string | null;
    endpointUrl: string | null;
    serverIdentityId: string | null;
    canonicalServerUrl: string | null;
    pendingKey: string;
    mode: string | null;
    pending: PendingAccountDirectoryAuth | null;
    signal?: AbortSignal;
    onStage?: (stage: AccountServiceOAuthStage) => void;
    onCredentialCommitStarted?: () => void;
}>;

type AccountDirectoryOAuthReturnResult = Readonly<{
    ok: boolean;
    returnTo: string;
    error?: string;
    preservePending?: boolean;
    signedIn?: boolean;
    /**
     * The Home requires an approval decision and this requester holds only the restricted Account
     * Service credential, so the entry journey keeps waiting here instead of routing to
     * authenticated Home settings.
     */
    awaitingApproval?: true;
    /** The authenticated Settings caller can continue in the existing Home approval surface. */
    continueApprovalInSettings?: true;
}>;

function normalizeAccountDirectoryIdentityParam(value: string | null): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

/**
 * Complete a Directory OAuth continuation against the endpoint captured in
 * the dedicated pending record.  This helper deliberately has no AuthContext,
 * active-server, or focus dependencies.
 */
async function finalizeAccountDirectoryOAuthReturn(
    input: AccountDirectoryOAuthReturnInput,
): Promise<AccountDirectoryOAuthReturnResult> {
    const cancelled = (): AccountDirectoryOAuthReturnResult => ({
        ok: false,
        returnTo: '/settings/account',
        error: 'cancelled',
        preservePending: true,
    });
    const pending = input.pending;
    const endpoint = normalizeAccountDirectoryEndpoint(input.endpointUrl ?? '');
    const callbackIdentity = normalizeAccountDirectoryIdentityParam(input.serverIdentityId);
    const pendingEndpoint = pending
        ? normalizeAccountDirectoryEndpoint(pending.endpoint)
        : null;
    const pendingIdentity = pending
        ? normalizeAccountDirectoryIdentityParam(pending.serverIdentityId ?? null)
        : null;
    const callbackCanonicalServerUrl = normalizeAccountDirectoryEndpoint(input.canonicalServerUrl ?? '');
    const pendingCanonicalServerUrl = pending
        ? normalizeAccountDirectoryEndpoint(pending.canonicalServerUrl)
        : null;
    const callbackPendingKey = input.pendingKey.trim();
    const persistedPendingKey = pending?.pending?.trim() ?? '';
    const returnTo = normalizeInternalReturnPath(pending?.returnTo) ?? '/settings/account';
    const callbackServiceKey = endpoint && callbackIdentity
        ? createAccountDirectoryServiceKey({ endpoint, serverIdentityId: callbackIdentity })
        : null;
    const isSelectedService = () => {
        const selected = getAccountServiceEndpointSnapshot();
        return Boolean(
            callbackServiceKey
            && selected
            && createAccountDirectoryServiceKey({
                endpoint: selected.url,
                serverIdentityId: selected.serverIdentityId,
            }) === callbackServiceKey
        );
    };
    const isCancelled = () => input.signal?.aborted === true || !isSelectedService();

    // Purpose, endpoint, identity, provider, and pending handle are all bound
    // to the server-created continuation.  Any mismatch is rejected before a
    // request or credential write can occur.
    if (
        input.purpose !== ACCOUNT_DIRECTORY_PURPOSE
        || input.credentialTarget !== ACCOUNT_DIRECTORY_PURPOSE
        || !endpoint
        || !pending
        || !pendingEndpoint
        || pendingEndpoint !== endpoint
        || !pendingIdentity
        || !callbackIdentity
        || pendingIdentity !== callbackIdentity
        || !callbackCanonicalServerUrl
        || !pendingCanonicalServerUrl
        || pendingCanonicalServerUrl !== callbackCanonicalServerUrl
        || pending.provider.trim().toLowerCase() !== input.providerId
        || pending.purpose !== ACCOUNT_DIRECTORY_PURPOSE
        || (pending.entryIntent !== 'enter_preferred_home' && pending.entryIntent !== 'connect_service')
        || (input.mode !== 'keyed' && input.mode !== 'keyless')
        || pending.mode !== input.mode
        || !callbackPendingKey
        || (
            persistedPendingKey.length > 0
            && persistedPendingKey !== callbackPendingKey
        )
        || !isSelectedService()
    ) {
        return { ok: false, returnTo, error: 'invalid-pending' };
    }
    if (Date.now() >= pending.expiresAt) {
        return { ok: false, returnTo, error: 'request-expired' };
    }
    if (isCancelled()) return cancelled();

    // The callback can outlive endpoint reconfiguration. Re-probe the exact URL
    // before exchanging or persisting authority and require the same stable
    // Account Service identity captured by the pending continuation.
    let observedCapability: ReturnType<typeof parseAccountDirectoryCapability> = null;
    input.onStage?.('verifying_service');
    try {
        const observed = await probeServerFeaturesAtUrl({ endpointUrl: endpoint, force: true });
        const observedIdentity = observed.status === 'ready'
            ? normalizeAccountDirectoryIdentityParam(observed.serverIdentityId ?? null)
            : null;
        if (observed.status !== 'ready') {
            return { ok: false, returnTo, error: 'service-unavailable', preservePending: true };
        }
        const observedCanonicalServerUrl = normalizeAccountDirectoryEndpoint(
            observed.features.capabilities.server.canonicalServerUrl ?? '',
        );
        if (observedIdentity !== callbackIdentity) {
            return { ok: false, returnTo, error: 'identity-changed', preservePending: true };
        }
        if (observedCanonicalServerUrl !== callbackCanonicalServerUrl) {
            return { ok: false, returnTo, error: 'canonical-url-changed', preservePending: true };
        }
        observedCapability = parseAccountDirectoryCapability(
            observed.features.capabilities.accountDirectory,
        );
    } catch {
        return { ok: false, returnTo, error: 'service-unavailable', preservePending: true };
    }
    if (isCancelled()) return cancelled();

    const mode = pending.mode;
    const fetchAtEndpoint = createServerFetchAtEndpoint({
        endpointUrl: endpoint,
        ...(callbackIdentity ? { serverId: callbackIdentity } : {}),
        credentials: null,
    });

    let payload: Record<string, string>;
    let path: string;
    if (mode === 'keyless') {
        if (!pending.proof) {
            return { ok: false, returnTo, error: 'invalid-pending' };
        }
        path = `/v1/auth/external/${encodeURIComponent(input.providerId)}/finalize-keyless`;
        payload = {
            pending: callbackPendingKey,
            proof: pending.proof,
        };
    } else {
        if (!pending.secret) {
            return { ok: false, returnTo, error: 'invalid-pending' };
        }
        let secretBytes: Uint8Array;
        try {
            secretBytes = decodeBase64(pending.secret, 'base64url');
        } catch {
            return { ok: false, returnTo, error: 'invalid-pending' };
        }
        const { challenge, signature, publicKey } = authChallenge(secretBytes);
        path = `/v1/auth/external/${encodeURIComponent(input.providerId)}/finalize`;
        payload = {
            pending: callbackPendingKey,
            publicKey: encodeBase64(publicKey),
            challenge: encodeBase64(challenge),
            signature: encodeBase64(signature),
            ...(pending.proof ? { proof: pending.proof } : {}),
        };
    }

    let response: Response;
    input.onStage?.('signing_in');
    try {
        response = await fetchAtEndpoint(
            path,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: input.signal,
            },
            { includeAuth: false, retry: 'none' },
        );
    } catch {
        return { ok: false, returnTo, error: 'token-exchange-failed' };
    }
    if (isCancelled()) return cancelled();
    const json = await response.json().catch(() => ({}));
    if (isCancelled()) return cancelled();
    const token =
        json
        && typeof json === 'object'
        && !Array.isArray(json)
        && typeof (json as { token?: unknown }).token === 'string'
            ? (json as { token: string }).token.trim()
            : '';
    if (!response.ok || !token) {
        const serverError =
            json
            && typeof json === 'object'
            && !Array.isArray(json)
            && typeof (json as { error?: unknown }).error === 'string'
                ? (json as { error: string }).error
                : 'token-exchange-failed';
        return { ok: false, returnTo, error: serverError };
    }

    const target = {
        endpoint,
        serverIdentityId: callbackIdentity,
    };
    if (isCancelled()) return cancelled();
    input.onCredentialCommitStarted?.();
    input.onStage?.('saving_credentials');
    const stored = await TokenStorage.accountDirectoryAuthCredentials
        .set(target, { token });
    if (!stored) {
        return { ok: false, returnTo, error: 'credential-storage-failed' };
    }
    if (isCancelled()) return { ...cancelled(), signedIn: true };
    await TokenStorage.clearPendingAccountDirectoryAuth(target);
    // Credential persistence is the commit boundary. A failed best-effort
    // cleanup must not misreport that successful sign-in as unsaved; the
    // short-lived continuation remains unusable server-side and expires.
    input.onStage?.('signed_in');
    if (isCancelled()) return { ...cancelled(), signedIn: true };

    // This callback is the production composition root for Account Service
    // discovery. A captured Home must be linked before the continuation is
    // accepted; later refresh/enrollment remains retryable from settings and
    // never invalidates the stored Directory credential or an existing Home.
    if (observedCapability?.homeDirectory !== true) {
        input.onStage?.('account_service_connected');
        return { ok: true, returnTo, signedIn: true };
    }
    const session = createAccountDirectorySession(target, { capability: observedCapability });
    if (pending.homeServerIdentityId) {
        input.onStage?.('connecting_home');
        try {
            const provisioned = await provisionAuthenticatedHomeLink({
                session,
                homeServerIdentityId: pending.homeServerIdentityId,
                issuerServerIdentityId: callbackIdentity,
                capability: observedCapability,
                shouldCancel: isCancelled,
            });
            if (isCancelled()) return { ...cancelled(), signedIn: true };
            if (provisioned.kind !== 'linked') {
                return { ok: false, returnTo, error: 'home-link-provisioning-failed', signedIn: true };
            }
        } catch {
            if (isCancelled()) return { ...cancelled(), signedIn: true };
            return { ok: false, returnTo, error: 'home-link-provisioning-failed', signedIn: true };
        }
    }

    input.onStage?.('finding_homes');
    try {
        const refreshed = await refreshAccountHomeDirectory(session, { shouldCancel: isCancelled });
        if (isCancelled()) return { ...cancelled(), signedIn: true };
        if (refreshed.status !== 'ready') {
            return { ok: false, returnTo, error: 'directory-refresh-failed', signedIn: true };
        }
    } catch {
        if (isCancelled()) return { ...cancelled(), signedIn: true };
        return { ok: false, returnTo, error: 'directory-refresh-failed', signedIn: true };
    }
    if (isCancelled()) return { ...cancelled(), signedIn: true };
    if (observedCapability.homeEnrollment !== true) {
        input.onStage?.('account_service_connected');
        return { ok: true, returnTo, signedIn: true };
    }

    input.onStage?.('connecting_home');
    let enrollment: Awaited<ReturnType<typeof enrollPreferredDirectoryHome>>;
    try {
        enrollment = await enrollPreferredDirectoryHome(session, {
            entryIntent: pending.entryIntent,
            shouldCancel: isCancelled,
            // Normal callback unmount/abort must preserve a Home-owned pending
            // approval. Replacing the selected Account Service must not.
            shouldInvalidateContinuation: () => !isSelectedService(),
        });
    } catch {
        if (isCancelled()) return { ...cancelled(), signedIn: true };
        return { ok: false, returnTo, error: 'home-enrollment-failed', signedIn: true };
    }
    if (enrollment.kind === 'approval_required') {
        // The enrollment owner has already published a detached continuation.
        // Normal callback unmount/abort must not discard it. A real Account
        // Service change explicitly cancels the detached continuation.
        if (!isSelectedService()) {
            await cancelPendingPreferredHomeEnrollment(enrollment);
            return { ...cancelled(), signedIn: true };
        }
        input.onStage?.('waiting_approval');
        // An authenticated Settings requester continues in the Home approval surface it can
        // already reach. An unauthenticated entry requester has no Home credential yet, so it
        // waits and resumes here.
        return pending.entryIntent === 'enter_preferred_home'
            ? { ok: true, returnTo, signedIn: true, awaitingApproval: true }
            : {
                ok: true,
                returnTo: '/settings/server',
                signedIn: true,
                continueApprovalInSettings: true,
            };
    }
    if (enrollment.kind === 'enrolled') {
        // Credential adoption has already completed for the immutable Home, but a superseded
        // Account Service no longer owns the entry journey. Focus authority for the semantic
        // intent belongs to the enrollment owner (which rechecks the bound service for the
        // approval-resume path too); this attempt still stops reporting/navigating for a service
        // it no longer represents.
        if (!isSelectedService()) return { ...cancelled(), signedIn: true };
        const applied = await finalizePreferredHomeEnrollmentEntryIntent(
            enrollment.homeServerIdentityId,
            pending.entryIntent,
            callbackServiceKey ?? '',
        );
        if (applied === 'superseded') return { ...cancelled(), signedIn: true };
        if (applied === 'blocked') {
            return { ok: false, returnTo, error: 'home-enrollment-failed', signedIn: true };
        }
        input.onStage?.('home_added');
        return { ok: true, returnTo, signedIn: true };
    }
    if (enrollment.kind === 'partial_commit') {
        return { ok: false, returnTo, error: 'home-enrollment-failed', signedIn: true };
    }
    if (isCancelled()) return { ...cancelled(), signedIn: true };
    if (
        enrollment.kind === 'unavailable'
        && enrollment.reason === 'no_preferred_home'
    ) {
        input.onStage?.('account_service_connected');
        return { ok: true, returnTo, signedIn: true };
    }
    return { ok: false, returnTo, error: 'home-enrollment-failed', signedIn: true };
}

async function guardOrdinaryAuthIngress(
): Promise<AuthCredentialLifecycleResult> {
    const result =
        await guardAccountEncryptionFirstKeyCredentialMutation();
    return result.kind === 'allowed'
        ? { kind: 'completed' }
        : result;
}

function paramString(params: Record<string, unknown>, key: string): string | null {
    const value = (params as any)[key];
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
    if (typeof value === 'string') return value;

    // Cold-start/hydration on web can temporarily omit search params from expo-router's
    // useLocalSearchParams, even though the URL already contains them. Fall back to
    // window.location.search so the OAuth return page can still finalize.
    try {
        const search = (globalThis as any)?.window?.location?.search;
        if (typeof search !== 'string' || !search) return null;
        const parsed = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
        const fromSearch = parsed.get(key);
        return typeof fromSearch === 'string' ? fromSearch : null;
    } catch {
        return null;
    }
}

function mapUsernameErrorToMessage(code: string): string {
    switch (code) {
        case 'username-taken':
            return t('friends.username.taken');
        case 'invalid-username':
        case 'username-required':
            return t('friends.username.invalid');
        case 'username-disabled':
            return t('friends.username.disabled');
        case 'friends-disabled':
            return t('friends.disabled');
        default:
            return t('errors.tokenExchangeFailed');
    }
}

function mapFinalizeErrorToMessage(code: string): string {
    switch (code) {
        case 'username-taken':
        case 'invalid-username':
        case 'username-required':
        case 'username-disabled':
        case 'friends-disabled':
            return mapUsernameErrorToMessage(code);
        case 'invalid-pending':
            return t('errors.oauthStateMismatch');
        case 'home-link-provisioning-failed':
            return t('errors.operationFailed');
        default:
            return t('errors.tokenExchangeFailed');
    }
}

function mapAccountDirectoryFailure(code: string): AccountServiceOAuthFailure {
    switch (code) {
        case 'request-expired': return 'request_expired';
        case 'identity-changed': return 'identity_changed';
        case 'service-unavailable': return 'service_unavailable';
        case 'credential-storage-failed': return 'credential_storage_failed';
        case 'home-link-provisioning-failed': return 'home_link_failed';
        case 'directory-refresh-failed': return 'directory_refresh_failed';
        case 'home-enrollment-failed': return 'home_enrollment_failed';
        case 'invalid-pending': return 'invalid_request';
        default: return 'token_exchange_failed';
    }
}

function trackSuccessfulOAuthAuth(params: {
    secret: string | null;
    intent: 'signup' | 'reset' | null;
}) {
    if (params.intent === 'reset') {
        trackAccountRestored();
        return;
    }
    if (params.intent === 'signup' || params.secret) {
        trackAccountCreated();
        return;
    }
    trackAccountRestored();
}

function tryResolveProviderIdFromWebPathname(): string | null {
    try {
        const pathname = (globalThis as any)?.window?.location?.pathname;
        if (typeof pathname !== 'string' || !pathname.trim()) return null;
        const match = pathname.match(/\/oauth\/([^/?#]+)/i);
        const provider = match?.[1]?.toString?.().trim?.().toLowerCase?.() ?? '';
        return provider || null;
    } catch {
        return null;
    }
}

function buildRestoreRedirectUrl(params: { providerId: string; reason: 'provider_already_linked' }): string {
    const provider = encodeURIComponent(params.providerId);
    const reason = encodeURIComponent(params.reason);
    return `/restore?provider=${provider}&reason=${reason}`;
}

function normalizeComparableServerUrl(value: unknown): string {
    if (typeof value !== 'string') return '';
    return createServerUrlComparableKey(value);
}

function resolveProvisioningModes(raw: string | null): Readonly<{ allowPlain: boolean; allowE2ee: boolean }> {
    if (raw == null) {
        // Back-compat: older servers don't include provisioningModes, so assume both options.
        return { allowPlain: true, allowE2ee: true };
    }

    const modes = raw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    const set = new Set(modes);

    return { allowPlain: set.has('plain'), allowE2ee: set.has('e2ee') };
}

async function maybeActivateServerTarget(
    rawServerUrl: unknown,
    rawServerIdentityId: unknown,
    refreshAuth: () => Promise<void>,
): Promise<void> {
    const serverUrl = typeof rawServerUrl === 'string' ? rawServerUrl.trim() : '';
    const serverIdentityId = typeof rawServerIdentityId === 'string'
        ? rawServerIdentityId.trim()
        : '';
    if (!serverUrl || !serverIdentityId) return;

    const active = getActiveServerSnapshot();
    if (
        active.serverId === serverIdentityId
        && normalizeComparableServerUrl(active.serverUrl) === normalizeComparableServerUrl(serverUrl)
    ) return;

    const resolved = resolveServerProfileForPortableIdentity(serverIdentityId);
    if (
        resolved.kind !== 'resolved'
        || normalizeComparableServerUrl(resolved.profile.canonicalServerUrl ?? resolved.profile.serverUrl)
            !== normalizeComparableServerUrl(serverUrl)
    ) return;
    await setActiveServerAndSwitch({
        serverId: resolveServerProfileScopeId(resolved.profile),
        scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
        refreshAuth,
    });
}

export default function OAuthProviderReturn() {
    const router = useRouter();
    const params = useLocalSearchParams() as any;
    const auth = useAuth();
    const { theme } = useUnistyles();

    const [busy, setBusy] = React.useState(false);
    const [usernameHint, setUsernameHint] = React.useState<string | null>(null);
    const [usernameValue, setUsernameValue] = React.useState<string>('');
    const [provisioningChoiceOpen, setProvisioningChoiceOpen] = React.useState(false);
    const [accountDirectoryJourney, setAccountDirectoryJourney] =
        React.useState<AccountServiceOAuthJourneyState | null>(null);
    const [accountDirectoryCompletionReturnTo, setAccountDirectoryCompletionReturnTo] =
        React.useState<string | null>(null);
    const [accountDirectoryApprovalReturnTo, setAccountDirectoryApprovalReturnTo] =
        React.useState<string | null>(null);
    const [persistedAccountDirectoryReturn, setPersistedAccountDirectoryReturn] =
        React.useState(false);
    const accountDirectoryAttemptRef = React.useRef<null | Readonly<{
        controller: AbortController;
        target: Readonly<{ endpoint: string; serverIdentityId: string }> | null;
        returnTo: string;
    }>>(null);
    const accountDirectoryCredentialCommitStartedRef = React.useRef(false);
    const pendingAuthContextRef = React.useRef<null | Readonly<{
        providerId: string;
        providerName: string;
        pending: string;
        proof: string | null;
        secret: string | null;
        intent: 'signup' | 'reset' | null;
        returnTo: string;
        serverUrl?: string;
        serverId?: string;
        storagePolicy: string | null;
        provisioning: string | null;
        provisioningModes: string | null;
        accountMode: string | null;
        username: string | null;
        chosenMode: 'plain' | 'e2ee' | null;
    }>>(null);

    const resolvedProviderId =
        ((paramString(params, 'provider') ?? '').trim().toLowerCase()
            || tryResolveProviderIdFromWebPathname()
            || '').trim().toLowerCase();
    const resolvedFlow = paramString(params, 'flow');
    const resolvedStatus = paramString(params, 'status');
    const resolvedError = paramString(params, 'error');
    const resolvedPending = paramString(params, 'pending') ?? '';
    const resolvedLogin = paramString(params, 'login') ?? '';
    const resolvedReason = paramString(params, 'reason');
    const resolvedMode = paramString(params, 'mode');
    const resolvedStoragePolicy = paramString(params, 'storagePolicy');
    const resolvedProvisioning = paramString(params, 'provisioning');
    const resolvedProvisioningModes = paramString(params, 'provisioningModes');
    const resolvedAccountMode = paramString(params, 'accountMode');
    const resolvedPurpose = paramString(params, 'purpose');
    const resolvedCredentialTarget = paramString(params, 'credentialTarget');
    const resolvedEndpointUrl =
        paramString(params, 'endpointUrl')
        ?? paramString(params, 'endpoint');
    const resolvedEndpointIdentity =
        paramString(params, 'endpointServerIdentityId')
        ?? paramString(params, 'serverIdentityId')
        ?? paramString(params, 'serverId');
    const resolvedCanonicalServerUrl = paramString(params, 'canonicalServerUrl');
    const resolvedDirectoryReturn =
        resolvedPurpose === ACCOUNT_DIRECTORY_PURPOSE
        || resolvedCredentialTarget === ACCOUNT_DIRECTORY_PURPOSE;

    const finalizeAuth = React.useCallback((params: { mode: 'plain' | 'e2ee' }) => {
        const ctx = pendingAuthContextRef.current;
        if (!ctx) {
            router.replace('/');
            return Promise.resolve();
        }

        const promise = (async () => {
            setBusy(true);
            try {
                if (params.mode === 'plain' && !ctx.proof) {
                    await Modal.alert(t('common.error'), t('errors.oauthInitializationFailed'));
                    await TokenStorage.clearPendingExternalAuth();
                    pendingAuthContextRef.current = null;
                    router.replace('/');
                    return;
                }

                let secret = ctx.secret;
                if (params.mode === 'e2ee' && !secret) {
                    const seed = getRandomBytes(32);
                    secret = encodeBase64(seed, 'base64url');
                    const stored =
                        await TokenStorage.setPendingExternalAuth({
                            provider: ctx.providerId,
                            ...(ctx.proof ? { proof: ctx.proof } : {}),
                            secret,
                            ...(ctx.intent ? { intent: ctx.intent } : {}),
                            ...(ctx.serverUrl ? { serverUrl: ctx.serverUrl } : {}),
                            ...(ctx.serverId ? { serverId: ctx.serverId } : {}),
                            ...(ctx.returnTo ? { returnTo: ctx.returnTo } : {}),
                        }, ctx.serverUrl ? {
                            serverUrl: ctx.serverUrl,
                            ...(ctx.serverId ? { serverId: ctx.serverId } : {}),
                        } : undefined);
                    if (!stored) {
                        const guard =
                            await guardAccountEncryptionFirstKeyCredentialMutation();
                        if (guard.kind !== 'allowed') {
                            await presentFirstKeyCredentialLifecycle({
                                run: guardOrdinaryAuthIngress,
                            });
                        } else {
                            await Modal.alert(
                                t('common.error'),
                                t('errors.oauthInitializationFailed'),
                            );
                        }
                        return;
                    }
                    pendingAuthContextRef.current = { ...ctx, secret };
                }

                const base = typeof ctx.serverUrl === 'string' ? ctx.serverUrl.trim().replace(/\/+$/, '') : '';
                const finalizePath =
                    params.mode === 'plain'
                        ? `/v1/auth/external/${encodeURIComponent(ctx.providerId)}/finalize-keyless`
                        : `/v1/auth/external/${encodeURIComponent(ctx.providerId)}/finalize`;
                const request = base
                    ? createServerFetchAtEndpoint({
                        endpointUrl: base,
                        ...(ctx.serverId ? { serverId: ctx.serverId } : {}),
                    })
                    : serverFetch;

                const payload: any =
                    params.mode === 'plain'
                        ? {
                            pending: ctx.pending,
                            proof: ctx.proof,
                            ...(ctx.username ? { username: ctx.username } : {}),
                        }
                        : (() => {
                            const secretBytes = decodeBase64(secret!, 'base64url');
                            const { challenge, signature, publicKey } = authChallenge(secretBytes);
                            const keyedBody: any = {
                                pending: ctx.pending,
                                publicKey: encodeBase64(publicKey),
                                challenge: encodeBase64(challenge),
                                signature: encodeBase64(signature),
                                ...(ctx.proof ? { proof: ctx.proof } : {}),
                                ...(ctx.username ? { username: ctx.username } : {}),
                            };
                            if (ctx.intent === 'reset') {
                                keyedBody.reset = true;
                            }
                            return keyedBody;
                        })();

                if (params.mode === 'e2ee') {
                    const secretBytes = decodeBase64(secret!, 'base64url');
                    const supportsSharing = await isSessionSharingSupported({
                        timeoutMs: 800,
                        ...(ctx.serverId ? { serverId: ctx.serverId } : {}),
                    });
                    if (supportsSharing) {
                        const binding = await buildContentKeyBinding(secretBytes);
                        payload.contentPublicKey = binding.contentPublicKey;
                        payload.contentPublicKeySig = binding.contentPublicKeySig;
                    }
                }

                const response = await request(finalizePath, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }, { includeAuth: false, retry: 'none' });
                const json = await response.json().catch(() => ({}));

                if (response.ok && json?.token) {
                    const persistenceOptions = base ? {
                        target: {
                            serverUrl: base,
                            ...(ctx.serverId ? { serverId: ctx.serverId } : {}),
                        },
                    } as const : null;
                    await presentFirstKeyCredentialLifecycle({
                        run: async () =>
                            params.mode === 'plain'
                                ? persistenceOptions
                                    ? await auth.loginWithCredentials(
                                        { token: String(json.token) },
                                        persistenceOptions,
                                    )
                                    : await auth.loginWithCredentials({ token: String(json.token) })
                                : persistenceOptions
                                    ? await auth.login(String(json.token), secret!, persistenceOptions)
                                    : await auth.login(String(json.token), secret!),
                        onCompleted: async () => {
                            await TokenStorage.clearPendingExternalAuth();
                            pendingAuthContextRef.current = null;
                            setUsernameHint(null);
                            setProvisioningChoiceOpen(false);
                            await maybeActivateServerTarget(
                                ctx.serverUrl,
                                ctx.serverId,
                                auth.refreshFromActiveServer,
                            );
                            trackSuccessfulOAuthAuth({
                                secret,
                                intent: ctx.intent,
                            });
                            router.replace(ctx.returnTo);
                        },
                    });
                    return;
                }

                const err = typeof json?.error === 'string' ? json.error : 'token-exchange-failed';
                if (err === 'provider-already-linked') {
                    await TokenStorage.clearPendingExternalAuth();
                    pendingAuthContextRef.current = null;
                    router.replace(buildRestoreRedirectUrl({ providerId: ctx.providerId, reason: 'provider_already_linked' }));
                    return;
                }
                if (err === 'restore-required') {
                    await TokenStorage.clearPendingExternalAuth();
                    pendingAuthContextRef.current = null;
                    router.replace('/restore');
                    return;
                }
                if (err === 'username-required' || err === 'username-taken') {
                    const initialHint = err === 'username-taken' ? t('friends.username.taken') : t('friends.username.invalid');
                    setUsernameHint(initialHint);
                    return;
                }
                if (err === 'invalid-pending') {
                    await Modal.alert(t('common.error'), t('errors.oauthStateMismatch'));
                    await TokenStorage.clearPendingExternalAuth();
                    pendingAuthContextRef.current = null;
                    router.replace('/');
                    return;
                }

                await Modal.alert(t('common.error'), mapFinalizeErrorToMessage(err));
                await TokenStorage.clearPendingExternalAuth();
                pendingAuthContextRef.current = null;
                router.replace('/');
            } finally {
                setBusy(false);
            }
        })();
        fireAndForget(promise, { tag: 'OAuthProviderReturn.finalizeAuth' });
        return promise;
    }, [auth, router]);

    const submitUsername = React.useCallback(() => {
        const ctx = pendingAuthContextRef.current;
        if (!ctx) {
            router.replace('/');
            return;
        }
        const nextUsername = usernameValue.trim();
        if (!nextUsername) {
            setUsernameHint(t('friends.username.invalid'));
            return;
        }

        const nextCtx = { ...ctx, username: nextUsername };
        pendingAuthContextRef.current = nextCtx;
        setUsernameHint(null);

        if (nextCtx.accountMode === 'e2ee') {
            router.replace('/restore');
            return;
        }
        if (nextCtx.accountMode === 'plain') {
            finalizeAuth({ mode: 'plain' });
            return;
        }
        if (nextCtx.provisioning === 'required') {
            const modes = resolveProvisioningModes(nextCtx.provisioningModes);
            if (nextCtx.storagePolicy === 'optional') {
                if (modes.allowPlain && modes.allowE2ee) {
                    setProvisioningChoiceOpen(true);
                    return;
                }
                if (modes.allowPlain) {
                    finalizeAuth({ mode: 'plain' });
                    return;
                }
                if (modes.allowE2ee) {
                    finalizeAuth({ mode: 'e2ee' });
                    return;
                }

                fireAndForget((async () => {
                    await Modal.alert(t('common.error'), t('errors.oauthInitializationFailed'));
                    await TokenStorage.clearPendingExternalAuth();
                })(), { tag: 'OAuthProviderReturn.provisioningModesUnavailable' });
                pendingAuthContextRef.current = null;
                router.replace('/');
                return;
            }
            if (nextCtx.storagePolicy === 'plaintext_only') {
                finalizeAuth({ mode: 'plain' });
                return;
            }
            finalizeAuth({ mode: 'e2ee' });
            return;
        }

        finalizeAuth({ mode: nextCtx.secret ? 'e2ee' : 'plain' });
    }, [finalizeAuth, router, usernameValue]);

    const cancelUsername = React.useCallback(() => {
        fireAndForget((async () => {
            await TokenStorage.clearPendingExternalAuth();
        })(), { tag: 'OAuthProviderReturn.cancelUsername' });
        pendingAuthContextRef.current = null;
        setUsernameHint(null);
        setUsernameValue('');
        setProvisioningChoiceOpen(false);
        router.replace('/');
    }, [router]);

    const chooseProvisioningMode = React.useCallback((mode: 'plain' | 'e2ee') => {
        const ctx = pendingAuthContextRef.current;
        if (!ctx) {
            router.replace('/');
            return Promise.resolve();
        }
        pendingAuthContextRef.current = { ...ctx, chosenMode: mode };
        setProvisioningChoiceOpen(false);
        return finalizeAuth({ mode });
    }, [finalizeAuth, router]);

    React.useEffect(() => {
        const providerId = resolvedProviderId;
        const flow = resolvedFlow;
        const status = resolvedStatus;
        const error = resolvedError;
        const pendingFromParams = resolvedPending;
        const loginFromParams = resolvedLogin;
        const reasonFromParams = resolvedReason;
        const loginFn = auth.login;
        const credentialsFromAuth = auth.credentials;

        let disposed = false;
        const controller = new AbortController();
        const isAbort = (e: unknown) => {
            if (controller.signal.aborted) return true;
            const name = (e as any)?.name;
            return typeof name === 'string' && name.toLowerCase() === 'aborterror';
        };

        const safeSetBusy = (value: boolean) => {
            if (disposed || controller.signal.aborted) return;
            setBusy(value);
        };
        const safeReplace = (path: string) => {
            if (disposed || controller.signal.aborted) return;
            router.replace(path);
        };

        fireAndForget((async () => {
            const directoryEndpoint = normalizeAccountDirectoryEndpoint(
                resolvedEndpointUrl ?? '',
            );
            const directoryIdentity = normalizeAccountDirectoryIdentityParam(
                resolvedEndpointIdentity,
            );
            const directoryTarget = directoryEndpoint && directoryIdentity
                ? {
                    endpoint: directoryEndpoint,
                    serverIdentityId: directoryIdentity,
                }
                : null;
            // Persisted custody is authoritative for the callback family. URL
            // markers help cold-start rendering, but a redirect/intermediary
            // may omit them; the captured endpoint identity still correlates
            // the return to its dedicated Directory continuation namespace.
            let pendingDirectoryAuth: PendingAccountDirectoryAuth | null = null;
            let directoryCustodyFailure: 'corrupt' | 'unavailable' | null = null;
            const canCorrelateDirectoryCustody = resolvedCredentialTarget === null
                || resolvedCredentialTarget === ACCOUNT_DIRECTORY_PURPOSE;
            if (directoryTarget && canCorrelateDirectoryCustody) {
                try {
                    pendingDirectoryAuth = await TokenStorage
                        .getPendingAccountDirectoryAuth(directoryTarget, {
                            includeExpired: true,
                        });
                } catch (storageError) {
                    if (storageError instanceof AccountDirectoryStorageReadError) {
                        directoryCustodyFailure = storageError.reason;
                    } else {
                        throw storageError;
                    }
                }
            }
            const isDirectoryReturn = resolvedDirectoryReturn
                || pendingDirectoryAuth !== null
                || directoryCustodyFailure !== null;
            if (!disposed && !controller.signal.aborted) {
                setPersistedAccountDirectoryReturn(isDirectoryReturn && !resolvedDirectoryReturn);
            }

            if (isDirectoryReturn) {
                const directoryReturnTo =
                    normalizeInternalReturnPath(pendingDirectoryAuth?.returnTo)
                    ?? '/settings/account';
                const directoryProvider = providerId
                    ? getAuthProvider(providerId)
                    : null;
                const providerName = directoryProvider?.displayName ?? providerId;
                accountDirectoryAttemptRef.current = {
                    controller,
                    target: directoryTarget,
                    returnTo: directoryReturnTo,
                };
                accountDirectoryCredentialCommitStartedRef.current = false;
                setAccountDirectoryCompletionReturnTo(null);
                setAccountDirectoryApprovalReturnTo(null);
                const safeSetDirectoryJourney = (
                    state: AccountServiceOAuthJourneyState,
                ) => {
                    if (disposed || controller.signal.aborted) return;
                    setAccountDirectoryJourney(state);
                };
                const setDirectoryStage = (stage: AccountServiceOAuthStage) => {
                    safeSetDirectoryJourney({
                        kind: 'progress',
                        stage,
                        providerName,
                        endpointUrl: directoryEndpoint ?? resolvedEndpointUrl ?? '',
                    });
                };
                setDirectoryStage('verifying_service');
                safeSetBusy(true);
                try {
                    if (directoryCustodyFailure) {
                        safeSetDirectoryJourney({
                            kind: 'error',
                            failure: 'credential_storage_failed',
                            signedIn: false,
                            providerName,
                            endpointUrl: directoryEndpoint ?? resolvedEndpointUrl ?? '',
                        });
                        return;
                    }
                    if (error) {
                        if (directoryTarget) {
                            await TokenStorage
                                .clearPendingAccountDirectoryAuth(directoryTarget)
                                .catch(() => false);
                        }
                        safeSetDirectoryJourney({
                            kind: 'error',
                            failure: 'provider_failed',
                            signedIn: false,
                            providerName,
                            endpointUrl: directoryEndpoint ?? resolvedEndpointUrl ?? '',
                        });
                        return;
                    }

                    if (
                        flow !== 'auth'
                        || !providerId
                        || !directoryProvider
                    ) {
                        if (directoryTarget) {
                            await TokenStorage
                                .clearPendingAccountDirectoryAuth(directoryTarget)
                                .catch(() => false);
                        }
                        safeSetDirectoryJourney({
                            kind: 'error',
                            failure: 'invalid_request',
                            signedIn: false,
                            providerName,
                            endpointUrl: directoryEndpoint ?? resolvedEndpointUrl ?? '',
                        });
                        return;
                    }

                    const result = await finalizeAccountDirectoryOAuthReturn({
                        providerId,
                        purpose: resolvedPurpose ?? pendingDirectoryAuth?.purpose ?? null,
                        credentialTarget: resolvedCredentialTarget
                            ?? pendingDirectoryAuth?.credentialTarget
                            ?? null,
                        endpointUrl: resolvedEndpointUrl,
                        serverIdentityId: resolvedEndpointIdentity,
                        canonicalServerUrl: resolvedCanonicalServerUrl,
                        pendingKey: resolvedPending,
                        mode: resolvedMode,
                        pending: pendingDirectoryAuth,
                        signal: controller.signal,
                        onStage: setDirectoryStage,
                        onCredentialCommitStarted: () => {
                            accountDirectoryCredentialCommitStartedRef.current = true;
                        },
                    });
                    if (controller.signal.aborted) return;
                    if (result.ok) {
                        if (result.awaitingApproval) {
                            setAccountDirectoryApprovalReturnTo(result.returnTo);
                            return;
                        }
                        if (result.continueApprovalInSettings) {
                            safeReplace(result.returnTo);
                            return;
                        }
                        setAccountDirectoryCompletionReturnTo(result.returnTo);
                        return;
                    }

                    if (
                        result.error === 'keyed-authentication-required'
                        && pendingDirectoryAuth?.mode === 'keyless'
                        && directoryEndpoint
                        && directoryIdentity
                    ) {
                        try {
                            const keyedUrl = await accountDirectoryAuthClient.startOAuth({
                                endpointUrl: directoryEndpoint,
                                endpointServerIdentityId: directoryIdentity,
                                canonicalServerUrl: pendingDirectoryAuth.canonicalServerUrl,
                                providerId,
                                mode: 'keyed',
                                entryIntent: pendingDirectoryAuth.entryIntent,
                                returnTo: result.returnTo,
                                ...(pendingDirectoryAuth.homeServerIdentityId
                                    ? { homeServerIdentityId: pendingDirectoryAuth.homeServerIdentityId }
                                    : {}),
                            });
                            if (!isSafeExternalAuthUrl(keyedUrl)) {
                                throw new Error('Invalid keyed Account Service OAuth URL');
                            }
                            await Linking.openURL(keyedUrl);
                            return;
                        } catch {
                            safeSetDirectoryJourney({
                                kind: 'error',
                                failure: 'token_exchange_failed',
                                signedIn: false,
                                providerName,
                                endpointUrl: directoryEndpoint,
                            });
                            return;
                        }
                    }

                    // A failed or tampered continuation is single-use from the
                    // client perspective. Clear only the target namespace.
                    if (directoryTarget && result.preservePending !== true) {
                        await TokenStorage
                            .clearPendingAccountDirectoryAuth(directoryTarget)
                            .catch(() => false);
                    }
                    safeSetDirectoryJourney({
                        kind: 'error',
                        failure: mapAccountDirectoryFailure(
                            result.error ?? 'token-exchange-failed',
                        ),
                        signedIn: result.signedIn === true,
                        providerName,
                        endpointUrl: directoryEndpoint ?? resolvedEndpointUrl ?? '',
                    });
                } finally {
                    safeSetBusy(false);
                }
                return;
            }

            const pendingAuthStateForFlow =
                flow === 'auth'
                    ? await TokenStorage
                        .readPendingExternalAuthContinuationState()
                    : null;
            const hasStoredFirstKeyContinuation = Boolean(
                pendingAuthStateForFlow?.value
                    ?.accountEncryptionFirstKey,
            );
            const isFirstKeyReturn =
                resolvedPurpose
                    === ACCOUNT_ENCRYPTION_FIRST_KEY_PURPOSE
                || hasStoredFirstKeyContinuation;

            if (!providerId) {
                if (isFirstKeyReturn) {
                    await TokenStorage.clearPendingExternalAuth();
                    await Modal.alert(
                        t('common.error'),
                        t('errors.oauthInitializationFailed'),
                    );
                }
                safeReplace('/');
                return;
            }

            const provider = getAuthProvider(providerId);
            if (!provider) {
                if (isFirstKeyReturn) {
                    await TokenStorage.clearPendingExternalAuth();
                }
                await Modal.alert(t('common.error'), t('errors.oauthInitializationFailed'));
                safeReplace('/');
                return;
            }

            if (error) {
                const providerName = provider.displayName ?? providerId;
                const message =
                    error === 'oauth_not_configured'
                        ? t('friends.providerGate.notConfigured', { provider: providerName })
                        : error === 'invalid_state'
                            ? t('errors.oauthStateMismatch')
                            : error;
                await Modal.alert(t('common.error'), message);
                if (flow !== 'auth') {
                    await TokenStorage.clearPendingExternalConnect();
                } else if (isFirstKeyReturn) {
                    await TokenStorage.clearPendingExternalAuth();
                }
                safeReplace(
                    flow === 'auth'
                    && !isFirstKeyReturn
                        ? '/'
                        : '/settings/account',
                );
                return;
            }

            if (flow === 'auth') {
                const pending = pendingFromParams;
                if (
                    resolvedPurpose
                    === ACCOUNT_ENCRYPTION_FIRST_KEY_PURPOSE
                ) {
                    const firstKeyState =
                        pendingAuthStateForFlow?.value;
                    const firstKeyServerUrl =
                        typeof firstKeyState?.serverUrl === 'string'
                            ? firstKeyState.serverUrl.trim()
                            : '';
                    const firstKeyServerId =
                        typeof firstKeyState?.serverId === 'string'
                            ? firstKeyState.serverId.trim()
                            : '';
                    const currentCredentials =
                        firstKeyServerUrl && firstKeyServerId
                            ? await TokenStorage.getCredentialsForServerUrl(
                                firstKeyServerUrl,
                                { serverId: firstKeyServerId },
                            ).catch(() => null)
                            : credentialsFromAuth
                                ?? await TokenStorage.getCredentials()
                                    .catch(() => null);
                    if (!currentCredentials) {
                        await TokenStorage.clearPendingExternalAuth();
                        await Modal.alert(
                            t('common.error'),
                            t('errors.oauthInitializationFailed'),
                        );
                        safeReplace('/settings/account');
                        return;
                    }
                    try {
                        safeSetBusy(true);
                        const resumed =
                            await resumeAccountEncryptionFirstKeyExternalAuth({
                                provider: providerId,
                                pending,
                                currentCredentials,
                                ...(firstKeyServerUrl && firstKeyServerId
                                    ? {
                                        target: {
                                            serverUrl: firstKeyServerUrl,
                                            serverId: firstKeyServerId,
                                        },
                                    }
                                    : {}),
                                persistCredentials:
                                    auth.loginWithCredentials,
                            });
                        safeReplace(resumed.returnTo);
                    } catch (error) {
                        await Modal.alert(
                            t('common.error'),
                            t('errors.oauthStateMismatch'),
                        );
                        if (
                            !(error instanceof HappyError)
                            || error.code
                                !==
                                'first-key-pending-custody-failed'
                        ) {
                            safeReplace('/settings/account');
                        }
                    } finally {
                        safeSetBusy(false);
                    }
                    return;
                }
                if (hasStoredFirstKeyContinuation) {
                    await TokenStorage.clearPendingExternalAuth();
                    await Modal.alert(
                        t('common.error'),
                        t('errors.oauthStateMismatch'),
                    );
                    safeReplace('/settings/account');
                    return;
                }
                const pendingAuthState =
                    pendingAuthStateForFlow!;
                const state = pendingAuthState.value;
                const secret = typeof state?.secret === 'string' ? state.secret : null;
                const proof = typeof state?.proof === 'string' ? state.proof : null;
                const serverUrlMismatch =
                    pendingAuthState.serverMismatch;

                if (!pending || !state || state.provider !== providerId || (!proof && !secret) || serverUrlMismatch) {
                    // In dev (React strict-mode) or certain hydration paths, this screen can mount more than once.
                    // If another instance already completed the flow, pending state may have been cleared even
                    // though the user is now logged in. Avoid showing a false-negative OAuth error in that case.
                    const existingCredentials = await TokenStorage.getCredentials().catch(() => null);
                    if (existingCredentials?.token) {
                        safeReplace('/');
                        return;
                    }
                    if (serverUrlMismatch) {
                        await TokenStorage.clearPendingExternalAuth();
                        await Modal.alert(t('common.error'), t('errors.oauthStateMismatch'));
                    } else {
                        await Modal.alert(t('common.error'), t('errors.oauthInitializationFailed'));
                    }
                    safeReplace('/');
                    return;
                }
                const returnTo = normalizeInternalReturnPath(state.returnTo) ?? '/';

                try {
                    const login = loginFromParams;
                    pendingAuthContextRef.current = {
                        providerId,
                        providerName: provider.displayName ?? providerId,
                        pending,
                        proof,
                        secret,
                        intent: (state.intent as any) ?? null,
                        returnTo,
                        serverUrl: state.serverUrl,
                        serverId: state.serverId,
                        storagePolicy: resolvedStoragePolicy,
                        provisioning: resolvedProvisioning,
                        provisioningModes: resolvedProvisioningModes,
                        accountMode: resolvedAccountMode,
                        username: null,
                        chosenMode: null,
                    };

                    if (status === 'username_required') {
                        const reason = reasonFromParams;
                        const initialHint = reason === 'invalid_login' ? t('friends.username.invalid') : t('friends.username.taken');
                        setUsernameHint(initialHint);
                        setUsernameValue(login || '');
                        return;
                    }

                    if (resolvedAccountMode === 'e2ee') {
                        safeReplace('/restore');
                        return;
                    }

                    if (resolvedAccountMode === 'plain') {
                        finalizeAuth({ mode: 'plain' });
                        return;
                    }

                    if (resolvedProvisioning === 'required') {
                        const modes = resolveProvisioningModes(resolvedProvisioningModes);
                        if (resolvedStoragePolicy === 'optional') {
                            if (modes.allowPlain && modes.allowE2ee) {
                                setProvisioningChoiceOpen(true);
                                return;
                            }
                            if (modes.allowPlain) {
                                finalizeAuth({ mode: 'plain' });
                                return;
                            }
                            if (modes.allowE2ee) {
                                finalizeAuth({ mode: 'e2ee' });
                                return;
                            }

                            await Modal.alert(t('common.error'), t('errors.oauthInitializationFailed'));
                            await TokenStorage.clearPendingExternalAuth();
                            pendingAuthContextRef.current = null;
                            safeReplace('/');
                            return;
                        }
                        if (resolvedStoragePolicy === 'plaintext_only') {
                            finalizeAuth({ mode: 'plain' });
                            return;
                        }
                        finalizeAuth({ mode: 'e2ee' });
                        return;
                    }

                    const fallbackKeyless = (resolvedMode ?? '').toString().trim().toLowerCase() === 'keyless';
                    if (fallbackKeyless && proof) {
                        finalizeAuth({ mode: 'plain' });
                        return;
                    }

                    finalizeAuth({ mode: secret ? 'e2ee' : 'plain' });
                    return;
                } catch (e) {
                    if (isAbort(e)) return;
                    throw e;
                } finally {
                    safeSetBusy(false);
                }
            }

            // connect flow (default)
            const credentials = credentialsFromAuth;
            const pendingConnect = await TokenStorage.getPendingExternalConnect();
            const connectReturnTo = pendingConnect && pendingConnect.provider === providerId
                ? normalizeInternalReturnPath(pendingConnect.returnTo) ?? '/settings/account'
                : '/settings/account';
            const finalizeConnectNavigation = async () => {
                await TokenStorage.clearPendingExternalConnect();
                safeReplace(connectReturnTo);
            };
            if (status === 'connected') {
                await finalizeConnectNavigation();
                return;
            }

            if (status !== 'username_required') {
                await finalizeConnectNavigation();
                return;
            }

            const pending = paramString(params, 'pending') ?? '';
            const login = paramString(params, 'login') ?? '';
            const reason = paramString(params, 'reason');
            if (!credentials || !pending) {
                await Modal.alert(t('common.error'), t('friends.username.required'));
                await finalizeConnectNavigation();
                return;
            }

            let hint = reason === 'invalid_login' ? t('friends.username.invalid') : t('friends.username.taken');
            let defaultValue = login || undefined;

            while (true) {
                const next = await Modal.prompt(
                        t('profile.username'),
                        hint,
                        {
                            placeholder: t('profile.username'),
                            defaultValue,
                            confirmText: t('common.save'),
                            cancelText: t('common.cancel'),
                    },
                );

                if (next == null) {
                    try {
                        await provider.cancelConnectPending(credentials, pending);
                    } catch {
                        await Modal.alert(t('common.error'), t('errors.operationFailed'));
                    } finally {
                        await finalizeConnectNavigation();
                    }
                    return;
                }

                try {
                    safeSetBusy(true);
                    await provider.finalizeConnect(credentials, { pending, username: next });
                    await finalizeConnectNavigation();
                    return;
                } catch (e) {
                    if (e instanceof HappyError) {
                        if (e.message === 'username-taken') {
                            hint = t('friends.username.taken');
                            defaultValue = next;
                            continue;
                        }
                        if (e.message === 'invalid-username') {
                            hint = t('friends.username.invalid');
                            defaultValue = next;
                            continue;
                        }
                        if (e.message === 'invalid-pending') {
                            await Modal.alert(t('common.error'), t('errors.oauthStateMismatch'));
                            await finalizeConnectNavigation();
                            return;
                        }
                        await Modal.alert(t('common.error'), mapFinalizeErrorToMessage(e.message));
                        await finalizeConnectNavigation();
                        return;
                    }

                    await Modal.alert(t('common.error'), t('errors.operationFailed'));
                    await finalizeConnectNavigation();
                    return;
                } finally {
                    safeSetBusy(false);
                }
            }
        })(), { tag: 'OAuthProviderReturn.handleRedirect' });

        return () => {
            disposed = true;
            controller.abort('oauth-return-disposed');
        };
	    // Keep deps primitive so we don't dispose mid-flight due to param identity changes.
	    }, [
        router,
        resolvedProviderId,
        resolvedFlow,
        resolvedStatus,
        resolvedError,
        resolvedPending,
        resolvedLogin,
        resolvedReason,
        resolvedPurpose,
        resolvedCredentialTarget,
        resolvedEndpointUrl,
        resolvedEndpointIdentity,
        resolvedCanonicalServerUrl,
        resolvedDirectoryReturn,
        auth.login,
        auth.loginWithCredentials,
        resolvedFlow === 'auth' ? '' : auth.credentials?.token ?? '',
    ]);

    const handleBack = React.useCallback(() => {
        safeRouterBack({ router, fallbackHref: '/' });
    }, [router]);

    const cancelAccountDirectoryJourney = React.useCallback(async () => {
        if (accountDirectoryCredentialCommitStartedRef.current) return;
        const attempt = accountDirectoryAttemptRef.current;
        attempt?.controller.abort('account-service-oauth-cancelled');
        const fallbackEndpoint = normalizeAccountDirectoryEndpoint(
            resolvedEndpointUrl ?? '',
        );
        const fallbackIdentity = normalizeAccountDirectoryIdentityParam(
            resolvedEndpointIdentity,
        );
        const target = attempt?.target ?? (fallbackEndpoint && fallbackIdentity
            ? {
                endpoint: fallbackEndpoint,
                serverIdentityId: fallbackIdentity,
            }
            : null);
        if (target) {
            await TokenStorage
                .clearPendingAccountDirectoryAuth(target)
                .catch(() => false);
        }
        accountDirectoryAttemptRef.current = null;
        accountDirectoryCredentialCommitStartedRef.current = false;
        router.replace(attempt?.returnTo ?? '/settings/account');
    }, [resolvedEndpointIdentity, resolvedEndpointUrl, router]);

    const recoverAccountDirectoryJourney = React.useCallback(() => {
        const returnTo = accountDirectoryAttemptRef.current?.returnTo
            ?? '/settings/account';
        accountDirectoryAttemptRef.current = null;
        accountDirectoryCredentialCommitStartedRef.current = false;
        router.replace(returnTo);
    }, [router]);

    const completeAccountDirectoryJourney = React.useCallback(() => {
        if (!accountDirectoryCompletionReturnTo) return;
        setAccountDirectoryCompletionReturnTo(null);
        router.replace(accountDirectoryCompletionReturnTo);
    }, [accountDirectoryCompletionReturnTo, router]);

    // Entering the preferred Home is applied by the canonical continuation owner before this
    // resolves, so the entry destination is the ordinary shell root in every outcome; a
    // non-entered outcome simply lands back on the unauthenticated welcome with the Account
    // Service credential preserved.
    const completeAccountDirectoryApproval = React.useCallback((
        _outcome: AccountServiceApprovalOutcome,
    ) => {
        setAccountDirectoryApprovalReturnTo(null);
        router.replace(accountDirectoryApprovalReturnTo ?? '/');
    }, [accountDirectoryApprovalReturnTo, router]);

    const wizardTitle =
        provisioningChoiceOpen
            ? t('welcome.chooseEncryptionTitle')
            : usernameHint != null
                ? t('profile.username')
                : t('setupOnboarding.resumeIntentTitle');

    const wizardSubtitle =
        provisioningChoiceOpen
            ? t('welcome.chooseEncryptionBody')
            : usernameHint != null
                ? usernameHint
                : t('setupOnboarding.resumeIntentBody');

    const body = provisioningChoiceOpen ? (
        <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 12 }}>
            <Pressable
                testID="oauth-provisioning-choice-e2ee"
                onPress={() => chooseProvisioningMode('e2ee')}
                style={{
                    paddingVertical: 10,
                    borderRadius: 8,
                    backgroundColor: theme.colors.button.primary.background,
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Text style={{ color: theme.colors.button.primary.tint }}>
                    {t('welcome.chooseEncryptionEncrypted')}
                </Text>
            </Pressable>

            <Pressable
                testID="oauth-provisioning-choice-plain"
                onPress={() => chooseProvisioningMode('plain')}
                style={{
                    paddingVertical: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: theme.colors.border.default,
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Text style={{ color: theme.colors.text.primary }}>
                    {t('welcome.chooseEncryptionPlain')}
                </Text>
            </Pressable>

            {busy ? <ActivitySpinner size="small" /> : null}
        </View>
    ) : usernameHint != null ? (
        <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 12 }}>
            <TextInput
                testID="oauth-username-input"
                value={usernameValue}
                onChangeText={setUsernameValue}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('profile.username')}
                placeholderTextColor={theme.colors.input.placeholder}
                style={{
                    borderWidth: 1,
                    borderColor: theme.colors.border.default,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: theme.colors.input.background,
                    color: theme.colors.input.text,
                }}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                    testID="oauth-username-cancel"
                    onPress={cancelUsername}
                    style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: theme.colors.border.default,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Text style={{ color: theme.colors.text.primary }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                    testID="oauth-username-save"
                    onPress={submitUsername}
                    style={{
                        flex: 1,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor: theme.colors.button.primary.background,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Text style={{ color: theme.colors.button.primary.tint }}>{t('common.save')}</Text>
                </Pressable>
            </View>
            {busy ? <ActivitySpinner size="small" /> : null}
        </View>
    ) : (
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {busy ? <ActivitySpinner size="small" /> : null}
        </View>
    );

    const visibleAccountDirectoryJourney = (resolvedDirectoryReturn || persistedAccountDirectoryReturn)
        ? accountDirectoryJourney ?? {
                kind: 'progress' as const,
                stage: 'verifying_service' as const,
                providerName: getAuthProvider(resolvedProviderId)?.displayName
                    ?? resolvedProviderId,
                endpointUrl: normalizeAccountDirectoryEndpoint(
                    resolvedEndpointUrl ?? '',
                ) ?? resolvedEndpointUrl ?? '',
            }
        : null;

    if (visibleAccountDirectoryJourney) {
        const canCancel = visibleAccountDirectoryJourney.kind === 'progress'
            && (
                visibleAccountDirectoryJourney.stage === 'verifying_service'
                || visibleAccountDirectoryJourney.stage === 'signing_in'
            );
        return (
            <WizardModalShell
                testID="oauth-return-wizard"
                stepIndex={0}
                stepCount={1}
                title={t('settingsAccount.accountServiceOAuth.title')}
                showBack={false}
                showSkip={false}
                onSecondary={canCancel ? cancelAccountDirectoryJourney : undefined}
                secondaryLabel={t('common.cancel')}
                footerHint={canCancel ? (
                    <Text testID="oauth-account-directory-cancel-note">
                        {t('settingsAccount.accountServiceOAuth.cancelNote')}
                    </Text>
                ) : undefined}
            >
                <AccountServiceOAuthJourney
                    state={visibleAccountDirectoryJourney}
                    onRecovery={recoverAccountDirectoryJourney}
                    onTerminalPresented={completeAccountDirectoryJourney}
                    approvalContinuation={accountDirectoryApprovalReturnTo !== null}
                    onApprovalOutcome={completeAccountDirectoryApproval}
                />
            </WizardModalShell>
        );
    }

    return (
        <WizardModalShell
            testID="oauth-return-wizard"
            stepIndex={1}
            stepCount={3}
            title={wizardTitle}
            subtitle={wizardSubtitle}
            onBack={handleBack}
            showSkip={false}
        >
            {body}
        </WizardModalShell>
    );
}
