import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentActivityEntry } from '@/sync/domains/session/agentActivity';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';
import { createDeferred, flushHookEffects, renderHook } from '@/dev/testkit';

import type { SessionAgentActivityRow } from './sessionAgentActivityRows';

// Boundaries: the sidechain transport (`sync`), the persisted settings and message stores. The preview
// derivation and the bounded hydration choice run for real.
const reducerState = vi.hoisted(() => ({ current: { sidechains: new Map(), permissions: new Map() } as any }));
const previewLimit = vi.hoisted(() => ({ current: 1 as number | null }));
const ensureSidechainMessagesLoaded = vi.hoisted(() =>
    vi.fn<(sessionId: string, sidechainId: string) => Promise<'loaded' | 'not_ready' | 'in_flight'>>(async () => 'loaded'),
);

vi.mock('@/sync/sync', () => ({
    sync: {
        ensureSidechainMessagesLoaded,
        getSyncTuning: () => ({ sidechainDemandHydrationConcurrencyLimit: 2 }),
    },
}));
vi.mock('@/sync/store/hooks', () => ({
    useSessionMessagesReducerState: () => reducerState.current,
}));
vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createPartialStorageModuleMock(importOriginal, {
        useSetting: (key: string) => (key === 'transcriptToolCallsCollapsedPreviewCount' ? previewLimit.current : null),
    });
});
vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeResolution: () => ({ kind: 'resolving' }),
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

function row(id: string, sidechainId: string, kind: SessionSubagent['kind'] = 'agent_team_member'): SessionAgentActivityRow {
    const subagent = {
        id,
        kind,
        status: 'running',
        display: { title: id },
        transcript: { sidechainId, toolId: sidechainId },
        recipient: null,
        capabilities: { canOpen: true, canSend: false, canStop: false, canLaunchChild: false, canDelete: false, canOpenAdvancedRun: false },
        timestamps: {},
    } as unknown as SessionSubagent;
    return { entry: { id } as unknown as AgentActivityEntry, subagent };
}

const ALPHA = row('agent_team_member:team-1:alpha', 'toolu_1');
const RUN = row('execution_run:run_1', 'call_2', 'execution_run');

describe('useSessionAgentActivityPreviews', () => {
    beforeEach(() => {
        previewLimit.current = 1;
        reducerState.current = { sidechains: new Map(), permissions: new Map() };
        ensureSidechainMessagesLoaded.mockReset();
        ensureSidechainMessagesLoaded.mockResolvedValue('loaded');
    });

    it('reads the latest step of an already-loaded sidechain', async () => {
        reducerState.current = {
            sidechains: new Map([['toolu_1', [
                { id: 'm1', role: 'agent', text: 'Alpha is validating the auth flow now.', event: null },
            ]]]),
            permissions: new Map(),
        };
        const { useSessionAgentActivityPreviews } = await import('./useSessionAgentActivityPreviews');
        const hook = await renderHook(() => useSessionAgentActivityPreviews({
            sessionId: 's1', serverId: null, session: null, rows: [ALPHA],
        }));

        expect(hook.getCurrent().get(ALPHA.subagent.id)).toContain('Alpha is validating the auth flow now.');
    });

    it('hydrates only the first rows in draw order, up to the preview setting, and says Loading meanwhile', async () => {
        const request = createDeferred<'loaded' | 'not_ready' | 'in_flight'>();
        ensureSidechainMessagesLoaded.mockReturnValue(request.promise);
        const { useSessionAgentActivityPreviews } = await import('./useSessionAgentActivityPreviews');
        const hook = await renderHook(() => useSessionAgentActivityPreviews({
            sessionId: 's1', serverId: null, session: null, rows: [ALPHA, RUN],
        }));
        await flushHookEffects();

        expect(ensureSidechainMessagesLoaded).toHaveBeenCalledTimes(1);
        expect(ensureSidechainMessagesLoaded).toHaveBeenCalledWith('s1', 'toolu_1');
        expect(hook.getCurrent().get(ALPHA.subagent.id)).toBe('common.loading');
        expect(hook.getCurrent().has(RUN.subagent.id)).toBe(false);

        await act(async () => {
            request.resolve('loaded');
            await request.promise;
        });
    });
});
