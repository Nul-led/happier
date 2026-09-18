import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { serverFetch } from '@/sync/http/client';
import { createServerRequestWithServerScope, runWithServerRequestAuthorityForServerAccountScope } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { HappyError } from '@/utils/errors/errors';
import { getFriendsList } from '@/sync/api/social/apiFriends';

export type SessionSocialRequestOptions = Readonly<{
    scope?: ServerAccountScope;
    signal?: AbortSignal;
    isCurrent?: () => boolean;
    onIssued?: () => void;
}>;

export function createSessionSocialRequest(credentials: AuthCredentials, sessionId: string, options?: SessionSocialRequestOptions) {
    if (options?.scope) {
        const scope = options.scope;
        return async (path: string, init?: RequestInit) => await runWithServerRequestAuthorityForServerAccountScope({
            scope,
            activeRequest: async () => { throw new Error('Expected an explicit Account request'); },
        }, async ({ request }) => {
            const check = () => {
                if (options.signal?.aborted || options.isCurrent?.() === false) {
                    throw new HappyError('Session access scope retired', false, { code: 'session_access_stale_scope' });
                }
            };
            check();
            const response = await request(
                path,
                { ...init, ...(options.signal ? { signal: options.signal } : {}) },
                options.onIssued ? { onIssued: options.onIssued } : undefined,
            );
            check();
            if (response.body === null) return response;
            // Consume the response while a scoped transport lease is still held.
            return new Response(await response.arrayBuffer(), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        });
    }
    const request = createServerRequestWithServerScope({
        serverId: resolvePreferredServerIdForSessionId(sessionId) ?? null,
        activeRequest: (path, init) => {
            const headers = new Headers(init?.headers);
            headers.set('Authorization', `Bearer ${credentials.token}`);
            return serverFetch(path, {
                ...init,
                headers,
            }, { includeAuth: false });
        },
    });
    return async (path: string, init?: RequestInit) => await request(
        path,
        init,
        options?.onIssued ? { onIssued: options.onIssued } : undefined,
    );
}

export async function getSessionFriendsList(
    credentials: AuthCredentials,
    sessionId: string,
    options?: SessionSocialRequestOptions,
) {
    return await getFriendsList(credentials, {
        request: createSessionSocialRequest(credentials, sessionId, options),
    });
}
