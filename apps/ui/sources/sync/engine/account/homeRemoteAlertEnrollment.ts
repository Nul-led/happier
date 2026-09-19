import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import {
    areDeviceRemoteAlertPoliciesEqual,
    deriveDeviceRemoteAlertPolicyV1,
    type DeviceRemoteAlertNativeSupport,
} from '@/activity/delivery/deriveDeviceRemoteAlertPolicy';
import { fetchPushTokensRemoteAlertProjection, registerPushToken } from '@/sync/api/session/apiPush';
import { readLocalAttentionSettingsMutationToken } from '@/sync/domains/state/settingsPersistence';
import { readAccountSettingsPersistenceMutationToken } from '@/sync/domains/state/accountSettingsPersistence';
import { createServerRequestForExplicitServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { fetchAccountEncryptionCurrentness } from '@/sync/api/account/apiAccountEncryptionMode';

import { prepareActivityNotificationStorage, readActivityNotificationCapabilities } from '../../../../modules/happier-activity-notifications';
import { Platform } from 'react-native';
import {
    buildHomeRemoteAlertPreparedCredential,
    persistHomeRemoteAlertPreparedContext,
} from './homeRemoteAlertPreparedContext';

/**
 * Read this build's shipped native alert consumer.
 *
 * The optional native module is absent in web, desktop, older clients and most
 * test runtimes; an unavailable module means this device enrolls nothing rather
 * than claiming a consumer it does not have.
 */
export function readDeviceRemoteAlertNativeSupport(): DeviceRemoteAlertNativeSupport | null {
    try {
        if (!prepareActivityNotificationStorage()) return null;
        const capabilities = readActivityNotificationCapabilities();
        return capabilities ? { platform: capabilities.platform } : null;
    } catch {
        return null;
    }
}

/**
 * Reconcile this device's remote-alert enrollment for one exact Home, inside the
 * canonical push-token registration cycle (Lane 09C §10.4 C5b).
 *
 * It owns no schedule, token lifecycle or currentness rule of its own: the
 * caller supplies the exact Home transport, the already-registered token and the
 * existing currentness check. The write uses the negotiated V2 projection's
 * immutable row id, so a deleted/recreated registration can never be resurrected
 * and no registration id is ever fabricated. A Home that does not answer the
 * `projectionVersion=2` request is a predecessor: ordinary token registration
 * stands and this leg stays unavailable.
 */
export async function reconcileHomeRemoteAlertEnrollment(params: Readonly<{
    credentials: AuthCredentials;
    token: string;
    apiEndpoint: string;
    runtimeOrigin?: string;
    serverId?: string;
    accountId: string;
    accountSettings: unknown;
    /**
     * False when this cycle could not read the Home's Account settings and fell
     * back to product defaults. Unknown consent may neither publish a policy nor
     * withdraw one this device published from a real reading.
     */
    accountConsentKnown: boolean;
    localSettings: unknown;
    readCurrentPolicyInputs: () => Promise<Readonly<{
        accountSettings: unknown;
        localSettings: unknown;
    }> | null>;
    scheduleReconciliation: () => void;
    isStillCurrent: () => Promise<boolean>;
    log: { log: (message: string) => void };
}>): Promise<void> {
    // Without a native consumer this device never enrolled and has nothing to
    // publish or clear, so it also must not spend a request probing the Home.
    const serverId = params.serverId;
    const accountId = params.accountId;
    if (!params.accountConsentKnown || !serverId || !accountId) return;
    // Captured beside the policy inputs this cycle reads, in the same tick.
    // `isStillCurrent` answers for credentials, Home profile and Home push
    // consent; these persisted generations also tell when the device or exact
    // Account preview/quiet-hours policy moved while the cycle was in flight.
    const capturedPolicyGeneration = readLocalAttentionSettingsMutationToken();
    const accountSettingsScope = { serverId, accountId };
    const capturedAccountSettingsGeneration = readAccountSettingsPersistenceMutationToken(accountSettingsScope);
    const storageReady = (() => {
        try {
            const root = prepareActivityNotificationStorage();
            return typeof root === 'string' && root.length > 0;
        } catch { return false; }
    })();

    const request = createServerRequestForExplicitServerScope({
        serverUrl: params.apiEndpoint,
        ...(params.runtimeOrigin ? { runtimeOrigin: params.runtimeOrigin } : {}),
        token: params.credentials.token,
    });
    const projection = await fetchPushTokensRemoteAlertProjection(params.credentials, request).catch(() => null);
    if (!projection) return;

    const row = projection.tokens.find((candidate) => candidate.token === params.token);
    if (!row) return;
    const writePolicy = async (policy: ReturnType<typeof deriveDeviceRemoteAlertPolicyV1>): Promise<void> => {
        await registerPushToken(params.credentials, params.token, {
            serverId,
            apiEndpoint: params.apiEndpoint,
            ...(params.runtimeOrigin ? { runtimeOrigin: params.runtimeOrigin } : {}),
            retry: 'none',
            remoteAlerts: { registrationId: row.id, policy },
        });
    };
    const publishPolicy = async (policy: ReturnType<typeof deriveDeviceRemoteAlertPolicyV1>): Promise<void> => {
        if (!await params.isStillCurrent()) return;
        if (areDeviceRemoteAlertPoliciesEqual(row.remoteAlerts, policy)) return;
        await writePolicy(policy);
    };
    const hasPreparedContextPolicyMoved = (): boolean => (
        readLocalAttentionSettingsMutationToken() !== capturedPolicyGeneration
        || readAccountSettingsPersistenceMutationToken(accountSettingsScope) !== capturedAccountSettingsGeneration
    );
    /**
     * The captured policy inputs are no longer current, so nothing derived
     * from them may reach the Home or the native projection. Drop this
     * cycle's prepared generation and re-enter the one existing reconciler,
     * which coalesces this request with the mutation's own trigger.
     */
    const discardStaleCycle = (): void => {
        persistHomeRemoteAlertPreparedContext({
            kind: 'remove', serverId, accountId, registrationId: row.id,
        });
        params.scheduleReconciliation();
    };
    if (!storageReady || (Platform.OS !== 'ios' && Platform.OS !== 'android')
        || projection.accountRemoteAlerts.status !== 'current') {
        persistHomeRemoteAlertPreparedContext({
            kind: 'remove',
            serverId,
            accountId,
            registrationId: row.id,
        });
        await publishPolicy(null).catch(() => undefined);
        return;
    }
    const provisionalSupport: DeviceRemoteAlertNativeSupport = { platform: Platform.OS };
    const provisionalPolicy = deriveDeviceRemoteAlertPolicyV1({
        accountSettings: params.accountSettings as Readonly<Record<string, unknown>> | null | undefined,
        localSettings: params.localSettings as Readonly<Record<string, unknown>> | null | undefined,
        nativeSupport: provisionalSupport,
    });
    if (!provisionalPolicy || !await params.isStillCurrent()) {
        persistHomeRemoteAlertPreparedContext({
            kind: 'remove',
            serverId,
            accountId,
            registrationId: row.id,
        });
        await publishPolicy(null).catch(() => undefined);
        return;
    }
    const accountEncryption = await fetchAccountEncryptionCurrentness(params.credentials, { request }).catch(() => null);
    const preparedCredential = accountEncryption
        ? buildHomeRemoteAlertPreparedCredential(params.credentials, accountEncryption.mode)
        : null;
    const encryptionReady = accountEncryption?.mode === 'plain'
        || accountEncryption?.recipientEnvelopeReadiness?.status === 'available';
    if (!accountEncryption || !encryptionReady || !preparedCredential
        || !await params.isStillCurrent()) {
        persistHomeRemoteAlertPreparedContext({
            kind: 'remove', serverId, accountId, registrationId: row.id,
        });
        await publishPolicy(null).catch(() => undefined);
        return;
    }
    // The prepared context carries this cycle's preview ceiling into the native
    // consumer, so a device policy that moved while the Home answered must never
    // be written there — not even for the moment until the comparison below.
    if (hasPreparedContextPolicyMoved()) {
        discardStaleCycle();
        return;
    }
    if (!persistHomeRemoteAlertPreparedContext({
        kind: 'upsert',
        context: {
            v: 1,
            serverId,
            apiEndpoint: params.apiEndpoint,
            accountId,
            credential: preparedCredential,
            settingsVersion: projection.accountRemoteAlerts.settingsVersion,
            accountEncryptionVersion: accountEncryption.version,
            registrationId: row.id,
            pushToken: params.token,
            previewCeiling: provisionalPolicy.previewCeiling === 'account'
                ? 'include_preview'
                : provisionalPolicy.previewCeiling,
        },
    })) {
        await publishPolicy(null).catch(() => undefined);
        return;
    }
    // Credential/settings invalidation can run between the final pre-write
    // check and this atomic native projection write. Re-check immediately
    // after the write: a later mutation is handled by the canonical
    // subscriptions, while an earlier mutation must not be overwritten by a
    // stale context from this reconciliation.
    if (hasPreparedContextPolicyMoved()) {
        discardStaleCycle();
        return;
    }
    if (!await params.isStillCurrent()) {
        persistHomeRemoteAlertPreparedContext({
            kind: 'remove',
            serverId,
            accountId,
            registrationId: row.id,
        });
        await publishPolicy(null).catch(() => undefined);
        return;
    }
    const nativeSupport = readDeviceRemoteAlertNativeSupport();
    if (!nativeSupport) {
        persistHomeRemoteAlertPreparedContext({
            kind: 'remove',
            serverId,
            accountId,
            registrationId: row.id,
        });
        await publishPolicy(null).catch(() => undefined);
        return;
    }
    const desired = deriveDeviceRemoteAlertPolicyV1({
        accountSettings: params.accountSettings as Readonly<Record<string, unknown>> | null | undefined,
        localSettings: params.localSettings as Readonly<Record<string, unknown>> | null | undefined,
        nativeSupport,
    });
    try {
        if (hasPreparedContextPolicyMoved()) {
            discardStaleCycle();
            return;
        }
        if (!await params.isStillCurrent()) return;
        // The Account half of the policy still needs the Home's current answer.
        // The device half is decided by the generation, which — unlike this
        // reread — also answers when the Home cannot be reached at all.
        const currentInputs = await params.readCurrentPolicyInputs();
        if (hasPreparedContextPolicyMoved()) {
            discardStaleCycle();
            return;
        }
        if (!currentInputs) return;
        const currentDesired = deriveDeviceRemoteAlertPolicyV1({
            accountSettings: currentInputs.accountSettings as Readonly<Record<string, unknown>> | null | undefined,
            localSettings: currentInputs.localSettings as Readonly<Record<string, unknown>> | null | undefined,
            nativeSupport,
        });
        if (!areDeviceRemoteAlertPoliciesEqual(desired, currentDesired)) {
            discardStaleCycle();
            return;
        }
        if (!areDeviceRemoteAlertPoliciesEqual(row.remoteAlerts, desired)) {
            await writePolicy(desired);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.log.log(`Failed to publish remote alert enrollment for ${params.apiEndpoint}: ${message}`);
    }
}
