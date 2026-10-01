import type { SetSessionAttentionStandingResponse } from '@happier-dev/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { setSessionAttentionStanding as setSessionAttentionStandingApi } from '@/sync/api/session/sessionOrganizationApi';
import { buildSessionOrganizationSessionKey } from '@/sync/domains/session/organization';
import { getStorage } from '@/sync/domains/state/storageStore';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';

import { resolveSessionOrganizationMutationScope } from './sessionOrganizationMutationOwner';

export async function setSessionAttentionStanding(params: Readonly<{
    credentials: AuthCredentials;
    serverId: string;
    serverUrl?: string;
    sessionId: string;
    standing?: boolean | null;
    remindAt?: number | null;
}>): Promise<SetSessionAttentionStandingResponse> {
    const previousStanding = getStorage().getState().sessionOrganizationAttentionStandingsBySessionKey[
        buildSessionOrganizationSessionKey(params.serverId, params.sessionId)
    ];
    const optimisticStanding = params.standing === null
        ? null
        : params.standing !== undefined
            ? { sessionId: params.sessionId, standing: params.standing, updatedAt: Date.now() }
            : typeof params.remindAt === 'number'
                ? { sessionId: params.sessionId, standing: previousStanding?.standing ?? false, remindAt: params.remindAt, updatedAt: Date.now() }
                : previousStanding == null
                    ? null
                    : { sessionId: params.sessionId, standing: previousStanding.standing, updatedAt: Date.now() };
    const recordId = getStorage().getState().setSessionAttentionStandingOptimistic(params.serverId, params.sessionId, optimisticStanding);
    try {
        const response = await setSessionAttentionStandingApi({
            credentials: params.credentials,
            serverUrl: params.serverUrl,
            sessionId: params.sessionId,
            request: params.standing !== undefined ? { standing: params.standing } : { remindAt: params.remindAt ?? null },
        });
        // Confirm this write's own key through the optimistic-record owner: a second blind
        // optimistic write would republish this response over a newer reminder change that is
        // still in flight for the same Session.
        getStorage().getState().confirmSessionOrganizationOptimistic(
            recordId,
            'sessionOrganizationAttentionStandingsBySessionKey',
            buildSessionOrganizationSessionKey(params.serverId, params.sessionId),
            response.standing,
        );
        return response;
    } catch (error) {
        getStorage().getState().rollbackSessionOrganizationOptimistic(recordId);
        throw error;
    }
}

async function sessionSetAttentionIntentWithServerScope(
    sessionId: string,
    intent: Readonly<{ standing?: boolean | null; remindAt?: number | null }>,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionSetAttentionStandingResult> {
    const requestedServerId = typeof opts?.serverId === 'string' ? opts.serverId.trim() : '';
    const serverId = requestedServerId || resolvePreferredServerIdForSessionId(sessionId) || '';
    try {
        const resolved = await resolveSessionOrganizationMutationScope(serverId);
        if (!resolved.ok) return { success: false, message: `Cannot update session reminder: ${resolved.reason}` };
        await setSessionAttentionStanding({ ...resolved.scope, sessionId, ...intent });
        return { success: true };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
}

export async function sessionSetAttentionReminderWithServerScope(sessionId: string, remindAt: number, opts?: Readonly<{ serverId?: string | null }>): Promise<SessionSetAttentionStandingResult> {
    return sessionSetAttentionIntentWithServerScope(sessionId, { remindAt }, opts);
}

export async function sessionClearAttentionReminderWithServerScope(sessionId: string, opts?: Readonly<{ serverId?: string | null }>): Promise<SessionSetAttentionStandingResult> {
    return sessionSetAttentionIntentWithServerScope(sessionId, { remindAt: null }, opts);
}

export type SessionSetAttentionStandingResult = Readonly<{
    success: boolean;
    message?: string;
}>;

/**
 * The single-session entrypoint used by the shared session actions.
 *
 * Callers that already hold an organization mutation scope (bulk selection, settings screens) call
 * `setSessionAttentionStanding` directly; a menu item only knows the session and maybe its server,
 * so this resolves the scope through the one owner of organization credentials and still writes
 * through that same path.
 */
export async function sessionSetAttentionStandingWithServerScope(
    sessionId: string,
    standing: boolean,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionSetAttentionStandingResult> {
    const requestedServerId = typeof opts?.serverId === 'string' ? opts.serverId.trim() : '';
    const scopeResult = await resolveSessionOrganizationMutationScope(
        requestedServerId || resolvePreferredServerIdForSessionId(sessionId) || '',
    );
    if (!scopeResult.ok) {
        return { success: false, message: `Cannot set session attention standing: ${scopeResult.reason}` };
    }
    try {
        await setSessionAttentionStanding({
            ...scopeResult.scope,
            sessionId,
            standing,
        });
        return { success: true };
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
}

/**
 * The UI host port for `session.attention.set` (ORC R-10): the same optimistic writer the session
 * menus use, resolved to the exact Home, returning the route's `{ standing }` payload so the
 * Action executor projects it. A missing scope is the Action's `unavailable`, never a local write.
 */
export async function executeSessionAttentionSetAction(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    request: Readonly<{ standing?: boolean | null; remindAt?: number | null }>;
}>): Promise<SetSessionAttentionStandingResponse | Readonly<{ ok: false; errorCode: string; error: string }>> {
    const requestedServerId = typeof params.serverId === 'string' ? params.serverId.trim() : '';
    const serverId = requestedServerId || resolvePreferredServerIdForSessionId(params.sessionId) || '';
    const resolved = await resolveSessionOrganizationMutationScope(serverId);
    if (!resolved.ok) return { ok: false, errorCode: 'unavailable', error: 'unavailable' };
    return await setSessionAttentionStanding({ ...resolved.scope, sessionId: params.sessionId, ...params.request });
}
