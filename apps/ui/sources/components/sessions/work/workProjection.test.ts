import { describe, expect, it, vi } from 'vitest';

import type { SessionWorkflowRunHeadlineV1 } from '@happier-dev/protocol';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { createSessionListRenderableSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { resolveWorkStatusTone } from '@/components/work/status/resolveWorkStatusTone';
import { readSessionWorkStatusFacts } from '@/components/work/status/sessionWorkStatusFacts';
import type { AgentActivityEntry } from '@/sync/domains/session/agentActivity';
import { NO_SESSION_AGENT_ACTIVITY_ATTENTION } from '@/sync/domains/session/agentActivity';

import {
    groupWorkByState,
    projectWork,
    resolveWorkItemOpenTarget,
    type WorkItem,
    type WorkManagedRunSource,
    type WorkProjectionInput,
    type WorkReportSessionSource,
} from './workProjection';

type StatusFacts = WorkReportSessionSource['statusFacts'];

const workingFacts = {
    awareness: { runtime: 'working', operational: { primary: 'working', reasons: ['working'] } },
    word: 'Working',
    settled: false,
} as unknown as StatusFacts;
const needsYouFacts = {
    awareness: { runtime: 'waiting', operational: { primary: 'permission_required', reasons: ['permission_required'] } },
    word: 'Needs you',
    settled: false,
} as unknown as StatusFacts;
const settledFacts = {
    awareness: { runtime: 'idle', operational: { primary: 'ready', reasons: ['ready'] } },
    word: 'Ready',
    settled: true,
} as unknown as StatusFacts;

function report(overrides: Partial<WorkReportSessionSource> & Pick<WorkReportSessionSource, 'sessionId' | 'leadSessionId'>): WorkReportSessionSource {
    return {
        title: overrides.sessionId,
        agentId: 'claude',
        facts: [],
        statusFacts: workingFacts,
        stalled: false,
        archived: false,
        ...overrides,
    };
}

function agentEntry(overrides: Partial<AgentActivityEntry> & Pick<AgentActivityEntry, 'id' | 'kind' | 'status'>): AgentActivityEntry {
    return {
        title: overrides.id,
        metaDetail: null,
        startedAtMs: null,
        endedAtMs: null,
        provenance: 'local',
        detailState: 'loaded',
        parentId: null,
        runId: null,
        sidechainId: null,
        subagentId: null,
        attentionKinds: NO_SESSION_AGENT_ACTIVITY_ATTENTION,
        ...overrides,
    };
}

function managed(id: string, state: WorkManagedRunSource['run']['state'], needsAttention = false): WorkManagedRunSource {
    return { run: { id, state }, title: `Run ${id}`, word: state, needsAttention };
}

function headline(runId: string, completedAgents: number, totalAgents: number): SessionWorkflowRunHeadlineV1 {
    return {
        runId,
        title: `Headline ${runId}`,
        status: 'active',
        updatedAt: 1,
        recordRevision: '1',
        recordUpdatedAt: 1,
        totalAgents,
        completedAgents,
    } as SessionWorkflowRunHeadlineV1;
}

function input(overrides: Partial<WorkProjectionInput>): WorkProjectionInput {
    return {
        sessionId: 'lead',
        reportSessions: [],
        agentEntries: [],
        workflowHeadlineRuns: [],
        managedRuns: [],
        ownTriggerRunIds: new Set(),
        describeAgentStatus: (entry) => entry.status,
        describeProgress: ({ completed, total }) => `${completed} of ${total}`,
        ...overrides,
    };
}

describe('projectWork', () => {
    it('lists the reportsTo subtree once, each session under its lead, and ignores unrelated sessions', () => {
        const projection = projectWork(input({
            reportSessions: [
                report({ sessionId: 'api', leadSessionId: 'lead' }),
                report({ sessionId: 'ledger', leadSessionId: 'api' }),
                report({ sessionId: 'checkout', leadSessionId: 'lead', statusFacts: needsYouFacts }),
                report({ sessionId: 'elsewhere', leadSessionId: 'other-lead' }),
                report({ sessionId: 'root', leadSessionId: null }),
            ],
        }));

        expect(projection.sessions.map((item) => [item.key, item.parentKey, item.level])).toEqual([
            ['session:api', null, 0],
            ['session:ledger', 'session:api', 1],
            ['session:checkout', null, 0],
        ]);
        expect(projection.sessions[2]?.status.bucket).toBe('needs_you');
    });

    it('never loops on a cycle the store transiently holds', () => {
        const projection = projectWork(input({
            reportSessions: [
                report({ sessionId: 'a', leadSessionId: 'lead' }),
                report({ sessionId: 'b', leadSessionId: 'a' }),
                report({ sessionId: 'a', leadSessionId: 'b' }),
            ],
        }));
        expect(projection.sessions.map((item) => item.key)).toEqual(['session:a', 'session:b']);
    });

    it('classifies each report from the Session owner\'s work-status facts, with no settled rule of its own', () => {
        const NOW = 1_000_000;
        const sessions = [
            // Its latest turn completed and the owner says Ready: settled, so it is finished, not stalled.
            createSessionListRenderableSessionFixture({ id: 'settled', active: false, activeAt: 1, latestTurnStatus: 'completed' }),
            createSessionListRenderableSessionFixture({
                id: 'asks', active: true, activeAt: NOW, hasPendingPermissionRequests: true, pendingRequestObservedAt: NOW,
            }),
            createSessionListRenderableSessionFixture({ id: 'busy', active: true, activeAt: NOW, thinking: true, thinkingAt: NOW }),
        ];
        const projection = projectWork(input({
            reportSessions: sessions.map((session) => report({
                sessionId: session.id,
                leadSessionId: 'lead',
                statusFacts: readSessionWorkStatusFacts(session, NOW),
            })),
        }));

        expect(projection.sessions.map((item) => item.status)).toEqual(sessions.map((session) => (
            resolveWorkStatusTone({ kind: 'session', facts: readSessionWorkStatusFacts(session, NOW) })
        )));
        expect(projection.sessions.map((item) => item.status.bucket)).toEqual(['finished', 'needs_you', 'working']);
        expect(projection.summary).toMatchObject({ outstanding: 2, needsYou: 1 });
    });

    it('never finishes a report while its own reports are still working (R-10), however deep', () => {
        const projection = projectWork(input({
            reportSessions: [
                report({ sessionId: 'api', leadSessionId: 'lead', statusFacts: settledFacts }),
                report({ sessionId: 'ledger', leadSessionId: 'api', statusFacts: settledFacts }),
                report({ sessionId: 'probe', leadSessionId: 'ledger' }),
                report({ sessionId: 'docs', leadSessionId: 'lead', statusFacts: settledFacts }),
            ],
        }));

        expect(projection.sessions.map((item) => [item.key, item.status.bucket])).toEqual([
            ['session:api', 'idle'],
            ['session:ledger', 'idle'],
            ['session:probe', 'working'],
            ['session:docs', 'finished'],
        ]);
        // Only the working report is outstanding work; its leads are not counted twice.
        expect(projection.summary.outstanding).toBe(1);
        // Not finished, so not counted done; an idle lead waits in Recent while its report works on.
        const groups = groupWorkByState(projection);
        expect(groups.working.map((item) => item.key)).toEqual(['session:probe']);
        expect(groups.recent.map((item) => [item.key, item.status.bucket])).toEqual([
            ['session:api', 'idle'], ['session:ledger', 'idle'], ['session:docs', 'finished'],
        ]);
    });

    it('counts a report as stalled only from the owner\'s stalled fact, not because it is offline and unsettled', () => {
        const offline = { runtime: 'offline', operational: { primary: 'idle', reasons: ['runtime_offline'] } };
        const projection = projectWork(input({
            reportSessions: [
                // Offline with a turn in flight: stalled.
                report({ sessionId: 'cut-off', leadSessionId: 'lead', stalled: true, statusFacts: { awareness: offline, word: 'Offline', settled: false } as unknown as StatusFacts }),
                // Offline, no turn in flight, its own report still working: not settled, not stalled.
                report({ sessionId: 'waiting-on-reports', leadSessionId: 'lead', statusFacts: { awareness: offline, word: 'Offline', settled: true } as unknown as StatusFacts }),
                report({ sessionId: 'probe', leadSessionId: 'waiting-on-reports' }),
            ],
        }));

        expect(projection.sessions.find((item) => item.key === 'session:waiting-on-reports')?.status.bucket).not.toBe('finished');
        expect(projection.summary.stalled).toBe(1);
    });

    it('counts one workflow run once across agent activity, workflow activity and the managed run list', () => {
        const projection = projectWork(input({
            managedRuns: [managed('run-1', 'running', true)],
            agentEntries: [
                agentEntry({ id: 'wf:run-1', kind: 'workflow_run', status: 'running', runId: 'run-1' }),
                agentEntry({ id: 'wf:run-1:agent-a', kind: 'workflow_agent', status: 'running', runId: 'run-1', parentId: 'wf:run-1' }),
                agentEntry({ id: 'wf:run-2', kind: 'workflow_run', status: 'running', runId: 'run-2' }),
            ],
            workflowHeadlineRuns: [headline('run-1', 7, 12)],
        }));

        expect(projection.workflows.map((item) => item.key)).toEqual(['run:run-1', 'run:run-2']);
        // The managed run is the server truth for state and attention; the headline adds progress.
        expect(projection.workflows[0]).toMatchObject({
            title: 'Run run-1',
            progress: { completed: 7, total: 12 },
            facts: ['7 of 12'],
            status: { bucket: 'needs_you' },
        });
        expect(projection.summary).toMatchObject({ runs: 2, outstanding: 2, needsYou: 1 });
    });

    it('excludes the session\'s own trigger runs from items and counts', () => {
        const projection = projectWork(input({
            managedRuns: [managed('trigger-run', 'running'), managed('delegated', 'running')],
            agentEntries: [agentEntry({ id: 'wf:trigger-run', kind: 'workflow_run', status: 'running', runId: 'trigger-run' })],
            ownTriggerRunIds: new Set(['trigger-run']),
        }));

        expect(projection.workflows.map((item) => item.key)).toEqual(['run:delegated']);
        expect(projection.summary.runs).toBe(1);
        expect(projection.summary.outstanding).toBe(1);
    });

    it('splits background runs from in-session agents and counts only outstanding work', () => {
        const projection = projectWork(input({
            reportSessions: [
                report({ sessionId: 'done', leadSessionId: 'lead', statusFacts: settledFacts }),
                report({ sessionId: 'busy', leadSessionId: 'lead' }),
            ],
            agentEntries: [
                agentEntry({ id: 'run:scout', kind: 'execution_run', status: 'succeeded', runId: 'scout' }),
                agentEntry({ id: 'run:second', kind: 'execution_run', status: 'waiting', runId: 'second' }),
                agentEntry({ id: 'task:1', kind: 'subagent', status: 'running' }),
            ],
        }));

        expect(projection.backgroundRuns.map((item) => item.key)).toEqual(['agent:run:scout', 'agent:run:second']);
        expect(projection.agents.map((item) => item.key)).toEqual(['agent:task:1']);
        expect(projection.summary).toEqual({ outstanding: 3, needsYou: 1, stalled: 0, sessions: 2, runs: 2 });
    });

    it('reports nothing outstanding when every report has settled', () => {
        const projection = projectWork(input({
            reportSessions: [report({ sessionId: 'done', leadSessionId: 'lead', statusFacts: settledFacts })],
            agentEntries: [agentEntry({ id: 'run:x', kind: 'execution_run', status: 'failed', runId: 'x' })],
        }));
        expect(projection.summary.outstanding).toBe(0);
        expect(projection.backgroundRuns[0]?.status).toMatchObject({ bucket: 'finished', tone: 'danger' });
    });

    it('groups every item by state, Needs you / Working / Recent, an idle or offline item in Recent', () => {
        const idleFacts = {
            awareness: { runtime: 'idle', operational: { primary: 'none', reasons: [] } },
            word: 'Online',
            settled: false,
        } as unknown as StatusFacts;
        const offlineFacts = {
            awareness: { runtime: 'offline', operational: { primary: 'none', reasons: ['runtime_offline'] } },
            word: 'Offline',
            settled: false,
        } as unknown as StatusFacts;
        const projection = projectWork(input({
            reportSessions: [
                report({ sessionId: 'checkout', leadSessionId: 'lead', statusFacts: needsYouFacts }),
                report({ sessionId: 'done', leadSessionId: 'lead', statusFacts: settledFacts }),
                report({ sessionId: 'quiet', leadSessionId: 'lead', statusFacts: idleFacts }),
                report({ sessionId: 'gone', leadSessionId: 'lead', statusFacts: offlineFacts }),
            ],
            managedRuns: [managed('paused-run', 'paused'), managed('live-run', 'running')],
            agentEntries: [
                agentEntry({ id: 'run:x', kind: 'execution_run', status: 'succeeded', runId: 'x' }),
                agentEntry({ id: 'run:ask', kind: 'execution_run', status: 'waiting', runId: 'ask' }),
                agentEntry({ id: 'run:delegate', kind: 'execution_run', status: 'running', runId: 'delegate' }),
                agentEntry({ id: 'team:writer', kind: 'agent_team_member', status: 'running' }),
            ],
        }));
        const groups = groupWorkByState(projection);

        // One list, every kind in it (lab convo-W1/W8full): sessions, then background runs, then workflow
        // runs, then the agents working inside the session; the row's mark and subtitle carry the kind.
        expect(groups.needsYou.map((item) => item.key)).toEqual(['session:checkout', 'agent:run:ask']);
        // Working is only what is still going; the group is titled with that bucket's word, so an idle or
        // offline row there would read as working. They wait in Recent with their own word and tone.
        expect(groups.working.map((item) => item.key)).toEqual([
            'agent:run:delegate',
            'run:live-run',
            'agent:team:writer',
        ]);
        expect(groups.recent.map((item) => item.key)).toEqual([
            'session:done', 'session:quiet', 'session:gone', 'agent:run:x', 'run:paused-run',
        ]);
        expect(Object.keys(groups)).toEqual(['needsYou', 'working', 'recent']);
    });

    it('nests a report under its lead only inside the same state group', () => {
        const projection = projectWork(input({
            reportSessions: [
                report({ sessionId: 'api', leadSessionId: 'lead' }),
                report({ sessionId: 'ledger', leadSessionId: 'api' }),
                report({ sessionId: 'ledger-probe', leadSessionId: 'ledger' }),
                report({ sessionId: 'checkout', leadSessionId: 'lead', statusFacts: needsYouFacts }),
                report({ sessionId: 'retry-copy', leadSessionId: 'checkout' }),
            ],
        }));
        const groups = groupWorkByState(projection);

        expect(groups.working.map((item) => [item.key, item.level])).toEqual([
            ['session:api', 0],
            ['session:ledger', 1],
            ['session:ledger-probe', 2],
            // Its lead waits in Needs you: here it starts its own line rather than hanging under nothing.
            ['session:retry-copy', 0],
        ]);
        expect(groups.needsYou.map((item) => [item.key, item.level])).toEqual([['session:checkout', 0]]);
        // Unchanged items keep their identity, so their rows do not re-render.
        expect(groups.working[0]).toBe(projection.sessions[0]);
    });
});

describe('resolveWorkItemOpenTarget', () => {
    function item(overrides: Partial<WorkItem> & Pick<WorkItem, 'kind' | 'open'>): WorkItem {
        return {
            key: 'k',
            title: 't',
            agentId: null,
            facts: [],
            parentKey: null,
            level: 0,
            status: { bucket: 'working', tone: 'neutral', word: 'Running' },
            progress: null,
            ...overrides,
        };
    }
    const needsYou = { bucket: 'needs_you', tone: 'attention', word: 'Waiting for your review' } as const;

    it('sends needs-you work to where it is answered, never to an inline control (S-1)', () => {
        const run = item({ kind: 'workflow_run', open: { kind: 'workflow_run', runId: 'r1' }, status: needsYou });
        const session = item({ kind: 'session', open: { kind: 'session', sessionId: 's1' }, status: needsYou });
        const agent = item({
            kind: 'background_run',
            open: { kind: 'agent_activity', entryId: 'e1', subagentId: 'a1', runId: 'x' },
            status: needsYou,
        });

        // A workflow run has no peek: its review waits in the Inbox.
        expect(resolveWorkItemOpenTarget(run, { inboxAvailable: true })).toEqual({ kind: 'inbox' });
        // Sessions and agents open their peek, which holds the one set of answer controls.
        expect(resolveWorkItemOpenTarget(session, { inboxAvailable: true })).toEqual(session.open);
        expect(resolveWorkItemOpenTarget(agent, { inboxAvailable: true })).toEqual(agent.open);
        // Without an Inbox the run's own page is the place to answer it.
        expect(resolveWorkItemOpenTarget(run, { inboxAvailable: false })).toEqual(run.open);
        // Work that does not need the person opens where it lives.
        expect(resolveWorkItemOpenTarget({ ...run, status: { bucket: 'working', tone: 'neutral', word: 'Running' } }, { inboxAvailable: true }))
            .toEqual(run.open);
    });
});
