import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';
import type { Session } from '@/sync/domains/state/storageTypes';

const awarenessTimes = vi.hoisted(() => [] as number[]);
const approvalSessionTargets = vi.hoisted(() => [] as Array<{ serverId: string; sessionId: string } | null | undefined>);
const activityInputs = vi.hoisted(() => [] as unknown[]);
const scmInputs = vi.hoisted(() => [] as unknown[]);
const usageInputs = vi.hoisted(() => [] as unknown[]);
const activityCounts = vi.hoisted(() => ({ current: { live: 0, total: 0 } }));
const activityEntries = vi.hoisted(() => ({ current: [] as Array<{
    id: string;
    title: string;
    status: string;
}> }));
const usageState = vi.hoisted(() => ({ current: null as null | {
    contextSnapshot: {
        v: 1;
        modelId: string | null;
        usedTokens: number;
        windowTokens: number | null;
        totalProcessedTokens: number | null;
        baselineTokens: number | null;
        isAutoCompactEnabled: boolean | null;
        categories: null;
        observedAtMs: number;
        source: 'provider_turn';
    };
    contextSnapshotStale: boolean;
} }));

vi.mock('@/sync/domains/session/awareness/sessionAwareness', () => ({
    projectUiSessionAwareness: (_session: Session, nowMs: number) => {
        awarenessTimes.push(nowMs);
        return {
            v: 1,
            sessionId: 'session-1',
            title: 'Session',
            lifecycle: 'active',
            runtime: 'online',
            freshness: nowMs >= 61_000 ? 'stale' : 'live',
            operational: { primary: 'ready', reasons: [] },
            encryption: 'plain',
            availability: 'complete',
        };
    },
}));

vi.mock('@/sync/domains/state/storage', () => ({
    useOpenApprovalArtifactsForSession: (target: { serverId: string; sessionId: string } | null | undefined) => {
        approvalSessionTargets.push(target);
        return [];
    },
    useSessionProjectScmSnapshot: (...input: unknown[]) => {
        scmInputs.push(input);
        return null;
    },
    useSessionUsage: (...input: unknown[]) => {
        usageInputs.push(input);
        return usageState.current;
    },
}));

