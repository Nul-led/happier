import type { AgentActivityEntry } from '@/sync/domains/session/agentActivity';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';

/**
 * A merged entry paired with the locally derived row behind it.
 *
 * Hosts render from the PAIR rather than from a roster of subagents plus a set of side maps: the
 * entry is the canonical status/attention, the subagent is the operational handle a control needs
 * (a route, a recipient, a run id). Keeping them together is what removed the per-host
 * `pendingPermissionById` index and, with it, the possibility of a row drawing a badge the roster
 * owner never agreed to.
 */
export type SessionAgentActivityRow = Readonly<{
    entry: AgentActivityEntry;
    subagent: SessionSubagent;
}>;

/**
 * The renderable rows behind a slice of the merged roster, in that slice's order.
 *
 * A headline-only entry has no subagent yet — its transcript page has not arrived — and is skipped
 * rather than drawn from an invented row: every control on a row (open, send, stop) needs a real
 * route, recipient or run id, and a row synthesised to fill the gap would announce controls that
 * lead nowhere. The entry is not lost: it still exists in the merge and still counts.
 */
export function readSessionAgentActivityRows(
    entries: readonly AgentActivityEntry[],
    readSubagentForEntry: (entryId: string) => SessionSubagent | null,
): readonly SessionAgentActivityRow[] {
    const rows: SessionAgentActivityRow[] = [];
    for (const entry of entries) {
        const subagent = readSubagentForEntry(entry.id);
        if (subagent) rows.push({ entry, subagent });
    }
    return rows;
}
