import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import type { UserProfile } from '@/sync/domains/social/friendTypes';
import { getFriendsList } from '@/sync/api/social/apiFriends';
import type { ServerFetch } from '@/sync/http/client';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { resolveRuntimeFeatureDecisionOrThrow } from '@/sync/domains/features/featureDecisionInputs';

export async function fetchAndApplyFriends(params: {
    credentials: AuthCredentials | null | undefined;
    applyFriends: (friends: UserProfile[]) => void;
    request?: ServerFetch;
    serverId?: string;
    shouldContinue?: () => boolean;
}): Promise<void> {
    const shouldContinue = params.shouldContinue ?? (() => true);
    if (!params.credentials) {
        return;
    }
    if (!shouldContinue()) return;

    // Standalone engine callers retain the historical selected-Home default;
    // Sync always supplies its prepared target with the matching request.
    const serverId = String(params.serverId ?? getActiveServerSnapshot().serverId ?? '').trim();
    if (!serverId) return;
    const decision = await resolveRuntimeFeatureDecisionOrThrow({
        featureId: 'social.friends',
        serverId,
    });

    if (decision.state !== 'enabled') {
        return;
    }
    if (!shouldContinue()) return;

    const friendsList = await getFriendsList(params.credentials, {
        request: params.request,
        retry: 'none',
    });
    if (!shouldContinue()) return;
    params.applyFriends(friendsList);
}
