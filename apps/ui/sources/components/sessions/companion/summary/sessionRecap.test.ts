import { describe, expect, it } from 'vitest';

import { projectSessionSummaryCard } from './sessionSummaryProjection';
import { resolveSessionRecap } from './sessionRecap';

describe('resolveSessionRecap', () => {
    it('reads the latest synopsis when memory has produced one', () => {
        expect(resolveSessionRecap({
            synopses: [
                { synopsis: 'Older view of the work', seqTo: 10, updatedAtMs: 100 },
                { synopsis: 'Two workers merged; the ledger backfill is still running.', seqTo: 42, updatedAtMs: 400 },
                { synopsis: 'Out of order but older', seqTo: 30, updatedAtMs: 900 },
            ],
            latestWorkerUpdate: { headline: 'Checkout UI finished its turn', atMs: 500 },
        })).toEqual({
            source: 'synopsis',
            text: 'Two workers merged; the ledger backfill is still running.',
            atMs: 400,
        });
    });

    it('falls back to the latest worker update headline when memory is off (no synopsis exists)', () => {
        expect(resolveSessionRecap({
            synopses: [],
            latestWorkerUpdate: { headline: 'Runbook drafted and published as #2490', atMs: 500 },
        })).toEqual({ source: 'worker_update', text: 'Runbook drafted and published as #2490', atMs: 500 });
    });

    it('offers no recap when there is nothing to read, rather than inventing one', () => {
        expect(resolveSessionRecap({ synopses: [{ synopsis: '   ', seqTo: 1, updatedAtMs: 1 }], latestWorkerUpdate: null })).toBeNull();
    });
});

describe('Summary card Recap and Work rows', () => {
    const awareness = {
        v: 1,
        sessionId: 'lead',
        lifecycle: 'active',
        runtime: 'idle',
        freshness: 'live',
        operational: { primary: 'ready', reasons: ['ready'] },
        currentWork: { title: 'Payments rollout', activeWorkflowRunCount: 1 },
        encryption: { mode: 'plain', readable: true },
        availability: 'complete',
    } as unknown as Parameters<typeof projectSessionSummaryCard>[0]['awareness'];

    it('adds a Recap row and routes the work rows to the Work tab', () => {
        const model = projectSessionSummaryCard({
            awareness,
            agentLabel: null,
            activity: { live: 2, total: 3, headline: null },
            openApprovalCount: 0,
            scm: null,
            usage: null,
            recap: { source: 'worker_update', text: 'Runbook published', atMs: 1 },
        });

        expect(model.rows.find((row) => row.kind === 'recap')).toMatchObject({
            kind: 'recap', text: 'Runbook published', source: 'worker_update', destination: 'workTab',
        });
        expect(model.rows.find((row) => row.kind === 'activity')?.destination).toBe('workTab');
        expect(model.rows.find((row) => row.kind === 'workflow')?.destination).toBe('workTab');
    });

    it('has no Recap row without a recap', () => {
        const model = projectSessionSummaryCard({
            awareness, agentLabel: null, activity: null, openApprovalCount: 0, scm: null, usage: null, recap: null,
        });
        expect(model.rows.some((row) => row.kind === 'recap')).toBe(false);
    });
});
