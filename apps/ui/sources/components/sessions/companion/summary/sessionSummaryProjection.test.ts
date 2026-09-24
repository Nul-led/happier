import { describe, expect, it } from 'vitest';

import { t } from '@/text';

import type { SessionAwarenessProjectionV1 } from '@happier-dev/protocol';

import {
    projectSessionSummaryCard,
    resolveSessionSummaryRows,
    resolveSessionSummaryVisibleRows,
    type SessionSummaryInput,
} from './sessionSummaryProjection';

function awareness(overrides: Partial<SessionAwarenessProjectionV1> = {}): SessionAwarenessProjectionV1 {
    return {
        v: 1,
        sessionId: 'session-1',
        title: 'Teams lane 08',
        lifecycle: 'active',
        runtime: 'online',
        freshness: 'live',
        operational: { primary: 'working', reasons: [] },
        encryption: 'plain',
        availability: 'complete',
        ...overrides,
    } as SessionAwarenessProjectionV1;
}

function input(overrides: Partial<SessionSummaryInput> = {}): SessionSummaryInput {
    return {
        awareness: awareness(),
        agentLabel: 'Claude',
        activity: null,
        openApprovalCount: 0,
        scm: null,
        usage: null,
        ...overrides,
    };
}

const scm = {
    branch: 'feature/teams',
    upstream: null,
    ahead: 0,
    behind: 0,
    changedFiles: 3,
    linesAdded: 12,
    linesRemoved: 4,
    hasLineChanges: true,
    hasAnyChanges: true,
};

describe('projectSessionSummaryCard', () => {
    it('keeps identity and awareness first and never invents a status of its own', () => {
        const model = projectSessionSummaryCard(input());

        expect(model.title).toBe('Teams lane 08');
        expect(model.scope).toBe('exact');
        expect(model.agentLabel).toBe('Claude');
        expect(model.status).toMatchObject({ state: 'thinking', quiet: false });
        expect(model.stale).toBe(false);
    });

    it('never labels a Session by operational state its runtime does not support', () => {
        // The real projector answers `{runtime:'offline', operational:{primary:'none'}}` for an
        // offline idle Session; reading `primary` alone rendered that as the "Online" pill.
        const offline = projectSessionSummaryCard(input({
            awareness: awareness({
                runtime: 'offline',
                freshness: 'offline',
                operational: { primary: 'none', reasons: ['runtime_offline'] },
            }),
        }));
        expect(offline.status?.state).toBe('disconnected');
        expect(offline.status?.statusText).not.toBe(t('status.online'));

        const unknownRuntime = projectSessionSummaryCard(input({
            awareness: awareness({ runtime: 'unknown', freshness: 'offline', operational: { primary: 'ready', reasons: [] } }),
        }));
        expect(unknownRuntime.status?.state).toBe('unknown');

        // An unservable runtime outranks a `ready` operational answer, exactly as the row does.
        const unservable = projectSessionSummaryCard(input({
            awareness: awareness({ operational: { primary: 'ready', reasons: ['runtime_unservable'] } }),
        }));
        expect(unservable.status?.state).toBe('recoverable_unservable');

        // An idle, reachable Session stays quiet rather than being badged "Online".
        const idle = projectSessionSummaryCard(input({
            awareness: awareness({ operational: { primary: 'none', reasons: [] } }),
        }));
        expect(idle.status).toMatchObject({ state: 'waiting', quiet: true });
    });

    it('puts an open approval ahead of ordinary work', () => {
        const model = projectSessionSummaryCard(input({
            openApprovalCount: 1,
            awareness: awareness({ currentWork: { title: 'Reviewing access' } }),
        }));

        expect(model.rows.map((row) => row.kind)).toEqual(['approvals', 'work']);
    });

    it('composes every canonical row family that is currently available', () => {
        const model = projectSessionSummaryCard(input({
            openApprovalCount: 2,
            awareness: awareness({
                currentWork: { title: 'Reviewing access', activeWorkflowRunCount: 1 },
                workspace: { projectName: 'happier' },
            }),
            activity: {
                live: 2,
                total: 3,
                headline: { title: 'Reviewing access', statusLabel: 'Running' },
            },
            scm,
            usage: { tokens: 12_400, contextPercent: 62, stale: false },
        }));

        expect(model.rows.map((row) => row.kind))
            .toEqual(['approvals', 'activity', 'work', 'workflow', 'workspace', 'usage']);
        expect(model.rows[1]).toMatchObject({
            kind: 'activity',
            title: 'Reviewing access',
            statusLabel: 'Running',
        });
    });

    it('omits a row whose canonical producer has nothing truthful to report', () => {
        expect(projectSessionSummaryCard(input()).rows).toEqual([]);
        expect(projectSessionSummaryCard(input({ scm: { ...scm, branch: null, changedFiles: 0, hasAnyChanges: false } })).rows)
            .toEqual([]);
        expect(projectSessionSummaryCard(input({ usage: { tokens: null, contextPercent: null, stale: false } })).rows)
            .toEqual([]);
    });

    it('keeps a stale usage value labelled rather than zeroing it', () => {
        const model = projectSessionSummaryCard(input({
            usage: { tokens: 900, contextPercent: 12, stale: true },
        }));
        const usage = model.rows.find((row) => row.kind === 'usage');

        expect(usage).toMatchObject({ kind: 'usage', tokens: 900, contextPercent: 12, stale: true });
    });

    it('marks the whole card stale when the awareness owner says the facts are not live', () => {
        expect(projectSessionSummaryCard(input({ awareness: awareness({ freshness: 'stale' }) })).stale).toBe(true);
    });

    it('routes every row to an existing owning destination rather than a Companion-local screen', () => {
        const model = projectSessionSummaryCard(input({
            openApprovalCount: 1,
            awareness: awareness({
                currentWork: { title: 'Reviewing access', activeWorkflowRunCount: 2 },
                workspace: { projectName: 'happier' },
            }),
            activity: { live: 1, total: 2, headline: null },
            scm,
            usage: { tokens: 10, contextPercent: 5, stale: false },
        }));

        expect(model.rows.map((row) => row.destination))
            .toEqual(['approvals', 'workflow', 'work', 'workflow', 'git', 'usage']);
    });
});

