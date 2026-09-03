import { Platform } from 'react-native';

import { deletePushToken as deletePushTokenApi, registerPushToken as registerPushTokenApi } from '@/sync/api/session/apiPush';
import type { Encryption } from '@/sync/encryption/encryption';
import type { Profile } from '@/sync/domains/profiles/profile';
import { profileParse, tryParseProfile } from '@/sync/domains/profiles/profile';
import { settingsParse, SUPPORTED_SCHEMA_VERSION } from '@/sync/domains/settings/settings';
import type { AccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';
import {
    normalizeAccountSettingsForLocalStorage,
    openAccountSettingsStoredContent,
} from '@/sync/domains/settings/accountSettingsNormalization';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { HappyError } from '@/utils/errors/errors';
import {
    areServerProfileIdentifiersEquivalent,
    listServerProfiles,
    resolveServerProfileScopeId,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { serverFetch } from '@/sync/http/client';
import { isExpoPushNotificationChannelEnabled } from '@happier-dev/protocol';
import {
    loadRegisteredExpoPushTokenState,
    saveExpoPushTokenGeneration,
    saveLastRegisteredExpoPushToken,
} from '@/sync/domains/state/pushTokenRegistration';
import {
    readExpoPushToken,
    readPushPermission,
    subscribeExpoPushTokenChanges,
} from '@/activity/notifications/permission/pushNotificationAccess';
import { loadAccountSettings } from '@/sync/domains/state/accountSettingsPersistence';
import { createAccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';
import { parseToken } from '@/utils/auth/parseToken';
import { createSessionRequestForExplicitServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope';
import { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import { readAccountSettingsBaseline } from '@/sync/engine/settings/accountSettingsBaseline';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { resolveServerScopedTransport } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerScopedTransport';
import { config } from '@/config';
import { log as appLog } from '@/log';

type HomeNotificationSettingsTarget = Readonly<{
    id: string;
    serverUrl: string;
    serverIdentityId?: string | null;
    legacyServerIds?: readonly string[];
    runtimeOrigin?: string;
}>;

function areCredentialsCurrent(
    expected: AuthCredentials,
    current: AuthCredentials | null,
): boolean {
    if (!current || current.token !== expected.token) return false;
    if ('secret' in expected || 'secret' in current) {
        return 'secret' in expected
            && 'secret' in current
            && expected.secret === current.secret;
    }
    if ('encryption' in expected || 'encryption' in current) {
        return 'encryption' in expected
            && 'encryption' in current
            && expected.encryption.publicKey === current.encryption.publicKey
            && expected.encryption.machineKey === current.encryption.machineKey;
    }
    return true;
}

async function isPushRegistrationStillCurrent(params: Readonly<{
    profile: ServerProfile;
    profileScopeId: string;
    credentials: AuthCredentials;
    isActiveProfile: boolean;
    readAccountSettings: () => unknown;
}>): Promise<boolean> {
    const currentProfile = listServerProfiles().find((candidate) => (
        areServerProfileIdentifiersEquivalent(resolveServerProfileScopeId(candidate), params.profileScopeId)
        && candidate.serverUrl === params.profile.serverUrl
    ));
    if (!currentProfile) return false;
    const currentCredentials = await TokenStorage.getCredentialsForServerUrl(
        currentProfile.serverUrl,
        { serverId: resolveServerProfileScopeId(currentProfile) },
    ).catch(() => null);
    if (!currentCredentials || !areCredentialsCurrent(params.credentials, currentCredentials)) return false;
    if (params.isActiveProfile) {
        return isExpoPushNotificationChannelEnabled(params.readAccountSettings());
    }
    try {
        const scope = createAccountSettingsScope(
            resolveServerProfileScopeId(currentProfile),
            parseToken(currentCredentials.token),
        );
        if (!scope) return true;
        const cached = loadAccountSettings(scope);
        return cached.version === null
            || isExpoPushNotificationChannelEnabled(cached.settings);
    } catch {
        return true;
    }
}

/**
 * Resolve one Home's notification consent.
 *
 * The Home's live Account Settings are authoritative and are read through an
 * explicit Home-targeted request (never the active-server transport). Only
 * when that live read is unavailable — offline, unsupported, or a fail-closed
 * unreadable envelope — does the Home's canonical persisted scoped projection
 * apply as the last-known value. Null means neither source is available; the
 * caller then applies the product default and records the registration as
 * provisional.
 */
export async function fetchHomeNotificationSettings(
    home: HomeNotificationSettingsTarget,
    credentials: AuthCredentials,
): Promise<unknown | null> {
    // Live first: this Home answers for its own Account Settings through an
    // explicit Home-targeted request. The mode comes from that Home's endpoint;
    // it is never inferred from the credential or the envelope, and an E2EE
    // envelope without usable material fails closed instead of opening.
    try {
        const request = createSessionRequestForExplicitServerScope({
            serverUrl: home.serverUrl,
            ...(home.runtimeOrigin ? { runtimeOrigin: home.runtimeOrigin } : {}),
            token: credentials.token,
        });
        const encryptionMode = await fetchAccountEncryptionMode(credentials, { request });
        const accountMode = encryptionMode.mode === 'plain' ? 'plain' : 'e2ee';
        const encryption = accountMode === 'e2ee'
            ? await createEncryptionFromAuthCredentials(credentials)
            : null;
        const baseline = await readAccountSettingsBaseline({
            request,
            credentials,
            encryption,
            accountMode,
        });
        return baseline.raw ?? {};
    } catch {
        // Live read unavailable: fall through to the last-known scoped value.
    }
    try {
        const serverId = resolveServerProfileScopeId(home);
        const scope = createAccountSettingsScope(serverId, parseToken(credentials.token));
        if (!scope) return null;
        const cached = loadAccountSettings(scope);
        return cached.version === null ? null : cached.settings;
    } catch {
        return null;
    }
}

export async function handleUpdateAccountSocketUpdate(params: {
    accountUpdate: any;
    updateCreatedAt: number;
    currentProfile: Profile;
    encryption: Encryption | null;
    settingsSecretsKey?: Uint8Array | null;
    settingsSecretsReadKeys?: ReadonlyArray<Uint8Array | null | undefined>;
    applyProfile: (profile: Profile) => void;
    applySettings: (settings: any, version: number) => void;
    settingsScope?: AccountSettingsScope | null;
    applySettingsForScope?: (scope: AccountSettingsScope, settings: any, version: number) => void;
    getLocalSettings?: () => unknown;
    log: { log: (message: string) => void };
}): Promise<void> {
    const {
        accountUpdate,
        updateCreatedAt,
        currentProfile,
        encryption,
        applyProfile,
        applySettings,
        settingsScope,
        applySettingsForScope,
        getLocalSettings,
        log,
    } = params;
    const settingsSecretsKey = params.settingsSecretsKey ?? null;
    const settingsSecretsReadKeys = params.settingsSecretsReadKeys
        ?? (settingsSecretsKey ? [settingsSecretsKey] : []);

    const applyAccountSettings = (settings: any, version: number) => {
        if (settingsScope && applySettingsForScope) {
            applySettingsForScope(settingsScope, settings, version);
            return;
        }
        applySettings(settings, version);
    };

    const hasQualifiedConnectedAccountsUpdate =
        accountUpdate.connectedAccountsV4 !== undefined
        || accountUpdate.connectedAccountGroupsV4 !== undefined;
    const qualifiedConnectedAccountsProjection = hasQualifiedConnectedAccountsUpdate
        ? tryParseProfile({
            ...currentProfile,
            connectedAccountsV4: accountUpdate.connectedAccountsV4 !== undefined
                ? accountUpdate.connectedAccountsV4
                : currentProfile.connectedAccountsV4,
            connectedAccountGroupsV4: accountUpdate.connectedAccountGroupsV4 !== undefined
                ? accountUpdate.connectedAccountGroupsV4
                : currentProfile.connectedAccountGroupsV4,
        })
        : null;
    if (hasQualifiedConnectedAccountsUpdate && !qualifiedConnectedAccountsProjection) {
        log.log('Ignored invalid Connected Accounts V4 profile update');
    }

    // Build updated profile with new data.
    const updatedProfile: Profile = {
        ...currentProfile,
        firstName: accountUpdate.firstName !== undefined ? accountUpdate.firstName : currentProfile.firstName,
        lastName: accountUpdate.lastName !== undefined ? accountUpdate.lastName : currentProfile.lastName,
        username: accountUpdate.username !== undefined ? accountUpdate.username : currentProfile.username,
        avatar: accountUpdate.avatar !== undefined ? accountUpdate.avatar : currentProfile.avatar,
        linkedProviders:
            accountUpdate.linkedProviders !== undefined ? accountUpdate.linkedProviders : currentProfile.linkedProviders,
        connectedServices:
            accountUpdate.connectedServices !== undefined
                ? accountUpdate.connectedServices
                : currentProfile.connectedServices,
        connectedServicesV2:
            accountUpdate.connectedServicesV2 !== undefined
                ? accountUpdate.connectedServicesV2
                : currentProfile.connectedServicesV2,
        connectedServiceCredentialRevisionsV1:
            accountUpdate.connectedServiceCredentialRevisionsV1 !== undefined
                ? accountUpdate.connectedServiceCredentialRevisionsV1
                : currentProfile.connectedServiceCredentialRevisionsV1,
        connectedAccountsV4:
            qualifiedConnectedAccountsProjection?.connectedAccountsV4
                ?? currentProfile.connectedAccountsV4,
        connectedAccountGroupsV4:
            qualifiedConnectedAccountsProjection?.connectedAccountGroupsV4
                ?? currentProfile.connectedAccountGroupsV4,
        timestamp: updateCreatedAt, // Update timestamp to latest
    };

    // Apply the updated profile to storage
    applyProfile(updatedProfile);

    const applyStoredAccountSettings = (paramsForSettings: Readonly<{
        content: unknown;
        version: number;
        source: 'v1' | 'v2';
    }>): void => {
        const pushWasEnabled = isExpoPushNotificationChannelEnabled(getLocalSettings?.());
        const opened = openAccountSettingsStoredContent({
            content: paramsForSettings.content,
            encryption,
            ...(paramsForSettings.source === 'v1' ? { expectedMode: 'e2ee' as const } : {}),
        });
        const parsedSettings = settingsParse(opened.raw ?? {});
        const settingsSchemaVersion = parsedSettings.schemaVersion ?? 1;
        if (settingsSchemaVersion > SUPPORTED_SCHEMA_VERSION) {
            console.warn(
                `⚠️ Received settings schema v${settingsSchemaVersion}, `
                    + `we support v${SUPPORTED_SCHEMA_VERSION}. Update app for full functionality.`,
            );
        }
        const normalizedSettings = normalizeAccountSettingsForLocalStorage({
            raw: opened.raw,
            mode: opened.mode,
            settingsSecretsKey,
            settingsSecretsReadKeys,
            localSettings: getLocalSettings?.(),
        });
        applyAccountSettings(normalizedSettings, paramsForSettings.version);
        if (pushWasEnabled !== isExpoPushNotificationChannelEnabled(normalizedSettings)) {
            schedulePushTokenReconciliation();
        }
        log.log(
            paramsForSettings.source === 'v2'
                ? `📋 Settings synced from server (v2, version ${paramsForSettings.version})`
                : `📋 Settings synced from server (schema v${settingsSchemaVersion}, version ${paramsForSettings.version})`,
        );
    };

    // Handle settings updates (new for profile sync)
    if (accountUpdate.settingsV2?.content || accountUpdate.settingsV2?.content === null) {
        try {
            applyStoredAccountSettings({
                content: accountUpdate.settingsV2.content,
                version: Number(accountUpdate.settingsV2.version ?? 0),
                source: 'v2',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.log(`Failed to process settings v2 update: ${message}`);
        }
    } else if (accountUpdate.settings?.value) {
        try {
            applyStoredAccountSettings({
                content: {
                    t: 'encrypted',
                    c: accountUpdate.settings.value,
                },
                version: accountUpdate.settings.version,
                source: 'v1',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.log(`Failed to process settings update: ${message}`);
            // Don't crash on settings sync errors, just log
        }
    }
}

export async function fetchAndApplyProfile(params: {
    credentials: AuthCredentials;
    applyProfile: (profile: Profile) => void;
    shouldContinue?: () => boolean;
}): Promise<void> {
    const { credentials, applyProfile } = params;
    const shouldContinue = params.shouldContinue ?? (() => true);
    if (!shouldContinue()) return;

    const response = await serverFetch('/v1/account/profile', {
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
        },
    }, { includeAuth: false });
    if (!shouldContinue()) return;

    if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
            throw new HappyError(`Failed to fetch profile (${response.status})`, false);
        }
        throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    const data = await response.json();
    const parsedProfile = profileParse(data);
    if (!shouldContinue()) return;

    // Apply profile to storage
    applyProfile(parsedProfile);
}

/**
 * Read the live account settings without giving this sync-engine module a load-time dependency on
 * the store graph. An unreadable store (early boot, isolated test) must not silently disable push,
 * so it degrades to the schema default rather than to "disabled".
 */
function readAccountSettingsFromStore(): unknown {
    try {
        const { storage } = require('@/sync/domains/state/storage') as typeof import('@/sync/domains/state/storage');
        return storage.getState().settings;
    } catch {
        return null;
    }
}

type HomePushTransportProfile = Pick<ServerProfile,
    | 'serverUrl'
    | 'canonicalServerUrl'
    | 'publicServerUrl'
    | 'serverIdentityId'
    | 'irohEndpoint'
    | 'connectionDescriptorRevision'
>;

async function deletePushTokenThroughHomeTransport(params: Readonly<{
    credentials: AuthCredentials;
    token: string;
    transport: Awaited<ReturnType<typeof resolveServerScopedTransport>>;
}>): Promise<boolean> {
    try {
        await deletePushTokenApi(params.credentials, params.token, {
            apiEndpoint: params.transport.canonicalServerUrl,
            runtimeOrigin: params.transport.runtimeOrigin,
        });
        return true;
    } catch {
        return false;
    }
}

export async function unregisterPushTokenForHomeBestEffort(params: Readonly<{
    credentials: AuthCredentials;
    token: string | null | undefined;
    serverUrl: string;
    profile?: HomePushTransportProfile;
}>): Promise<boolean> {
    const token = String(params.token ?? '').trim();
    const serverUrl = String(params.serverUrl ?? '').trim();
    if (!token || !serverUrl) return true;
    const transport = await resolveServerScopedTransport({
        profile: params.profile ?? { serverUrl },
        credentials: params.credentials,
    }).catch(() => null);
    if (!transport) return false;
    try {
        return await deletePushTokenThroughHomeTransport({
            credentials: params.credentials,
            token,
            transport,
        });
    } finally {
        await transport.release().catch(() => undefined);
    }
}

export async function registerPushTokenIfAvailable(params: {
    credentials?: AuthCredentials | null;
    log: { log: (message: string) => void };
    getAccountSettings?: () => unknown;
    getHomeAccountSettings?: (
        home: HomeNotificationSettingsTarget,
        credentials: AuthCredentials,
    ) => Promise<unknown | null | undefined>;
}): Promise<void> {
    const { credentials, log } = params;
    if (Platform.OS === 'web') return;

    const readAccountSettings = params.getAccountSettings ?? readAccountSettingsFromStore;
    const getHomeAccountSettings = params.getHomeAccountSettings ?? fetchHomeNotificationSettings;
    const permission = await readPushPermission();
    if (!permission.ok) {
        log.log(`Push notification runtime unavailable (${permission.reason}); skipping push token registration`);
        return;
    }
    if (!permission.permission.granted) {
        log.log(`Push notification permission not granted (${permission.permission.status}); skipping push token registration`);
        return;
    }
    const tokenOutcome = await readExpoPushToken();
    if (!tokenOutcome.ok) {
        log.log(`Unable to read an Expo push token (${tokenOutcome.reason}); skipping push token registration`);
        return;
    }

    try {
        const profiles = listServerProfiles();
        const token = tokenOutcome.token;
        const previousState = loadRegisteredExpoPushTokenState();
        const cleanupPendingToken = previousState.current && previousState.current !== token
            ? previousState.current
            : previousState.cleanupPending;
        saveExpoPushTokenGeneration({ current: token, cleanupPending: cleanupPendingToken });

        let activeServerId: string | null = null;
        let activeServerUrl: string | null = null;
        try {
            const activeServer = getActiveServerSnapshot();
            activeServerId = String(activeServer.serverId ?? '').trim() || null;
            activeServerUrl = String(activeServer.serverUrl ?? '').trim().replace(/\/+$/, '') || null;
        } catch {
            activeServerId = null;
            activeServerUrl = null;
        }

        let didRegisterAnyServer = false;
        let didEnabledRegistrationFail = false;
        let didTokenCleanupFail = false;
        let didProcessAnyHome = false;
        let didEnumerateActiveServer = false;

        for (const profile of profiles) {
            const profileScopeId = resolveServerProfileScopeId(profile);
            const isActiveProfile = activeServerId !== null
                && areServerProfileIdentifiersEquivalent(profileScopeId, activeServerId);
            didEnumerateActiveServer ||= isActiveProfile;

            let serverCredentials = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, {
                serverId: profileScopeId,
            }).catch(() => null);
            if (!serverCredentials && isActiveProfile && credentials) serverCredentials = credentials;
            if (!serverCredentials) continue;
            didProcessAnyHome = true;

            const transport = await resolveServerScopedTransport({ profile, credentials: serverCredentials }).catch(() => null);
            if (!transport) {
                didEnabledRegistrationFail = true;
                continue;
            }
            try {
                // Focused settings include the user's synchronous local write even while its
                // server flush is pending. Other Homes have no active local writer, so they
                // continue through their explicit scoped read/cache owner.
                let homeSettings: unknown = isActiveProfile ? readAccountSettings() : undefined;
                let provisional = false;
                if (!isActiveProfile || homeSettings == null) {
                    try {
                        homeSettings = await getHomeAccountSettings({
                            id: profile.id,
                            serverUrl: transport.canonicalServerUrl,
                            serverIdentityId: profile.serverIdentityId,
                            legacyServerIds: profile.legacyServerIds,
                            runtimeOrigin: transport.runtimeOrigin,
                        }, serverCredentials);
                    } catch {
                        homeSettings = undefined;
                    }
                }
                if (homeSettings == null) {
                    homeSettings = isActiveProfile ? readAccountSettings() : {};
                    provisional = true;
                }

                if (!isExpoPushNotificationChannelEnabled(homeSettings)) {
                    log.log(`Push notifications disabled for Home ${profile.serverUrl}; skipping push token registration`);
                    const cleanedCurrentToken = await deletePushTokenThroughHomeTransport({
                        credentials: serverCredentials,
                        token,
                        transport,
                    });
                    didTokenCleanupFail = didTokenCleanupFail || !cleanedCurrentToken;
                    if (cleanupPendingToken && cleanupPendingToken !== token) {
                        const cleanedPendingToken = await deletePushTokenThroughHomeTransport({
                            credentials: serverCredentials,
                            token: cleanupPendingToken,
                            transport,
                        });
                        didTokenCleanupFail = didTokenCleanupFail || !cleanedPendingToken;
                    }
                    continue;
                }

                try {
                    const registrationBasis = {
                        profile,
                        profileScopeId,
                        credentials: serverCredentials,
                        isActiveProfile,
                        readAccountSettings,
                    };
                    if (!await isPushRegistrationStillCurrent(registrationBasis)) continue;
                    await registerPushTokenApi(serverCredentials, token, {
                        serverId: profileScopeId,
                        apiEndpoint: transport.canonicalServerUrl,
                        runtimeOrigin: transport.runtimeOrigin,
                        clientServerUrl: transport.canonicalServerUrl,
                        retry: 'none',
                    });
                    if (!await isPushRegistrationStillCurrent(registrationBasis)) {
                        const compensated = await deletePushTokenThroughHomeTransport({
                            credentials: serverCredentials,
                            token,
                            transport,
                        });
                        didTokenCleanupFail = didTokenCleanupFail || !compensated;
                        continue;
                    }
                    didRegisterAnyServer = true;
                    if (cleanupPendingToken && cleanupPendingToken !== token) {
                        const cleanedPendingToken = await deletePushTokenThroughHomeTransport({
                            credentials: serverCredentials,
                            token: cleanupPendingToken,
                            transport,
                        });
                        didTokenCleanupFail = didTokenCleanupFail || !cleanedPendingToken;
                    }
                    if (provisional) log.log(`Push token registration provisional for Home ${profile.serverUrl}`);
                } catch (error) {
                    didEnabledRegistrationFail = true;
                    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
                    log.log(`Failed to register push token for ${profile.serverUrl}: ${message}`);
                }
            } finally {
                await transport.release().catch(() => undefined);
            }
        }

        // Compatibility for a focused Home created before profile adoption. Once
        // the profile exists, its per-Home decision above is terminal for this cycle.
        if (!didEnumerateActiveServer && activeServerUrl && credentials) {
            didProcessAnyHome = true;
            const transport = await resolveServerScopedTransport({
                profile: { serverUrl: activeServerUrl },
                credentials,
            }).catch(() => null);
            if (!transport) {
                didEnabledRegistrationFail = true;
            } else {
                try {
                    if (!isExpoPushNotificationChannelEnabled(readAccountSettings())) {
                        log.log(`Push notifications disabled for Home ${activeServerUrl}; skipping push token registration`);
                        const cleanedCurrentToken = await deletePushTokenThroughHomeTransport({ credentials, token, transport });
                        didTokenCleanupFail = didTokenCleanupFail || !cleanedCurrentToken;
                        if (cleanupPendingToken && cleanupPendingToken !== token) {
                            const cleanedPendingToken = await deletePushTokenThroughHomeTransport({
                                credentials,
                                token: cleanupPendingToken,
                                transport,
                            });
                            didTokenCleanupFail = didTokenCleanupFail || !cleanedPendingToken;
                        }
                    } else {
                        try {
                            await registerPushTokenApi(credentials, token, {
                                apiEndpoint: transport.canonicalServerUrl,
                                runtimeOrigin: transport.runtimeOrigin,
                                clientServerUrl: transport.canonicalServerUrl,
                                retry: 'none',
                            });
                            didRegisterAnyServer = true;
                            if (cleanupPendingToken && cleanupPendingToken !== token) {
                                const cleanedPendingToken = await deletePushTokenThroughHomeTransport({
                                    credentials,
                                    token: cleanupPendingToken,
                                    transport,
                                });
                                didTokenCleanupFail = didTokenCleanupFail || !cleanedPendingToken;
                            }
                        } catch (error) {
                            didEnabledRegistrationFail = true;
                            const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
                            log.log(`Failed to register push token for ${activeServerUrl}: ${message}`);
                        }
                    }
                } finally {
                    await transport.release().catch(() => undefined);
                }
            }
        }

        if (didProcessAnyHome && !didEnabledRegistrationFail && !didTokenCleanupFail) {
            saveLastRegisteredExpoPushToken(token);
        }
        log.log(didRegisterAnyServer
            ? 'Push token registered successfully'
            : 'Failed to register push token: no Home registration succeeded');
    } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        log.log('Failed to register push token: ' + message);
    }
}

let devicePushReconcilerStarted = false;
let devicePushReconcileTimer: ReturnType<typeof setTimeout> | null = null;
let devicePushReconcileInFlight = false;
let devicePushReconcileAgain = false;
let expoPushTokenChangeUnsubscribe: (() => void) | null = null;
let expoPushTokenChangeSubscriptionStart: Promise<void> | null = null;

function ensureExpoPushTokenChangeSubscription(): void {
    if (expoPushTokenChangeUnsubscribe || expoPushTokenChangeSubscriptionStart) return;
    expoPushTokenChangeSubscriptionStart = subscribeExpoPushTokenChanges(() => {
        // The event payload is not registration authority. Re-read permission and
        // the current Expo token through the canonical reconciler.
        schedulePushTokenReconciliation();
    }).then((unsubscribe) => {
        if (!unsubscribe) return;
        if (!devicePushReconcilerStarted) {
            unsubscribe();
            return;
        }
        expoPushTokenChangeUnsubscribe = unsubscribe;
    }).catch(() => undefined).finally(() => {
        expoPushTokenChangeSubscriptionStart = null;
    });
}

async function runDevicePushTokenReconciliation(): Promise<void> {
    if (!devicePushReconcilerStarted || devicePushReconcileInFlight) return;
    devicePushReconcileInFlight = true;
    try {
        if (!__DEV__ || config.enableDevPushTokenRegistration === true) {
            await registerPushTokenIfAvailable({ credentials: null, log: appLog });
        }
    } finally {
        devicePushReconcileInFlight = false;
        if (devicePushReconcilerStarted && devicePushReconcileAgain) {
            devicePushReconcileAgain = false;
            schedulePushTokenReconciliation();
        }
    }
}

export function startPushTokenReconciliation(): void {
    devicePushReconcilerStarted = true;
    ensureExpoPushTokenChangeSubscription();
}

export function stopPushTokenReconciliation(): void {
    devicePushReconcilerStarted = false;
    devicePushReconcileAgain = false;
    if (devicePushReconcileTimer) {
        clearTimeout(devicePushReconcileTimer);
        devicePushReconcileTimer = null;
    }
    expoPushTokenChangeUnsubscribe?.();
    expoPushTokenChangeUnsubscribe = null;
}

export function schedulePushTokenReconciliation(): void {
    if (!devicePushReconcilerStarted) return;
    if (devicePushReconcileInFlight) {
        devicePushReconcileAgain = true;
        return;
    }
    if (devicePushReconcileTimer) return;
    devicePushReconcileTimer = setTimeout(() => {
        devicePushReconcileTimer = null;
        void runDevicePushTokenReconciliation();
    }, 0);
}
