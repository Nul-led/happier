import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { deleteSessionOrganizationFolder as deleteSessionOrganizationFolderApi } from '@/sync/api/session/sessionOrganizationApi';
import { getStorage } from '@/sync/domains/state/storageStore';
import type { DeleteSessionOrganizationFolderRequest, DeleteSessionOrganizationFolderResponse } from '@happier-dev/protocol';

export async function deleteSessionFolder(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    requestAtEndpoint?: (path: string, init?: RequestInit) => Promise<Response>;
    assertCurrent?: () => void;
    request: DeleteSessionOrganizationFolderRequest;
}>): Promise<DeleteSessionOrganizationFolderResponse> {
    params.assertCurrent?.();
    const recordId = getStorage().getState().deleteSessionOrganizationFolderOptimistic(params.serverId, params.request.folderId);
    try {
        const response = await deleteSessionOrganizationFolderApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            requestAtEndpoint: params.requestAtEndpoint,
            request: params.request,
        });
        params.assertCurrent?.();
        getStorage().getState().commitSessionOrganizationOptimistic(recordId);
        for (const folderId of response.deletedFolderIds) {
            const reconcileRecordId = getStorage().getState().deleteSessionOrganizationFolderOptimistic(params.serverId, folderId);
            getStorage().getState().commitSessionOrganizationOptimistic(reconcileRecordId);
        }
        if (response.affectedAssignmentCount > 0) {
            getStorage().getState().reconcileSessionOrganizationFolderDelete(
                params.serverId,
                response.deletedFolderIds,
                response.assignmentTargetFolderId,
            );
        }
        return response;
    } catch (error) {
        try {
            params.assertCurrent?.();
            getStorage().getState().rollbackSessionOrganizationOptimistic(recordId);
        } catch { /* The retired Account owns its optimistic record. */ }
        throw error;
    }
}
