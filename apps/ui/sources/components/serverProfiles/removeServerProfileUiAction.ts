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

export async function removeServerProfileUiAction(params: Readonly<{
    profileId: string;
    serverUrl: string;
}>): Promise<AuthCredentialLifecycleResult> {
    const profileId = String(params.profileId ?? '').trim();
    if (!profileId || profileId === 'active') {
        return { kind: 'completed' };
    }

    const serverUrl = String(params.serverUrl ?? '').trim();
    const profile = getServerProfileById(profileId);
    const profileScopeId = profile ? resolveServerProfileScopeId(profile) : profileId;
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

    removeServerProfile(profileId);
    await Promise.allSettled(
        pushCleanupTargets.map(async (target) =>
            await unregisterPushTokenForHomeBestEffort(target)),
    );
    return { kind: 'completed' };
}
