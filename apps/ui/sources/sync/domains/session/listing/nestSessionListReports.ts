import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';

import type { SessionListRenderableSession } from './sessionListRenderable';

type SessionIndexItem = Extract<SessionListIndexItem, { type: 'session' }>;

/**
 * Draws the `reportsTo` tree in the Sessions list (ORC §3.8, lab `session-H`).
 *
 * Inside one list group, a Session whose lead is in the same group is drawn right under it — after the
 * lead's earlier reports — one level deeper. A report whose lead sits in another group (a different
 * day, the attention band, a filter that hides the lead) stays where the list put it: the tree never
 * pulls a row across a group boundary or invents a row, and the lead's sub-session chip still counts it.
 *
 * The pass only reorders and stamps `reportsDepth`; rows that did not move keep their identity, and a
 * list with no reports in it comes back as the same array.
 */
export function nestSessionListReports(
    items: SessionListIndexItem[],
    resolveSessionRow: (serverId: string | null, sessionId: string) => SessionListRenderableSession | null,
): SessionListIndexItem[] {
    let out: SessionListIndexItem[] | null = null;
    let index = 0;
    while (index < items.length) {
        const item = items[index];
        if (item.type !== 'session') {
            out?.push(item);
            index += 1;
            continue;
        }
        let end = index;
        const groupKey = item.groupKey ?? null;
        while (end < items.length) {
            const candidate = items[end];
            if (candidate.type !== 'session' || (candidate.groupKey ?? null) !== groupKey) break;
            end += 1;
        }
        const run = items.slice(index, end) as SessionIndexItem[];
        const nested = nestRun(run, resolveSessionRow);
        if (nested !== run && out === null) out = items.slice(0, index);
        if (out) out.push(...nested);
        index = end;
    }
    return out ?? items;
}

function rowKey(serverId: string | null | undefined, sessionId: string): string {
    return `${serverId ?? ''}\u0000${sessionId}`;
}

function nestRun(
    run: SessionIndexItem[],
    resolveSessionRow: (serverId: string | null, sessionId: string) => SessionListRenderableSession | null,
): SessionIndexItem[] {
    if (run.length < 2 && (run[0]?.reportsDepth ?? 0) === 0) return run;
    const present = new Set(run.map((item) => rowKey(item.serverId, item.sessionId)));
    const childrenByLead = new Map<string, SessionIndexItem[]>();
    const roots: SessionIndexItem[] = [];
    for (const item of run) {
        const lead = resolveSessionRow(item.serverId ?? null, item.sessionId)?.reportsTo?.sessionId?.trim() || null;
        // Reports stay in the same Home as their lead, so the lead is looked up on the row's own Home.
        const leadKey = lead && lead !== item.sessionId ? rowKey(item.serverId, lead) : null;
        if (leadKey && present.has(leadKey)) {
            const siblings = childrenByLead.get(leadKey);
            if (siblings) siblings.push(item);
            else childrenByLead.set(leadKey, [item]);
        } else {
            roots.push(item);
        }
    }
    if (childrenByLead.size === 0 && run.every((item) => (item.reportsDepth ?? 0) === 0)) return run;

    const nested: SessionIndexItem[] = [];
    const visited = new Set<string>();
    const emit = (item: SessionIndexItem, depth: number) => {
        const key = rowKey(item.serverId, item.sessionId);
        if (visited.has(key)) return;
        visited.add(key);
        if ((item.reportsDepth ?? 0) === depth) {
            nested.push(item);
        } else {
            const { reportsDepth: _previousDepth, ...rest } = item;
            nested.push(depth > 0 ? { ...rest, reportsDepth: depth } : rest);
        }
        for (const child of childrenByLead.get(key) ?? []) emit(child, depth + 1);
    };
    for (const root of roots) emit(root, 0);
    // A cycle the list transiently holds (an edge seen before its reparent) has no root: its members
    // keep their own level rather than disappearing.
    for (const item of run) emit(item, 0);

    const unchanged = nested.length === run.length && nested.every((item, position) => item === run[position]);
    return unchanged ? run : nested;
}
