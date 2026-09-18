import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { UserProfile } from '@/sync/domains/social/friendTypes';
import { getFriendsList } from '@/sync/api/social/apiFriends';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { resolveRuntimeFeatureDecisionOrThrow } from '@/sync/domains/features/featureDecisionInputs';

export async function fetchAndApplyFriends(params: {
    credentials: AuthCredentials | null | undefined;
    applyFriends: (friends: UserProfile[]) => void;
    shouldContinue?: () => boolean;
}): Promise<void> {
    const shouldContinue = params.shouldContinue ?? (() => true);
    if (!params.credentials) {
        return;
    }
    if (!shouldContinue()) return;

    const activeServer = getActiveServerSnapshot();
    const decision = await resolveRuntimeFeatureDecisionOrThrow({
        featureId: 'social.friends',
        serverId: activeServer.serverId,
    });

    if (decision.state !== 'enabled') {
        return;
    }
    if (!shouldContinue()) return;

    const friendsList = await getFriendsList(params.credentials);
    if (!shouldContinue()) return;
    params.applyFriends(friendsList);
}
