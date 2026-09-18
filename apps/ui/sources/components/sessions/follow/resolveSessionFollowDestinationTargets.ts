import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import {
    resolveTranscriptReadableSessionTargets,
    resolveTranscriptSendToSessionTargets,
    type TranscriptSendToSessionTargetCandidate,
} from '@/components/sessions/transcript/messageSelection/resolveTranscriptSendToSessionTargets';

export type SessionFollowDestinationTargetCandidate = TranscriptSendToSessionTargetCandidate;

/**
 * Follow creation has the same destination eligibility boundary as sending
 * selected transcript context: an exact same-Home, user-facing Session whose
 * access permits destination input. Keep that decision at the established
 * qualified picker owner instead of growing a second access interpretation.
 */
export function resolveSessionFollowDestinationTargets(params: Readonly<{
    source: SessionAddress;
    sessions: ReadonlyArray<SessionFollowDestinationTargetCandidate>;
}>): ReadonlyArray<SessionFollowDestinationTargetCandidate> {
    return resolveTranscriptSendToSessionTargets({
        sourceSessionId: params.source.sessionId,
        sourceServerId: params.source.serverId,
        sessions: params.sessions,
    });
}

export function resolveSessionFollowSourceTargets(params: Readonly<{
    destination: SessionAddress;
    sessions: ReadonlyArray<SessionFollowDestinationTargetCandidate>;
}>): ReadonlyArray<SessionFollowDestinationTargetCandidate> {
    return resolveTranscriptReadableSessionTargets({
        excludedSessionId: params.destination.sessionId,
        serverId: params.destination.serverId,
        sessions: params.sessions,
    });
}
