import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    SESSION_RESPONSIBILITY_ASSIGNEE_UNAVAILABLE_V1,
    SessionResponsibilityCandidatesResponseSchema,
    SetSessionResponsibilityResponseSchema,
    V2SessionByIdResponseSchema,
    getActionSpec,
    type SessionResponsibilityCandidatesResponse,
    type SessionResponsibilityCandidatePurposeV1,
    type SetSessionResponsibilityResponse,
} from '@happier-dev/protocol';
import { runWithServerRequestAuthorityForServerAccountScope } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import { runWithServerAccountScopeRequestGuard } from '@/sync/runtime/orchestration/serverScopedRpc/serverAccountScopeRequestGuard';
import { SessionAccessApiError, createSessionAccessClient } from './sessionAccessApi';
import type { SessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';
import { buildSessionDetailAccessProjectionQuery } from './sessionDetailAccessProjection';
import { readSessionAccessHttpFailureCode } from './sessionAccessHttpFailure';

/**
 * The typed outcomes the responsibility surface must distinguish.
 *
 * `assignee-unavailable` is the server's one non-enumerating conflict: the
 * chosen person is absent, inactive, or no longer reads this Session. The UI
 * refreshes candidates and the Session rather than guessing which it was.
 * `unsupported` means this Home/server does not project responsibility
 * (old server or `direct_only` availability): the section hides rather than
 * claiming "No one". `unknown` covers transport loss where the commit outcome
 * cannot be proven; the controller reconciles canonical Session state before
 * retry.
 */
export type SessionResponsibilityMutationFailure =
    | 'forbidden'
    | 'not-found'
    | 'assignee-unavailable'
    | 'session_access_authentication_required'
    | 'session_access_authentication_unavailable'
    | 'unsupported'
    | 'unknown';

export class SessionResponsibilityError extends Error {
    readonly failure: SessionResponsibilityMutationFailure;

    constructor(failure: SessionResponsibilityMutationFailure) {
        super(`Session responsibility request failed: ${failure}`);
        this.name = 'SessionResponsibilityError';
        this.failure = failure;
    }
}

function readFailure(status: number, payload: unknown): SessionResponsibilityMutationFailure {
    const code = readSessionAccessHttpFailureCode(payload, status);
    if (code === 'session_access_authentication_required'
        || code === 'session_access_authentication_unavailable') {
        return code;
    }
    if (status === 403) return 'forbidden';
    if (status === 404) {
        if (code === 'unsupported_action') return 'unsupported';
        if (code === 'session_access_session_not_found') return 'not-found';
        return 'unknown';
    }
    if (status === 409) {
        const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
        return record.error === SESSION_RESPONSIBILITY_ASSIGNEE_UNAVAILABLE_V1
            ? 'assignee-unavailable'
            : 'unknown';
    }
    return 'unknown';
}

export type SessionResponsibilityRequestOptions = Readonly<{
    scope: ServerAccountScope;
    /** Central collaboration decision; responsibility edits only in `full_collaboration`. */
    availability?: SessionCollaborationAvailability;
    isCurrent?: () => boolean;
    signal?: AbortSignal;
}>;

/** What a caller may still choose once `scope` is already the first argument. */
export type SessionResponsibilityCallOptions = Omit<SessionResponsibilityRequestOptions, 'scope'>;

function readAvailability(options: SessionResponsibilityRequestOptions): SessionCollaborationAvailability | undefined {
    return options.availability;
}

/** Projects the one canonical Session-access failure onto responsibility's typed outcomes. */
function readResponsibilityFailureCode(code: string, status?: number): SessionResponsibilityMutationFailure {
    if (code === 'session_access_authentication_required'
        || code === 'session_access_authentication_unavailable') {
        return code;
    }
    if (code === 'unsupported_action' || code === 'action_disabled') return 'unsupported';
    if (code === 'session_access_session_not_found' || code === 'session_not_found') return 'not-found';
    if (code === 'session_access_forbidden' || code === 'forbidden' || status === 403) return 'forbidden';
    if (code === SESSION_RESPONSIBILITY_ASSIGNEE_UNAVAILABLE_V1) return 'assignee-unavailable';
    return 'unknown';
}

/**
 * The mounted controller uses the normal Action executor with the one canonical
 * Session-access family leaf, so the real UI honors Action availability, the
 * user's shared confirmation setting, and the same cancellation/outcome and
 * typed-failure contract as grants and publication. Direct
 * `POST /v2/sessions/responsibility/*` callers are removed, and this module
 * keeps no second dispatcher or route table; the route remains the domain
 * transaction owner.
 */
async function executeViaSharedExecutor(params: SessionResponsibilityRequestOptions & Readonly<{
    actionId: 'session.responsibility.set' | 'session.responsibility.candidates.list';
    input: unknown;
    sessionId: string;
}>): Promise<unknown> {
    const availability = readAvailability(params);
    if (availability === 'unavailable' || availability === 'direct_only') {
        throw new SessionResponsibilityError('unsupported');
    }
    const spec = getActionSpec(params.actionId);
    if (!spec.serverTransport || !spec.outputSchema) throw new SessionResponsibilityError('unsupported');
    const client = createSessionAccessClient({
        scope: params.scope,
        sessionId: params.sessionId,
        // Both withdrawing availabilities already returned above; an unstated
        // availability keeps the historical "no local gate" behavior and lets
        // the Home's own feature decision answer.
        availability: availability ?? 'full_collaboration',
        ...(params.isCurrent ? { isCurrent: params.isCurrent } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
    });
    try {
        return await client.execute(params.actionId, params.input);
    } catch (error) {
        if (error instanceof SessionResponsibilityError) throw error;
        if (error instanceof SessionAccessApiError) {
            throw new SessionResponsibilityError(readResponsibilityFailureCode(error.code, error.status));
        }
        throw new SessionResponsibilityError('unknown');
    }
}

export async function setSessionResponsibleAccount(
    scope: ServerAccountScope,
    input: Readonly<{ sessionId: string; responsibleAccountId: string | null }>,
    options?: SessionResponsibilityCallOptions,
): Promise<SetSessionResponsibilityResponse> {
    const merged: SessionResponsibilityRequestOptions = { scope, ...(options?.availability ? { availability: options.availability } : {}), ...(options?.isCurrent ? { isCurrent: options.isCurrent } : {}), ...(options?.signal ? { signal: options.signal } : {}) };
    const value = await executeViaSharedExecutor({
        ...merged,
        actionId: 'session.responsibility.set',
        input: { sessionId: input.sessionId, responsibleAccountId: input.responsibleAccountId },
        sessionId: input.sessionId,
    });
    return SetSessionResponsibilityResponseSchema.parse(value);
}

/**
 * Re-reads the canonical Session projection after a transport outcome that
 * cannot prove whether the desired-state mutation committed. This deliberately
 * uses the existing by-id owner rather than adding a responsibility GET or
 * retrying the mutation blindly, and remains bound to the captured Home/Account.
 */
export async function readSessionResponsibleAccount(
    scope: ServerAccountScope,
    sessionId: string,
    options?: Pick<SessionResponsibilityRequestOptions, 'isCurrent' | 'signal'>,
): Promise<Pick<SetSessionResponsibilityResponse, 'responsibleAccountId' | 'responsibleAccount'>> {
    return await runWithServerAccountScopeRequestGuard({
        scope,
        ...(options?.isCurrent ? { isCurrent: options.isCurrent } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
        staleError: () => new SessionResponsibilityError('unknown'),
    }, async ({ check, signal }) => {
        check();
        return await runWithServerRequestAuthorityForServerAccountScope({
            scope,
            activeRequest: async () => { throw new Error('Responsibility requires exact Account authority'); },
        }, async authority => {
            check();
            const response = await authority.request(`/v2/sessions/${encodeURIComponent(sessionId)}${buildSessionDetailAccessProjectionQuery(scope.serverId)}`, {
                method: 'GET',
                signal,
            });
            check();
            const payload: unknown = await response.json().catch(() => null);
            check();
            if (!response.ok) throw new SessionResponsibilityError(readFailure(response.status, payload));
            const record = V2SessionByIdResponseSchema.parse(payload).session;
            if (record.responsibleAccountId === undefined || record.responsibleAccount === undefined) {
                throw new SessionResponsibilityError('unsupported');
            }
            return {
                responsibleAccountId: record.responsibleAccountId,
                responsibleAccount: record.responsibleAccount,
            };
        });
    });
}

export async function listSessionResponsibilityCandidates(
    scope: ServerAccountScope,
    input: Readonly<{ sessionId: string; query?: string; cursor?: string; limit?: number }>,
    options?: SessionResponsibilityCallOptions & Readonly<{ purpose?: SessionResponsibilityCandidatePurposeV1 }>,
): Promise<SessionResponsibilityCandidatesResponse> {
    const purpose = options?.purpose ?? 'assignment';
    const merged: SessionResponsibilityRequestOptions = { scope, ...(options?.availability ? { availability: options.availability } : {}), ...(options?.isCurrent ? { isCurrent: options.isCurrent } : {}), ...(options?.signal ? { signal: options.signal } : {}) };
    const value = await executeViaSharedExecutor({
        ...merged,
        actionId: 'session.responsibility.candidates.list',
        input: {
            sessionId: input.sessionId,
            purpose,
            ...(input.query !== undefined ? { query: input.query } : {}),
            ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
        },
        sessionId: input.sessionId,
    });
    return SessionResponsibilityCandidatesResponseSchema.parse(value);
}

/**
 * Lane 05 discussion editors consume the same bounded candidate query with
 * `purpose: "mention"`. Authorization is `submitAgentInput` plus Lane 05
 * discussion admission consumed by its mounted picker, not assignment authority
 * and not a route-local creator exception. Mention rows carry neutral identity
 * only, never assignment access hints.
 */
export async function listSessionResponsibilityMentionCandidates(
    scope: ServerAccountScope,
    input: Readonly<{ sessionId: string; query?: string; cursor?: string; limit?: number }>,
    options?: SessionResponsibilityCallOptions,
): Promise<SessionResponsibilityCandidatesResponse> {
    return listSessionResponsibilityCandidates(scope, input, { ...options, purpose: 'mention' });
}
