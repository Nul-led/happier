import type { SessionDiscussionOpenedSummaryV1 } from '@happier-dev/protocol';

import type { AgentActivityEntry } from '@/sync/domains/session/agentActivity';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';

/**
 * One row of the Conversations body (Lane 05 canonical owner).
 *
 * The body is a single activity-ordered virtualized list holding both semantic
 * sections, including both headings and their distinct creation actions. This
 * keeps the complete activity body under one scroll/virtualization owner.
 *
 * The union stays exhaustive and closed: the renderer is a switch, never a
 * registry, and no member exists without a producer here.
 */
export type SessionDiscussionActivityItem =
    | Readonly<{ kind: 'human_section' }>
    | Readonly<{ kind: 'human_discussion'; discussion: SessionDiscussionOpenedSummaryV1 }>
    | Readonly<{ kind: 'human_empty' }>
    | Readonly<{ kind: 'agent_section' }>
    | Readonly<{
        kind: 'agent_conversation';
        entry: AgentActivityEntry;
        /** The locally derived row behind the entry, or `null` for a headline-only entry. */
        subagent: SessionSubagent | null;
        /** The canonical Run identity this row opens. */
        runId: string;
    }>
    | Readonly<{ kind: 'agent_empty' }>;

/** Stable per-item list identity, distinct across both sections. */
export function sessionDiscussionActivityItemKey(item: SessionDiscussionActivityItem): string {
    switch (item.kind) {
        case 'human_section':
        case 'human_empty':
        case 'agent_section':
        case 'agent_empty':
            return `section:${item.kind}`;
        case 'human_discussion':
            return `discussion:${item.discussion.id}`;
        case 'agent_conversation':
            return `agent:${item.entry.id}`;
    }
}

/**
 * Compose the two sections without owning either source.
 *
 * Human summaries arrive already activity-ordered from the discussion
 * repository and Agent entries already live-first/freshest from the canonical
 * Agent activity owner, so this projection preserves both orders rather than
 * imposing a third. Agent conversations are exactly the canonical interactive
 * Execution Runs that expose a Run identity: an entry with no Run has no Run
 * Details to open, and drawing it would state work this list cannot reach.
 */
export function buildSessionDiscussionActivityItems(input: Readonly<{
    discussions: readonly SessionDiscussionOpenedSummaryV1[];
    agentEntries: readonly AgentActivityEntry[];
    readSubagentForEntry: (entryId: string) => SessionSubagent | null;
    /** The human list has never settled yet, so it states nothing instead of "empty". */
    humanListPending: boolean;
}>): readonly SessionDiscussionActivityItem[] {
    const items: SessionDiscussionActivityItem[] = [];

    items.push({ kind: 'human_section' });

    for (const discussion of input.discussions) {
        items.push({ kind: 'human_discussion', discussion });
    }
    if (input.discussions.length === 0 && !input.humanListPending) {
        items.push({ kind: 'human_empty' });
    }

    items.push({ kind: 'agent_section' });

    let agentCount = 0;
    for (const entry of input.agentEntries) {
        if (entry.kind !== 'execution_run') continue;
        const runId = entry.runId?.trim();
        if (!runId) continue;
        agentCount += 1;
        items.push({
            kind: 'agent_conversation',
            entry,
            subagent: input.readSubagentForEntry(entry.id),
            runId,
        });
    }
    if (agentCount === 0) {
        items.push({ kind: 'agent_empty' });
    }

    return items;
}
