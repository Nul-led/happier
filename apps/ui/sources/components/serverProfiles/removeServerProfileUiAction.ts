import { TokenStorage } from '@/auth/storage/tokenStorage';
import type { AuthCredentialLifecycleResult } from '@/auth/context/AuthContext';
import { guardAccountEncryptionFirstKeyCredentialMutation } from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';
import {
    getServerProfileById,
    removeServerProfile,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import { loadExpoPushTokensToUnregister } from '@/sync/domains/state/pushTokenRegistration';
import { unregisterPushTokenForHomeBestEffort } from '@/sync/engine/account/syncAccount';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { resolveHomeDisplayLabel } from '@/components/settings/server/homeDisplayName';

import { disconnectThisComputerBeforeForgettingHome } from './disconnectThisComputerFromHome';

/** `kept`: the Home was not forgotten because this computer could not stop serving it (R15 c). */
export type ServerProfileRemovalResult = AuthCredentialLifecycleResult | Readonly<{ kind: 'kept' }>;

/**
 * The one owner that makes the app forget a Home: this computer stops serving it first (R15 c,
 * R13C-P3-5 — every removal path, not only Settings), then its credentials and profile go.
 * `thisComputer: 'disconnected'` is for the one caller that already disconnected earlier in its own
 * flow (the Personal Home erase, which must disconnect before any data is destroyed).
 */
export async function removeServerProfileUiAction(params: Readonly<{
    profileId: string;
    serverUrl: string;
    thisComputer?: 'disconnect' | 'disconnected';
}>): Promise<ServerProfileRemovalResult> {
    const profileId = String(params.profileId ?? '').trim();
    if (!profileId || profileId === 'active') {
        return { kind: 'completed' };
    }

    const serverUrl = String(params.serverUrl ?? '').trim();
    const profile = getServerProfileById(profileId);
    const profileScopeId = profile ? resolveServerProfileScopeId(profile) : profileId;
    if (serverUrl && params.thisComputer !== 'disconnected') {
        const mayForget = await disconnectThisComputerBeforeForgettingHome({
            serverUrl,
            serverIdentityId: profile?.serverIdentityId ?? null,
            label: resolveHomeDisplayLabel(profile, profileId),
        });
        if (!mayForget) return { kind: 'kept' };
    }
    if (serverUrl) {
        const guard =
            await guardAccountEncryptionFirstKeyCredentialMutation({
                serverUrl,
                serverId: profileScopeId,
            });
        if (guard.kind !== 'allowed') {
            return guard;
        }
    }

    const pushCleanupTargets: Array<Parameters<typeof unregisterPushTokenForHomeBestEffort>[0]> = [];
    if (serverUrl) {
        const credentials = await TokenStorage.getCredentialsForServerUrl(serverUrl, { serverId: profileScopeId });
        if (credentials) {
            for (const pushToken of loadExpoPushTokensToUnregister()) {
                pushCleanupTargets.push({
                    credentials,
                    token: pushToken,
                    serverUrl,
                    ...(profile ? { profile } : {}),
                });
            }
        }
        const removed =
            await TokenStorage.removeCredentialsForServerUrl(
                serverUrl,
                { serverId: profileScopeId },
            );
        if (!removed) {
            throw new Error('Failed to remove server credentials');
        }
    }

    if (getServerProfileById(profileId)) {
        await removeServerProfile(profileId);
    }
    fireAndForget(Promise.allSettled(
        pushCleanupTargets.map(async (target) =>
            await unregisterPushTokenForHomeBestEffort(target)),
    ), { tag: 'removeServerProfileUiAction.unregisterPushToken' });
    return { kind: 'completed' };
}
