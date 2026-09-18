import { describe, expect, it } from 'vitest';

import type { SessionDiscussionOpenedSummaryV1 } from '@happier-dev/protocol';

import type { AgentActivityEntry } from '@/sync/domains/session/agentActivity';

import {
    buildSessionDiscussionActivityItems,
    sessionDiscussionActivityItemKey,
} from './sessionDiscussionActivityItems';

function discussion(id: string): SessionDiscussionOpenedSummaryV1 {
    return {
        id,
        sessionId: 'session-1',
        creationLocalId: null,
        title: `Discussion ${id}`,
        latestMessage: {
            id: `${id}-m1`,
            seq: 1,
            authorAccountId: 'account-1',
            accountActor: { v: 1, accountId: 'account-1', profile: null },
            producerV1: null,
            createdAt: 1_700_000_000_000,
            preview: null,
        },
        messageSeq: 1,
        lastReadSeq: null,
        unreadCount: 0,
        unreadMentionCount: 0,
        recentAuthorAccountIds: ['account-1'],
        archivedAt: null,
        capabilities: {
            postMessages: true,
            rename: true,
            archive: true,
            restore: false,
            askAgent: true,
            sendToSession: true,
        },
    } as unknown as SessionDiscussionOpenedSummaryV1;
}

function entry(input: Readonly<{
    id: string;
    kind: AgentActivityEntry['kind'];
    runId: string | null;
}>): AgentActivityEntry {
    return {
        id: input.id,
        kind: input.kind,
        status: 'running',
        title: `Entry ${input.id}`,
        metaDetail: null,
        startedAtMs: null,
        endedAtMs: null,
        provenance: 'local',
        detailState: 'loaded',
        parentId: null,
        runId: input.runId,
        sidechainId: null,
        subagentId: null,
        attentionKinds: [],
    } as unknown as AgentActivityEntry;
}

describe('buildSessionDiscussionActivityItems', () => {
    it('renders both semantic sections as ordered list items', () => {
        const items = buildSessionDiscussionActivityItems({
            discussions: [discussion('d1'), discussion('d2')],
            agentEntries: [entry({ id: 'e1', kind: 'execution_run', runId: 'run-1' })],
            readSubagentForEntry: () => null,
            humanListPending: false,
        });

        expect(items.map((item) => item.kind)).toEqual([
            'human_section',
            'human_discussion',
            'human_discussion',
            'agent_section',
            'agent_conversation',
        ]);
    });

    it('keeps only canonical execution Runs that expose a Run identity in the Agent section', () => {
        const items = buildSessionDiscussionActivityItems({
            discussions: [],
            agentEntries: [
                entry({ id: 'e1', kind: 'subagent', runId: 'run-1' }),
                entry({ id: 'e2', kind: 'workflow_run', runId: 'run-2' }),
                entry({ id: 'e3', kind: 'execution_run', runId: null }),
                entry({ id: 'e4', kind: 'execution_run', runId: 'run-4' }),
            ],
            readSubagentForEntry: () => null,
            humanListPending: false,
        });

        expect(items.filter((item) => item.kind === 'agent_conversation')).toHaveLength(1);
        expect(items.flatMap((item) => item.kind === 'agent_conversation' ? [item.runId] : [])).toEqual(['run-4']);
    });

    it('states each section is empty only once the section is no longer pending', () => {
        const pending = buildSessionDiscussionActivityItems({
            discussions: [],
            agentEntries: [],
            readSubagentForEntry: () => null,
            humanListPending: true,
        });
        expect(pending.map((item) => item.kind)).toEqual([
            'human_section',
            'agent_section',
            'agent_empty',
        ]);

        const settled = buildSessionDiscussionActivityItems({
            discussions: [],
            agentEntries: [],
            readSubagentForEntry: () => null,
            humanListPending: false,
        });
        expect(settled.map((item) => item.kind)).toEqual([
            'human_section',
            'human_empty',
            'agent_section',
            'agent_empty',
        ]);
    });

    it('preserves the canonical entry order supplied by the Agent activity owner', () => {
        const items = buildSessionDiscussionActivityItems({
            discussions: [],
            agentEntries: [
                entry({ id: 'e2', kind: 'execution_run', runId: 'run-2' }),
                entry({ id: 'e1', kind: 'execution_run', runId: 'run-1' }),
            ],
            readSubagentForEntry: () => null,
            humanListPending: false,
        });

        expect(items.flatMap((item) => item.kind === 'agent_conversation' ? [item.runId] : [])).toEqual(['run-2', 'run-1']);
    });

    it('joins the locally derived row behind an entry when the activity owner has one', () => {
        const subagent = { id: 'subagent-1' } as never;
        const items = buildSessionDiscussionActivityItems({
            discussions: [],
            agentEntries: [entry({ id: 'e1', kind: 'execution_run', runId: 'run-1' })],
            readSubagentForEntry: (entryId) => entryId === 'e1' ? subagent : null,
            humanListPending: false,
        });

        const agentItem = items.find((item) => item.kind === 'agent_conversation');
        expect(agentItem?.kind === 'agent_conversation' ? agentItem.subagent : null).toBe(subagent);
    });

    it('gives every item a stable distinct list key', () => {
        const items = buildSessionDiscussionActivityItems({
            discussions: [discussion('d1')],
            agentEntries: [entry({ id: 'e1', kind: 'execution_run', runId: 'run-1' })],
            readSubagentForEntry: () => null,
            humanListPending: false,
        });
        const keys = items.map(sessionDiscussionActivityItemKey);

        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toContain('discussion:d1');
        expect(keys).toContain('agent:e1');
    });
});