describe('resolveSessionSummaryVisibleRows', () => {
    const dense = () => projectSessionSummaryCard(input({
        openApprovalCount: 1,
        awareness: awareness({
            currentWork: { title: 'Reviewing access', activeWorkflowRunCount: 1 },
            workspace: { projectName: 'happier' },
        }),
        activity: { live: 1, total: 2, headline: null },
        scm,
        usage: { tokens: 10, contextPercent: 5, stale: false },
    }));

    it('bounds the compact card and reports what stays reachable in the full surface', () => {
        const visible = resolveSessionSummaryVisibleRows(dense(), 'compact');

        expect(visible.rows).toHaveLength(2);
        expect(visible.hiddenCount).toBe(4);
    });

    it('lets the comfortable density show the next useful row', () => {
        const visible = resolveSessionSummaryVisibleRows(dense(), 'comfortable');

        expect(visible.rows).toHaveLength(3);
        expect(visible.hiddenCount).toBe(3);
    });

    it('offers no overflow affordance when nothing is omitted', () => {
        const visible = resolveSessionSummaryVisibleRows(
            projectSessionSummaryCard(input({ openApprovalCount: 1 })),
            'compact',
        );

        expect(visible.rows).toHaveLength(1);
        expect(visible.hiddenCount).toBe(0);
    });

    it('keeps every canonical row uncapped in the full Companion surface', () => {
        const visible = resolveSessionSummaryRows(dense(), { kind: 'full' });

        expect(visible.rows.map((row) => row.kind))
            .toEqual(['approvals', 'activity', 'work', 'workflow', 'workspace', 'usage']);
        expect(visible.hiddenCount).toBe(0);
    });
});
