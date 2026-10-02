import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@happier-dev/session-core/messages';

import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { createSessionMessagesFixture } from '@/dev/testkit/fixtures/transcriptFixtures';
import { storage } from '@/sync/domains/state/storageStore';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import { projectSessionSummaryCard } from './sessionSummaryProjection';
import { resolveSessionRecap } from './sessionRecap';
import { useSessionRecap } from './useSessionRecap';

// The System Record runtime is a host/network boundary. No memory repository is available here;
// the real synopsis observer and recap/transcript owners still execute.
vi.mock('@/sync/runtime/getSyncSingleton', () => ({
    getSyncSingleton: () => ({ withSessionSystemRecordRuntime: async () => {} }),
}));

afterEach(() => { standardCleanup(); });

describe('useSessionRecap delivered transcript fallback', () => {
    const address = { serverId: 'home-a', sessionId: 'lead' };
    function delivered(id: string, seq: number, createdAt: number, headline: string): Message {
        return { kind: 'agent-event', id, localId: null, seq, createdAt,
            event: { type: 'worker-update', update: { v: 1, workerKind: 'session',
                workerId: 'cworker0000000000000000000', ownerState: 'settled', wake: 'finished', headline, canInspect: true } } };
    }
    function transcript(messages: Message[]) {
        return createSessionMessagesFixture({ isLoaded: true,
            messageIdsOldestFirst: messages.map((message) => message.id),
            messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
        });
    }

    it('reads the latest delivered headline in transcript order, survives remount, and ignores sibling/ordinary messages', async () => {
        const previous = storage.getState();
        try {
            const rows = [delivered('older', 1, 900, 'Older report'), delivered('latest', 2, 500, 'Runbook published'),
                { kind: 'agent-text', id: 'heartbeat', localId: null, createdAt: 1000, seq: 3, text: 'Still working' } satisfies Message];
            storage.setState({ sessions: { lead: createSessionFixture({ id: 'lead', serverId: 'home-a' }),
                child: createSessionFixture({ id: 'child', serverId: 'home-a' }) },
                sessionMessages: { lead: transcript(rows), child: transcript([delivered('child', 8, 2000, 'Child secret')]) } });
            const hook = await renderHook(() => useSessionRecap(address));
            expect(hook.getCurrent()).toEqual({ source: 'worker_update', text: 'Runbook published', atMs: 500 });
            await hook.unmount();
            const reloaded = await renderHook(() => useSessionRecap(address));
            expect(reloaded.getCurrent()).toEqual({ source: 'worker_update', text: 'Runbook published', atMs: 500 });

            await act(async () => { storage.setState({ sessionMessages: {
                ...storage.getState().sessionMessages, lead: transcript([...rows, delivered('new', 4, 1100, 'Next report')]),
            } }); });
            expect(reloaded.getCurrent()).toEqual({ source: 'worker_update', text: 'Next report', atMs: 1100 });
            await reloaded.unmount();
        } finally { storage.setState(previous); }
    });

    it('does not disclose another Home or locked/unreadable retained content', async () => {
        const previous = storage.getState();
        try {
            storage.setState({ sessions: { lead: createSessionFixture({ id: 'lead', serverId: 'home-a' }) },
                sessionMessages: { lead: transcript([delivered('private', 1, 1, 'Private report')]) } });
            const hook = await renderHook<ReturnType<typeof useSessionRecap>, SessionAddress | null>((target) => useSessionRecap(target),
                { initialProps: { serverId: 'home-b', sessionId: 'lead' } });
            expect(hook.getCurrent()).toBeNull();
            await hook.rerender(address);
            expect(hook.getCurrent()?.text).toBe('Private report');
            await act(async () => { storage.setState({ sessions: { lead: createSessionFixture({ id: 'lead', serverId: 'home-a',
                encryptionMode: 'e2ee', encryptedContentAvailability: 'encrypted_content_unavailable' }) } }); });
            expect(hook.getCurrent()).toBeNull();
            await hook.rerender(null);
            expect(hook.getCurrent()).toBeNull();
            await hook.unmount();
        } finally { storage.setState(previous); }
    });
});

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
