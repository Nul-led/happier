import * as React from 'react';
import type { FeaturesResponse } from '@happier-dev/protocol';
import type { ProjectedAuthenticationCatalog } from '@happier-dev/cli-common/authentication/authMethodCatalog';
import type { HomeTargetInput } from '@happier-dev/cli-common/homeTarget';
import type { HomeSignInServicePolicyV1 } from '@happier-dev/protocol';

import type { AccountDirectoryAuthTransport } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { fetchHomeAuthEntry } from '@/auth/entry/authEntryClient';
import { getAuthProvider } from '@/auth/providers/registry';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import {
    getCachedServerFeaturesSnapshot,
    getServerFeaturesSnapshot,
    subscribeServerFeaturesSnapshot,
    type ServerFeaturesSnapshot,
} from '@/sync/api/capabilities/serverFeaturesClient';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { t } from '@/text';
import { getServerRetentionPolicy } from '@/sync/api/capabilities/serverRetentionPolicyClient';
import { formatServerRetentionDisclosure } from '@/sync/domains/server/retention/formatServerRetentionPolicy';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { getActiveServerHomeCarrier, getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import {
    normalizeAuthenticationProviderId,
    projectAuthEntryMethodCapabilities,
    projectAuthenticationMethodCapabilities,
    type HomeAuthenticationAction,
} from '@/auth/capabilities/authMethodCapabilities';

type AuthEntryServerAvailability = 'loading' | 'ready' | 'legacy' | 'unavailable' | 'incompatible';

export type AuthEntryPrimaryAction = Readonly<{
    kind: 'anonymous' | 'provider-keyed' | 'mtls' | 'keyless';
    title: string;
}>;

export type AuthEntryOptions = Readonly<{
    authenticationCatalog?: ProjectedAuthenticationCatalog;
    authenticationActions?: readonly HomeAuthenticationAction[];
    keyChallengeV2Available?: boolean;
    /** Home explicitly selected/requested by the user; absent for a seeded fallback profile. */
    requestedHomeTarget?: HomeTargetInput;
    homeTarget?: HomeTargetInput;
    homeLabel?: string;
    homeTransport?: AccountDirectoryAuthTransport;
    signInServicePolicy?: HomeSignInServicePolicyV1;
    observedHomeServerIdentityId?: string;
    serverAvailability: AuthEntryServerAvailability;
    /**
     * The live auth-entry probe failed while the released feature contract
     * answered, so the options come from that catalog. Welcome keeps the
     * Home usable and offers one retry rather than hiding it.
     */
    authEntryUnavailable: boolean;
    serverUrlForCopy: string;
    showAuthActions: boolean;
    showProviderSignup: boolean;
    showAnonymousSignup: boolean;
    showMtlsLogin: boolean;
    showKeylessProviderLogin: boolean;
    providerId: string | null;
    keylessProviderId: string | null;
    providerSignupTitle: string;
    providerKeylessTitle: string;
    anonymousSignupTitle: string;
    mtlsTitle: string;
    primaryAction: AuthEntryPrimaryAction | null;
    mtlsPrimary: boolean;
    keylessPrimary: boolean;
    retentionSummary?: string | null;
    autoRedirect: Readonly<{
        enabled: boolean;
        providerId: string | null;
        toKeyedProvision: boolean;
        toKeylessLogin: boolean;
        toMtls: boolean;
        toLegacySignupProvider: boolean;
    }>;
    retryServerCheck: () => void;
}>;

type ObservedAuthEntryOptions = Pick<
    AuthEntryOptions,
    | 'showAuthActions'
    | 'authEntryUnavailable'
    | 'authenticationCatalog'
    | 'authenticationActions'
    | 'keyChallengeV2Available'
    | 'signInServicePolicy'
    | 'observedHomeServerIdentityId'
    | 'showProviderSignup'
    | 'showAnonymousSignup'
    | 'showMtlsLogin'
    | 'showKeylessProviderLogin'
    | 'providerId'
    | 'keylessProviderId'
    | 'providerSignupTitle'
    | 'providerKeylessTitle'
    | 'anonymousSignupTitle'
    | 'mtlsTitle'
    | 'primaryAction'
    | 'mtlsPrimary'
    | 'keylessPrimary'
    | 'retentionSummary'
    | 'autoRedirect'
>;

function createUnobservedAuthEntryOptions(): ObservedAuthEntryOptions {
    return {
        authenticationCatalog: { provenance: 'legacy', methods: [] },
        authenticationActions: [],
        keyChallengeV2Available: false,
        signInServicePolicy: undefined,
        observedHomeServerIdentityId: undefined,
        authEntryUnavailable: false,
        showAuthActions: false,
        showProviderSignup: false,
        showAnonymousSignup: false,
        showMtlsLogin: false,
        showKeylessProviderLogin: false,
        providerId: null,
        keylessProviderId: null,
        providerSignupTitle: '',
        providerKeylessTitle: '',
        anonymousSignupTitle: t('welcome.createAccount'),
        mtlsTitle: t('welcome.signInWithCertificate'),
        primaryAction: null,
        mtlsPrimary: false,
        keylessPrimary: false,
        retentionSummary: null,
        autoRedirect: {
            enabled: false,
            providerId: null,
            toKeyedProvision: false,
            toKeylessLogin: false,
            toMtls: false,
            toLegacySignupProvider: false,
        },
    };
}

type UsableAuthEntryObservation = Readonly<{
    serverAvailability: Extract<AuthEntryServerAvailability, 'ready' | 'legacy'>;
    options: ObservedAuthEntryOptions;
}>;

function createUsableAuthEntryObservation(input: Readonly<{
    features: FeaturesResponse | null;
    entryProjection: Parameters<typeof projectAuthEntryMethodCapabilities>[0] | null;
    authEntryUnavailable: boolean;
}>): UsableAuthEntryObservation {
    const authMethodCapabilities = input.entryProjection
        ? projectAuthEntryMethodCapabilities(input.entryProjection)
        : projectAuthenticationMethodCapabilities(input.features);
    const anonymousEnabled = authMethodCapabilities.anonymousProvisionAvailable;
    const keylessLoginMethodIds = authMethodCapabilities.keylessLoginMethodIds;
    const mtlsEnabled = keylessLoginMethodIds.includes('mtls');
    const keylessProviderIds = keylessLoginMethodIds.filter((id) => id !== 'mtls');
    const observedHomeServerIdentityId = input.features?.capabilities.serverIdentity?.serverIdentityId ?? undefined;

    if (
        !authMethodCapabilities.usesStructuredMethods
        && authMethodCapabilities.legacyEnabledSignupMethodIds.length === 0
        && authMethodCapabilities.legacyEnabledLoginMethodIds.length === 0
    ) {
        return {
            serverAvailability: 'legacy',
            options: {
                authenticationCatalog: authMethodCapabilities.catalog,
                authenticationActions: [{
                    method: { id: 'key_challenge', enabledActions: [{ id: 'provision', mode: 'keyed' }] },
                    action: { id: 'provision', mode: 'keyed' },
                    execution: { kind: 'generated_key' },
                }],
                keyChallengeV2Available: false,
                signInServicePolicy: input.features?.signInService,
                ...(observedHomeServerIdentityId ? { observedHomeServerIdentityId } : {}),
                authEntryUnavailable: input.authEntryUnavailable,
                showAuthActions: true,
                showProviderSignup: false,
                showAnonymousSignup: true,
                showMtlsLogin: false,
                showKeylessProviderLogin: false,
                providerId: null,
                keylessProviderId: null,
                providerSignupTitle: '',
                providerKeylessTitle: '',
                anonymousSignupTitle: t('welcome.createAccount'),
                mtlsTitle: t('welcome.signInWithCertificate'),
                primaryAction: {
                    kind: 'anonymous',
                    title: t('welcome.createAccount'),
                },
                mtlsPrimary: false,
                keylessPrimary: false,
                autoRedirect: {
                    enabled: false,
                    providerId: null,
                    toKeyedProvision: false,
                    toKeylessLogin: false,
                    toMtls: false,
                    toLegacySignupProvider: false,
                },
            },
        };
    }

    const preferredProviderId = authMethodCapabilities.configuredKeyedProvisionProviderIds[0]
        ?? authMethodCapabilities.keyedProvisionProviderIds[0]
        ?? null;
    const configuredKeylessProviderId = authMethodCapabilities.configuredKeylessProviderIds[0] ?? null;
    const preferredKeylessProviderId = configuredKeylessProviderId ?? keylessProviderIds[0] ?? null;
    const providerSignupTitle = preferredProviderId
        ? t('welcome.signUpWithProvider', {
            provider: authMethodCapabilities.catalog.methods.find((method) => method.id === preferredProviderId)
                ?.presentation?.displayName
                ?? getAuthProvider(preferredProviderId)?.displayName
                ?? preferredProviderId,
        })
        : '';
    const providerKeylessTitle = preferredKeylessProviderId
        ? t('welcome.signUpWithProvider', {
            provider: authMethodCapabilities.catalog.methods.find((method) => method.id === preferredKeylessProviderId)
                ?.presentation?.displayName
                ?? getAuthProvider(preferredKeylessProviderId)?.displayName
                ?? preferredKeylessProviderId,
        })
        : '';
    const anonymousSignupTitle = t('welcome.createAccount');
    const mtlsTitle = t('welcome.signInWithCertificate');
    const mtlsPrimary = mtlsEnabled && !preferredProviderId && !anonymousEnabled;
    const keylessPrimary = Boolean(preferredKeylessProviderId) && preferredKeylessProviderId !== preferredProviderId && !anonymousEnabled && !mtlsEnabled;
    const primaryAction: AuthEntryPrimaryAction | null = mtlsPrimary
        ? { kind: 'mtls', title: mtlsTitle }
        : keylessPrimary
            ? { kind: 'keyless', title: providerKeylessTitle }
            : preferredProviderId
                ? { kind: 'provider-keyed', title: providerSignupTitle }
                : anonymousEnabled
                    ? { kind: 'anonymous', title: anonymousSignupTitle }
                    : null;
    const entryAutoRedirect = input.entryProjection?.autoRedirect ?? null;
    const legacyAutoRedirect = input.entryProjection
        ? null
        : input.features?.capabilities?.auth?.ui?.autoRedirect ?? null;
    const autoRedirectProviderId = normalizeAuthenticationProviderId(
        entryAutoRedirect?.methodId ?? legacyAutoRedirect?.providerId,
    );

    return {
        serverAvailability: 'ready',
        options: {
            authenticationCatalog: authMethodCapabilities.catalog,
            authenticationActions: authMethodCapabilities.authenticationActions,
            // Auth-entry owns the live method/action list. The released feature
            // contract still owns key-challenge wire-version negotiation.
            keyChallengeV2Available: input.features?.capabilities?.auth?.keyChallenge?.v2 === true,
            signInServicePolicy: input.entryProjection
                ? input.entryProjection.signInService
                : input.features?.signInService,
            ...(observedHomeServerIdentityId ? { observedHomeServerIdentityId } : {}),
            authEntryUnavailable: input.authEntryUnavailable,
            showAuthActions: true,
            showProviderSignup: Boolean(preferredProviderId),
            showAnonymousSignup: anonymousEnabled,
            showMtlsLogin: mtlsEnabled,
            showKeylessProviderLogin: Boolean(preferredKeylessProviderId) && preferredKeylessProviderId !== preferredProviderId,
            providerId: preferredProviderId,
            keylessProviderId: preferredKeylessProviderId,
            providerSignupTitle,
            providerKeylessTitle,
            anonymousSignupTitle,
            mtlsTitle,
            primaryAction,
            mtlsPrimary,
            keylessPrimary,
            retentionSummary: null,
            autoRedirect: {
                enabled: input.entryProjection
                    ? Boolean(autoRedirectProviderId)
                    : legacyAutoRedirect?.enabled === true && Boolean(autoRedirectProviderId),
                providerId: autoRedirectProviderId || null,
                toKeyedProvision: authMethodCapabilities.usesStructuredMethods
                    && authMethodCapabilities.keyedProvisionProviderIds.includes(autoRedirectProviderId),
                toKeylessLogin: authMethodCapabilities.usesStructuredMethods
                    && authMethodCapabilities.keylessLoginMethodIds.includes(autoRedirectProviderId),
                toMtls: autoRedirectProviderId === 'mtls' && mtlsEnabled,
                toLegacySignupProvider: !authMethodCapabilities.usesStructuredMethods
                    && autoRedirectProviderId.length > 0
                    && authMethodCapabilities.legacyEnabledSignupMethodIds.includes(autoRedirectProviderId),
            },
        },
    };
}

function createCachedAuthEntryObservation(
    snapshot: ServerFeaturesSnapshot | null,
): UsableAuthEntryObservation | null {
    if (!snapshot || snapshot.status === 'error') return null;
    if (snapshot.status === 'unsupported' && snapshot.reason === 'invalid_payload') return null;
    return createUsableAuthEntryObservation({
        features: snapshot.status === 'ready' ? snapshot.features : null,
        entryProjection: null,
        authEntryUnavailable: false,
    });
}

const DEFAULT_WELCOME_SERVER_CHECK_TIMEOUT_MS = 6_000;

function readWelcomeServerCheckTimeoutMs(): number {
    const raw = String(process.env.EXPO_PUBLIC_HAPPIER_WELCOME_SERVER_CHECK_TIMEOUT_MS ?? '').trim();
    if (!raw) return DEFAULT_WELCOME_SERVER_CHECK_TIMEOUT_MS;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_WELCOME_SERVER_CHECK_TIMEOUT_MS;
    return Math.max(1_000, Math.min(30_000, parsed));
}

/** Canonical deterministic provider choice for keyed account provisioning surfaces. */
export function resolvePreferredProvisionProviderId(features: FeaturesResponse | null): string | null {
    const methods = projectAuthenticationMethodCapabilities(features);
    return methods.configuredKeyedProvisionProviderIds[0]
        ?? methods.keyedProvisionProviderIds[0]
        ?? null;
}

export function useAuthEntryOptions(): AuthEntryOptions {
    const activeServerSnapshot = useActiveServerSnapshot();
    const readCachedServerFeaturesSnapshot = React.useCallback(
        () => getCachedServerFeaturesSnapshot({ serverId: activeServerSnapshot.serverId || undefined }),
        [activeServerSnapshot.serverId],
    );
    const cachedServerFeaturesSnapshot = React.useSyncExternalStore(
        subscribeServerFeaturesSnapshot,
        readCachedServerFeaturesSnapshot,
        readCachedServerFeaturesSnapshot,
    );
    const cachedObservation = React.useMemo(
        () => createCachedAuthEntryObservation(cachedServerFeaturesSnapshot),
        [cachedServerFeaturesSnapshot],
    );
    const cachedObservationRef = React.useRef(cachedObservation);
    cachedObservationRef.current = cachedObservation;
    const activeObservationKey = activeServerSnapshot.serverId || activeServerSnapshot.serverUrl;
    const initialObservationRef = React.useRef(cachedObservation);
    const [serverAvailability, setServerAvailability] = React.useState<AuthEntryServerAvailability>(
        () => initialObservationRef.current?.serverAvailability ?? 'loading',
    );
    const [serverCheckNonce, setServerCheckNonce] = React.useState(0);
    const [serverFeaturesRecoveryNonce, setServerFeaturesRecoveryNonce] = React.useState(0);
    const consumedForcedServerCheckNonceRef = React.useRef(0);
    const consumedRecoveredServerFeaturesSnapshotRef = React.useRef<ServerFeaturesSnapshot | null>(null);
    const [options, setOptions] = React.useState<ObservedAuthEntryOptions>(
        () => initialObservationRef.current?.options ?? createUnobservedAuthEntryOptions(),
    );
    const lastUsableObservationRef = React.useRef<Readonly<{
        key: string;
        observation: UsableAuthEntryObservation;
    }> | null>(initialObservationRef.current
        ? { key: activeObservationKey, observation: initialObservationRef.current }
        : null);

    const serverUrlForCopy = React.useMemo(() => {
        const raw = activeServerSnapshot?.serverUrl ? String(activeServerSnapshot.serverUrl).trim() : '';
        return raw || t('status.unknown');
    }, [activeServerSnapshot?.serverUrl]);

    const activeServerComparableKey = React.useMemo(
        () => createServerUrlComparableKey(activeServerSnapshot?.serverUrl ?? '') ?? '',
        [activeServerSnapshot?.serverUrl],
    );
    const activeServerGeneration = activeServerSnapshot?.generation ?? 0;

    React.useEffect(() => {
        if (serverAvailability !== 'unavailable') return;
        if (!cachedServerFeaturesSnapshot || cachedServerFeaturesSnapshot.status === 'error') return;
        if (consumedRecoveredServerFeaturesSnapshotRef.current === cachedServerFeaturesSnapshot) return;

        consumedRecoveredServerFeaturesSnapshotRef.current = cachedServerFeaturesSnapshot;
        setServerFeaturesRecoveryNonce((value) => value + 1);
    }, [cachedServerFeaturesSnapshot, serverAvailability]);

    React.useEffect(() => {
        let mounted = true;
        let authEntryController: AbortController | null = null;
        let authEntryTimeout: ReturnType<typeof setTimeout> | null = null;
        const retainedObservation = lastUsableObservationRef.current?.key === activeObservationKey
            ? lastUsableObservationRef.current.observation
            : cachedObservationRef.current;
        const commitUsableObservation = (observation: UsableAuthEntryObservation) => {
            if (!mounted) return;
            lastUsableObservationRef.current = { key: activeObservationKey, observation };
            setOptions(observation.options);
            setServerAvailability(observation.serverAvailability);
        };
        const commitRetainedUnavailable = (observation: UsableAuthEntryObservation) => {
            commitUsableObservation({
                ...observation,
                options: { ...observation.options, authEntryUnavailable: true },
            });
        };
        const commitTerminalUnavailable = (availability: Extract<AuthEntryServerAvailability, 'unavailable' | 'incompatible'>) => {
            if (!mounted) return;
            lastUsableObservationRef.current = null;
            setOptions(createUnobservedAuthEntryOptions());
            setServerAvailability(availability);
        };
        const forceServerCheck = serverCheckNonce > consumedForcedServerCheckNonceRef.current;
        if (forceServerCheck) {
            consumedForcedServerCheckNonceRef.current = serverCheckNonce;
        }

        void (async () => {
            try {
                if (retainedObservation) {
                    commitUsableObservation(retainedObservation);
                } else if (mounted) {
                    setServerAvailability('loading');
                    setOptions(createUnobservedAuthEntryOptions());
                }

                const serverCheckTimeoutMs = readWelcomeServerCheckTimeoutMs();
                authEntryController = new AbortController();
                authEntryTimeout = setTimeout(() => {
                    authEntryController?.abort('welcome-auth-entry-timeout');
                }, serverCheckTimeoutMs);
                // Neither probe consumes the other's result, so both run at
                // once: first usable paint is bounded by one attempt timeout,
                // not two.
                let featuresSnapshot: Awaited<ReturnType<typeof getServerFeaturesSnapshot>>;
                let authEntry: Awaited<ReturnType<typeof fetchHomeAuthEntry>>;
                try {
                    [featuresSnapshot, authEntry] = await Promise.all([
                        getServerFeaturesSnapshot({
                            timeoutMs: serverCheckTimeoutMs,
                            // A retry nonce grants one forced revalidation. Keeping force
                            // sticky after the retry succeeds turns an identity update into
                            // a request loop: the response advances the active generation,
                            // this effect re-runs, and another forced response advances it
                            // again. Generation-only rechecks consume the canonical cache.
                            force: forceServerCheck,
                        }),
                        fetchHomeAuthEntry({ signal: authEntryController.signal }),
                    ]);
                } finally {
                    clearTimeout(authEntryTimeout);
                    authEntryTimeout = null;
                }

                if (featuresSnapshot.status === 'error') {
                    if (retainedObservation) commitRetainedUnavailable(retainedObservation);
                    else commitTerminalUnavailable('unavailable');
                    return;
                }

                if (featuresSnapshot.status === 'unsupported' && featuresSnapshot.reason === 'invalid_payload') {
                    commitTerminalUnavailable('incompatible');
                    return;
                }

                if (authEntry.kind === 'incompatible'
                    || (authEntry.kind === 'ready' && authEntry.projection.state === 'update_required')) {
                    commitTerminalUnavailable('incompatible');
                    return;
                }
                if (authEntry.kind === 'ready' && authEntry.projection.state !== 'ready') {
                    // The Home answered and refused entry. That is its decision,
                    // not an outage to paper over with the feature catalog.
                    commitTerminalUnavailable('unavailable');
                    return;
                }
                // A failed live probe (outage or timeout of the request-scoped
                // auth-entry route) never hides a Home the released feature
                // contract already described: degrade to that catalog exactly
                // like an older Home without auth entry and let Welcome show a
                // notice with one retry. The `unavailable` availability is
                // reserved for a failed feature probe.
                const authEntryUnavailable = authEntry.kind === 'unavailable';
                const features = featuresSnapshot.status === 'ready' ? featuresSnapshot.features : null;
                const observation = createUsableAuthEntryObservation({
                    features,
                    // Only a Home projection that actually carries entry actions can be
                    // projected; a terminal refusal is not a method catalog.
                    entryProjection: authEntry.kind === 'ready' && authEntry.projection.state === 'ready'
                        ? authEntry.projection
                        : null,
                    authEntryUnavailable,
                });
                commitUsableObservation(observation);
                if (observation.serverAvailability === 'ready' && mounted) {
                    void getServerRetentionPolicy({ serverId: activeServerSnapshot.serverId }).then((retentionPolicy) => {
                        if (!mounted) return;
                        const retentionSummary = formatServerRetentionDisclosure(retentionPolicy);
                        setOptions((current) => current.retentionSummary === retentionSummary
                            ? current
                            : { ...current, retentionSummary });
                    });
                }
            } catch {
                if (retainedObservation) commitRetainedUnavailable(retainedObservation);
                else commitTerminalUnavailable('unavailable');
            }
        })();

        return () => {
            mounted = false;
            authEntryController?.abort('welcome-auth-entry-unmounted');
            if (authEntryTimeout) clearTimeout(authEntryTimeout);
        };
    // A server lifecycle can leave and restore the same canonical URL (the
    // onboarding demo relay is one example) while invalidating the feature
    // snapshot for that server. URL equality alone would retain the previous
    // unavailable result forever. The active-server owner increments generation
    // for that lifecycle transition, so re-run the canonical feature probe.
    }, [activeObservationKey, activeServerComparableKey, activeServerGeneration, serverCheckNonce, serverFeaturesRecoveryNonce]);

    const activeProfile = activeServerSnapshot.serverId
        ? getServerProfileById(activeServerSnapshot.serverId)
        : null;
    const activeHomeCarrier = activeServerSnapshot.serverId ? getActiveServerHomeCarrier() : null;
    const carrierSnapshot = activeHomeCarrier ? getActiveServerSnapshot() : null;
    const exactActiveHomeCarrier = carrierSnapshot?.serverId === activeServerSnapshot.serverId
        && carrierSnapshot.generation === activeServerSnapshot.generation
        ? activeHomeCarrier
        : null;
    return {
        serverAvailability,
        serverUrlForCopy,
        ...(activeServerSnapshot.serverId ? {
            homeTarget: { kind: 'saved_profile', profileRef: activeServerSnapshot.serverId } as const,
            ...(activeServerSnapshot.isSelectionExplicit === true
                ? { requestedHomeTarget: { kind: 'saved_profile', profileRef: activeServerSnapshot.serverId } as const }
                : {}),
            homeLabel: activeProfile?.name ?? serverUrlForCopy,
            ...(exactActiveHomeCarrier
                ? { homeTransport: { homeCarrier: exactActiveHomeCarrier } }
                : activeServerSnapshot.runtimeOrigin
                    ? { homeTransport: { runtimeOrigin: activeServerSnapshot.runtimeOrigin } }
                    : {}),
        } : {}),
        ...options,
        retryServerCheck: React.useCallback(() => {
            setServerCheckNonce((value) => value + 1);
        }, []),
    };
}
