import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { backoff } from '@/utils/timing/time';
import { serverFetch } from '@/sync/http/client';
import { createSessionSocialRequest, type SessionSocialRequestOptions } from '@/sync/api/social/createSessionSocialRequest';
import {
    ReleasedDirectSessionShareCreateRequestV1Schema,
    ReleasedDirectSessionShareDeleteResponseV1Schema,
    ReleasedDirectSessionSharePatchRequestV1Schema,
    ReleasedDirectSessionShareResponseV1Schema,
    ReleasedDirectSessionSharesResponseV1Schema,
    type ReleasedDirectSessionShareCreateRequestV1,
    type ReleasedDirectSessionSharePatchRequestV1,
    type ReleasedDirectSessionShareV1,
} from '@happier-dev/protocol';
import {
    AccessPublicShareResponse,
    PublicShareAccessLogsResponse,
    ShareNotFoundError,
    PublicShareNotFoundError,
    ConsentRequiredError,
    SessionSharingError
} from '@/sync/domains/social/sharingTypes';

function terminalDirectShareError<T extends Error>(error: T): T & { readonly retryable: false } {
    return Object.assign(error, { retryable: false as const });
}

async function readDirectShareErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
            return (body as { error: string }).error;
        }
    } catch {
        // The status remains authoritative when an older server has no JSON body.
    }
    return fallback;
}

/**
 * Get all shares for a session
 *
 * @param credentials - User authentication credentials
 * @param sessionId - ID of the session to get shares for
 * @returns List of all shares for the session
 * @throws {SessionSharingError} If the user doesn't have permission (not owner/admin)
 * @throws {Error} For other API errors
 *
 * @remarks
 * Only the session owner or users with admin access can view all shares.
 * The returned shares include information about who has access and their
 * access levels.
 */
export async function getSessionShares(
    credentials: AuthCredentials,
    sessionId: string,
    options?: SessionSocialRequestOptions
): Promise<ReleasedDirectSessionShareV1[]> {
    const response = await backoff(async () => {
        const request = createSessionSocialRequest(credentials, sessionId, options);
        const response = await request(`/v1/sessions/${sessionId}/shares`, { method: 'GET' });

        if (!response.ok) {
            if (response.status === 403) {
                throw terminalDirectShareError(new SessionSharingError('Forbidden'));
            }
            if (response.status === 400 || response.status === 404) {
                throw terminalDirectShareError(new Error(`Failed to get session shares: ${response.status}`));
            }
            throw new Error(`Failed to get session shares: ${response.status}`);
        }
        return response;
    });
    return ReleasedDirectSessionSharesResponseV1Schema.parse(await response.json()).shares;
}

/**
 * Share a session with a specific user
 *
 * @param credentials - User authentication credentials
 * @param sessionId - ID of the session to share
 * @param request - Share creation request containing userId and accessLevel
 * @returns The created or updated share
 * @throws {SessionSharingError} If sharing fails (not friends, forbidden, etc.)
 * @throws {Error} For other API errors
 *
 * @remarks
 * Only the session owner or users with admin access can create shares.
 * The target user must be a friend of the owner. If a share already exists
 * for the user, it will be updated with the new access level.
 *
 * The client must provide `encryptedDataKey` (the session DEK wrapped for the
 * recipient's content public key). The server stores it as an opaque blob.
 */
export async function createSessionShare(
    credentials: AuthCredentials,
    sessionId: string,
    request: ReleasedDirectSessionShareCreateRequestV1,
    options?: SessionSocialRequestOptions
): Promise<ReleasedDirectSessionShareV1> {
    const body = ReleasedDirectSessionShareCreateRequestV1Schema.parse(request);
    const response = await backoff(async () => {
        const scopedRequest = createSessionSocialRequest(credentials, sessionId, options);
        const response = await scopedRequest(`/v1/sessions/${sessionId}/shares`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw terminalDirectShareError(new SessionSharingError(
                    await readDirectShareErrorMessage(response, 'Forbidden'),
                ));
            }
            if (response.status === 400) {
                throw terminalDirectShareError(new SessionSharingError(
                    await readDirectShareErrorMessage(response, 'Bad request'),
                ));
            }
            if (response.status === 404) {
                throw terminalDirectShareError(new Error('Failed to create session share: 404'));
            }
            throw new Error(`Failed to create session share: ${response.status}`);
        }
        return response;
    });
    return ReleasedDirectSessionShareResponseV1Schema.parse(await response.json()).share;
}

/**
 * Update the access level of an existing share
 *
 * @param credentials - User authentication credentials
 * @param sessionId - ID of the session
 * @param shareId - ID of the share to update
 * @param accessLevel - New access level to grant
 * @returns The updated share
 * @throws {SessionSharingError} If the user doesn't have permission
 * @throws {ShareNotFoundError} If the share doesn't exist
 * @throws {Error} For other API errors
 *
 * @remarks
 * Only the session owner or users with admin access can update shares.
 */
