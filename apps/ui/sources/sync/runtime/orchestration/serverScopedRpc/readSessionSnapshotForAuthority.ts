import type { Session } from '@/sync/domains/state/storageTypes';
import { isTerminalAuthError } from '@/sync/runtime/connectivity/authErrors';
import { fetchSessionByIdWithServerScope } from './fetchSessionByIdWithServerScope';
import type { ServerAccountRequestAuthority } from './createServerRequestWithServerScope';

type SessionSnapshot = Omit<Session, 'presence'> & { presence?: 'online' | number };

/**
 * Typed, content-free failure from the canonical exact-Home Session reader.
 * UI consumers may distinguish authentication loss, unsupported projections,
 * and retryable transport failure without interpreting transport bodies.
 */
export class SessionSnapshotReadError extends Error {
    constructor(
        readonly errorCode: string,
        readonly httpStatus?: number,
    ) {
        super('Session snapshot unavailable');
        this.name = 'SessionSnapshotReadError';
    }
}

/** Reads a fresh Session without publishing it into the active Home's store. */
export async function readSessionSnapshotForAuthority(params: Readonly<{
    authority: ServerAccountRequestAuthority;
    sessionId: string;
    isCurrent?: () => boolean;
}>): Promise<Readonly<{ session: SessionSnapshot; callerDataKeyEnvelope: string | null }>> {
    const credentials = params.authority.context.credentials;
    if (!credentials) throw new Error('Session request requires credentials');
    const projection: { session: SessionSnapshot | null } = { session: null };
    const envelopes = new Map<string, string>();
    let result: Awaited<ReturnType<typeof fetchSessionByIdWithServerScope>>;
    try {
        result = await fetchSessionByIdWithServerScope({
            authority: params.authority,
            serverId: params.authority.scope.serverId,
            sessionId: params.sessionId,
            activeCredentials: credentials,
            activeRequest: params.authority.request,
            sessionDataKeys: new Map(),
            sessionDataKeyEnvelopes: envelopes,
            applySessions: (sessions) => { projection.session = sessions.find((session) => session.id === params.sessionId) ?? null; },
            log: { log: () => {} },
            isCurrent: params.isCurrent,
        });
    } catch (error) {
        if (isTerminalAuthError(error)) {
            throw new SessionSnapshotReadError('unauthorized');
        }
        throw error;
    }
    if (!result.ok || !projection.session) {
        throw new SessionSnapshotReadError(
            result.errorCode ?? 'unavailable',
            result.httpStatus,
        );
    }
    return { session: projection.session, callerDataKeyEnvelope: envelopes.get(params.sessionId) ?? null };
}
