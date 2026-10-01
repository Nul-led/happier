import type { Session } from '@/sync/domains/state/storageTypes';

type SessionRecord = Readonly<Record<string, Session>>;

/**
 * Whether `candidate` could lead `session`: same Home, not archived, never itself and never a
 * Session already under it (that would close a cycle — the server refuses it too; the UI just never
 * offers it). Walks the candidate's own lead chain, so the cost is the tree's depth, not the list's
 * size — the drag resolver asks this on every pointer move.
 */
function canSessionLead(sessions: SessionRecord, session: Pick<Session, 'id' | 'serverId'>, candidate: Session): boolean {
    if (candidate.id === session.id) return false;
    if (candidate.archivedAt != null) return false;
    if ((candidate.serverId ?? null) !== (session.serverId ?? null)) return false;
    const seen = new Set<string>();
    let cursor: string | null = candidate.reportsTo?.sessionId ?? null;
    while (cursor && !seen.has(cursor)) {
        if (cursor === session.id) return false;
        seen.add(cursor);
        cursor = sessions[cursor]?.reportsTo?.sessionId ?? null;
    }
    return true;
}

/**
 * The Sessions offered by "Put under…", most recently active first. The current lead stays in the
 * list so the sheet can show where the Session sits now.
 */
export function listPutUnderCandidates(
    sessions: SessionRecord,
    session: Pick<Session, 'id' | 'serverId'>,
): readonly Session[] {
    return Object.values(sessions)
        .filter((candidate) => canSessionLead(sessions, session, candidate))
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Whether dragging `sessionId` onto `leadSessionId` in the Sessions list is a real "put under": the
 * person can steer the dragged Session (the same right "Put under…" asks for), the target could
 * lead it, and it is not already its lead (that drop would change nothing, so it shows no target).
 */
export function canDropSessionUnder(sessions: SessionRecord, sessionId: string, leadSessionId: string): boolean {
    const session = sessions[sessionId];
    const candidate = sessions[leadSessionId];
    if (!session || !candidate) return false;
    if (session.archivedAt != null) return false;
    if (session.access?.capabilities.submitAgentInput !== true) return false;
    if (session.reportsTo?.sessionId === candidate.id) return false;
    return canSessionLead(sessions, session, candidate);
}
