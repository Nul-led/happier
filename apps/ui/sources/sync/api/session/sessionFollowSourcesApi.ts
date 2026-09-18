import type { SessionFollowSourceModeV1 } from '@happier-dev/protocol';

import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import { executeSessionFollowAction, type SessionFollowApiResult } from './sessionFollowApi';

export type SessionFollowSourcesResult<T> = SessionFollowApiResult<T>;
export type SessionFollowSourcesFailure = Extract<SessionFollowApiResult<never>, { kind: 'failed' }>;

export function listSessionFollowSources(destination: SessionAddress) {
    return executeSessionFollowAction('session.follow.sources.list', {
        destinationSessionId: destination.sessionId,
    }, destination.serverId);
}

export function setSessionFollowSource(input: Readonly<{
    serverId: string;
    destinationSessionId: string;
    sourceSessionId: string;
    mode?: SessionFollowSourceModeV1;
}>) {
    const { serverId, ...request } = input;
    return executeSessionFollowAction('session.follow.sources.set', request, serverId);
}

export function removeSessionFollowSource(input: Readonly<{
    serverId: string;
    destinationSessionId: string;
    sourceSessionId: string;
}>) {
    const { serverId, ...request } = input;
    return executeSessionFollowAction('session.follow.sources.remove', request, serverId);
}
