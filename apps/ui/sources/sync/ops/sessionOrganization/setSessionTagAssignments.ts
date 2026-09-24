import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { setSessionTagAssignments as setSessionTagAssignmentsApi } from '@/sync/api/session/sessionOrganizationApi';
import { buildSessionOrganizationSessionKey } from '@/sync/domains/session/organization';
import { getStorage } from '@/sync/domains/state/storageStore';

export async function setSessionTagAssignments(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    sessionId: string;
    tagIds: readonly string[];
}>): Promise<void> {
    const recordId = getStorage().getState().setSessionTagAssignmentsOptimistic(params.serverId, params.sessionId, params.tagIds);
    try {
        const response = await setSessionTagAssignmentsApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            sessionId: params.sessionId,
            request: { tagIds: [...params.tagIds] },
        });
        // Same rule as the pin and reminder writes: confirm this response's own key instead of
        // republishing it over a newer tag change that is still in flight for this Session.
        getStorage().getState().confirmSessionOrganizationOptimistic(
            recordId,
            'sessionOrganizationTagAssignmentsBySessionKey',
            buildSessionOrganizationSessionKey(params.serverId, params.sessionId),
            { sessionId: response.sessionId, tagIds: [...response.tagIds] },
        );
    } catch (error) {
        getStorage().getState().rollbackSessionOrganizationOptimistic(recordId);
        throw error;
    }
}