vi.mock('@/agents/catalog/catalog', () => ({ AGENT_IDS: [], getAgentCore: () => null }));
vi.mock('@/hooks/session/useSessionAgentActivity', () => ({
    useSessionAgentActivity: (input: unknown) => {
        activityInputs.push(input);
        return {
            counts: activityCounts.current,
            entries: activityEntries.current,
            readSubagentForEntry: () => null,
        };
    },
}));
vi.mock('@/components/sessions/agents/presentation/sessionAgentActivityPresentation', () => ({
    resolveSessionAgentActivityPresentation: ({ entry }: { entry: { title: string; status: string } }) => ({
        title: entry.title,
        statusLabel: entry.status,
    }),
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { SESSION_LIST_RELATIVE_TIME_CLOCK_INTERVAL_MS } from '@/hooks/session/sessionListRuntimeClock';
import { useSessionSummaryModel } from './useSessionSummaryModel';

afterEach(() => {
    standardCleanup();
    vi.useRealTimers();
    awarenessTimes.length = 0;
    approvalSessionTargets.length = 0;
    activityInputs.length = 0;
    scmInputs.length = 0;
    usageInputs.length = 0;
    activityCounts.current = { live: 0, total: 0 };
    activityEntries.current = [];
    usageState.current = null;
});

describe('useSessionSummaryModel', () => {
    it('advances awareness freshness on the canonical shared clock while the Session object stays stable', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const session = { id: 'session-1' } as Session;
        const hook = await renderHook(() => useSessionSummaryModel({ session, serverId: 'server-a' }));

        expect(hook.getCurrent().stale).toBe(false);
        await flushHookEffects({
            advanceTimersMs: SESSION_LIST_RELATIVE_TIME_CLOCK_INTERVAL_MS,
            cycles: 1,
            turns: 2,
        });

        expect(hook.getCurrent().stale).toBe(true);
        expect(awarenessTimes.at(-1)).toBe(61_000);
        await hook.unmount();
    });

    it('selects approvals by the exact Home-qualified Session identity', async () => {
        const session = { id: 'same-session-id' } as Session;
        const hook = await renderHook(() => useSessionSummaryModel({ session, serverId: 'home-b' }));

        expect(approvalSessionTargets.at(-1)).toEqual({ serverId: 'home-b', sessionId: 'same-session-id' });
        expect(activityInputs.at(-1)).toMatchObject({
            sessionId: 'same-session-id',
            serverId: 'home-b',
            session,
        });
        await hook.unmount();
    });

    it('uses the Session-owned Home when the route has not supplied a duplicate scope', async () => {
        const session = { id: 'same-session-id', serverId: 'home-from-session' } as Session;
        const hook = await renderHook(() => useSessionSummaryModel({ session }));

        expect(approvalSessionTargets.at(-1)).toEqual({ serverId: 'home-from-session', sessionId: 'same-session-id' });
        expect(activityInputs.at(-1)).toMatchObject({
            sessionId: 'same-session-id',
            serverId: 'home-from-session',
            session,
        });
        expect(scmInputs.at(-1)).toEqual(['same-session-id', 'home-from-session']);
        expect(usageInputs.at(-1)).toEqual([
            'same-session-id',
            { serverId: 'home-from-session', session },
        ]);
        await hook.unmount();
    });

    it('refuses a route Home that conflicts with the Session-owned Home', async () => {
        const session = { id: 'same-session-id', serverId: 'home-a' } as Session;
        const hook = await renderHook(() => useSessionSummaryModel({ session, serverId: 'home-b' }));

        expect(hook.getCurrent()).toMatchObject({
            scope: 'realm_unavailable',
            title: null,
            rows: [],
        });
        expect(approvalSessionTargets.at(-1)).toBeNull();
        await hook.unmount();
    });

    it('fails closed instead of borrowing same-id facts from the active Home when no Home can be proven', async () => {
        const session = { id: 'same-session-id' } as Session;
        const hook = await renderHook(() => useSessionSummaryModel({ session }));

        expect(hook.getCurrent()).toMatchObject({
            scope: 'realm_unavailable',
            title: null,
            agentLabel: null,
            rows: [],
        });
        expect(approvalSessionTargets.at(-1)).toBeNull();
        expect(activityInputs.at(-1)).toMatchObject({
            sessionId: 'same-session-id',
            serverId: '__unknown_server__',
            session: null,
        });
        expect(scmInputs.at(-1)).toEqual([null, null]);
        expect(usageInputs.at(-1)).toEqual([
            'same-session-id',
            { serverId: '__unknown_server__', session },
        ]);
        await hook.unmount();
    });

    it('composes the canonical Agent-activity count without fetching workflow details', async () => {
        activityCounts.current = { live: 2, total: 3 };
        activityEntries.current = [{ id: 'activity-1', title: 'Reviewing access', status: 'running' }];
        const hook = await renderHook(() => useSessionSummaryModel({
            session: { id: 'session-1' } as Session,
            serverId: 'server-a',
        }));

        expect(hook.getCurrent().rows.find((row) => row.kind === 'activity')).toEqual({
            kind: 'activity',
            liveCount: 2,
            totalCount: 3,
            title: 'Reviewing access',
            statusLabel: 'running',
            destination: 'workflow',
        });
        await hook.unmount();
    });

    it('keeps the last-known context percentage when the canonical usage snapshot is stale', async () => {
        usageState.current = {
            contextSnapshot: {
                v: 1,
                modelId: 'test-model',
                usedTokens: 2_000,
                windowTokens: 8_000,
                totalProcessedTokens: null,
                baselineTokens: null,
                isAutoCompactEnabled: null,
                categories: null,
                observedAtMs: 1_000,
                source: 'provider_turn',
            },
            contextSnapshotStale: true,
        };
        const hook = await renderHook(() => useSessionSummaryModel({
            session: { id: 'session-1' } as Session,
            serverId: 'server-a',
        }));

        expect(hook.getCurrent().rows.find((row) => row.kind === 'usage')).toEqual({
            kind: 'usage',
            tokens: 2_000,
            contextPercent: 25,
            stale: true,
            destination: 'usage',
        });
        await hook.unmount();
    });
});