export async function updateSessionShare(
    credentials: AuthCredentials,
    sessionId: string,
    shareId: string,
    patch: ReleasedDirectSessionSharePatchRequestV1,
    options?: SessionSocialRequestOptions
): Promise<ReleasedDirectSessionShareV1> {
    const body = ReleasedDirectSessionSharePatchRequestV1Schema.parse(patch);
    const response = await backoff(async () => {
        const request = createSessionSocialRequest(credentials, sessionId, options);
        const response = await request(`/v1/sessions/${sessionId}/shares/${shareId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            if (response.status === 403) {
                throw terminalDirectShareError(new SessionSharingError('Forbidden'));
            }
            if (response.status === 404) {
                throw terminalDirectShareError(new ShareNotFoundError());
            }
            if (response.status === 400) {
                throw terminalDirectShareError(new SessionSharingError(
                    await readDirectShareErrorMessage(response, 'Bad request'),
                ));
            }
            throw new Error(`Failed to update session share: ${response.status}`);
        }
        return response;
    });
    return ReleasedDirectSessionShareResponseV1Schema.parse(await response.json()).share;
}

/**
 * Delete a share and revoke user access
 *
 * @param credentials - User authentication credentials
 * @param sessionId - ID of the session
 * @param shareId - ID of the share to delete
 * @throws {SessionSharingError} If the user doesn't have permission
 * @throws {ShareNotFoundError} If the share doesn't exist
 * @throws {Error} For other API errors
 *
 * @remarks
 * Only the session owner or users with admin access can delete shares.
 * The shared user will immediately lose access to the session.
 */
export async function deleteSessionShare(
    credentials: AuthCredentials,
    sessionId: string,
    shareId: string,
    options?: SessionSocialRequestOptions
): Promise<void> {
    const response = await backoff(async () => {
        const request = createSessionSocialRequest(credentials, sessionId, options);
        const response = await request(`/v1/sessions/${sessionId}/shares/${shareId}`, { method: 'DELETE' });

        if (!response.ok) {
            if (response.status === 403) {
                throw terminalDirectShareError(new SessionSharingError('Forbidden'));
            }
            if (response.status === 404) {
                throw terminalDirectShareError(new ShareNotFoundError());
            }
            if (response.status === 400) {
                throw terminalDirectShareError(new SessionSharingError(
                    await readDirectShareErrorMessage(response, 'Bad request'),
                ));
            }
            throw new Error(`Failed to delete session share: ${response.status}`);
        }
        return response;
    });
    ReleasedDirectSessionShareDeleteResponseV1Schema.parse(await response.json());
}

/**
 * Access a session via a public share token
 *
 * @param token - The public share token from the URL
 * @param consent - Whether the user consents to access logging (if required)
 * @param credentials - Optional user credentials for authenticated access
 * @returns Session data and encrypted key for decryption
 * @throws {PublicShareNotFoundError} If the token is invalid, expired, or max uses reached
 * @throws {ConsentRequiredError} If consent is required but not provided
 * @throws {SessionSharingError} For other access errors
 * @throws {Error} For other API errors
 *
 * @remarks
 * This endpoint does not require authentication, allowing anonymous access.
 * However, if credentials are provided, the user's identity will be logged.
 *
 * If the public share has `isConsentRequired` set to true, the `consent`
 * parameter must be true, or a ConsentRequiredError will be thrown.
 *
 * Public shares are always read-only access. The returned session includes
 * metadata and an encrypted data key for decrypting the session content.
 */
export async function accessPublicShare(
    token: string,
    consent?: boolean,
    credentials?: AuthCredentials
): Promise<AccessPublicShareResponse> {
    return await backoff(async () => {
        const path = `/v1/public-share/${token}`;
        const query = new URLSearchParams();
        if (consent !== undefined) {
            query.set('consent', consent.toString());
        }
        const requestPath = query.size > 0 ? `${path}?${query.toString()}` : path;

        const headers: Record<string, string> = {};
        if (credentials) {
            headers['Authorization'] = `Bearer ${credentials.token}`;
        }

        const response = await serverFetch(requestPath, {
            method: 'GET',
            headers
        }, { includeAuth: false });

        if (!response.ok) {
            if (response.status === 404) {
                throw new PublicShareNotFoundError();
            }
            if (response.status === 403) {
                const error = await response.json();
                if (error.requiresConsent) {
                    throw new ConsentRequiredError();
                }
                throw new SessionSharingError(error.error || 'Forbidden');
            }
            throw new Error(`Failed to access public share: ${response.status}`);
        }

        return await response.json();
    });
}

/**
 * Get access logs for public share
 */
export async function getPublicShareAccessLogs(
    credentials: AuthCredentials,
    sessionId: string,
    limit?: number,
    options?: SessionSocialRequestOptions
): Promise<PublicShareAccessLogsResponse> {
    return await backoff(async () => {
        const query = new URLSearchParams();
        if (limit !== undefined) {
            query.set('limit', limit.toString());
        }
        const requestPath = query.size > 0
            ? `/v1/sessions/${sessionId}/public-share/access-logs?${query.toString()}`
            : `/v1/sessions/${sessionId}/public-share/access-logs`;

        const request = createSessionSocialRequest(credentials, sessionId, options);
        const response = await request(requestPath, { method: 'GET' });

        if (!response.ok) {
            if (response.status === 403) {
                throw new SessionSharingError('Forbidden');
            }
            if (response.status === 404) {
                throw new PublicShareNotFoundError();
            }
            throw new Error(`Failed to get access logs: ${response.status}`);
        }

        return await response.json();
    });
}
