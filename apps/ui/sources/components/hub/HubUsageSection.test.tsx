import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    summaries: [] as unknown[],
    policies: [] as unknown[],
}));

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());
// The quota summaries owner (its own suite covers the server/daemon reads).
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaSummaries', () => ({
    useConnectedServiceQuotaSummaries: (options?: { fetchPolicy?: string }) => {
        state.policies.push(options?.fetchPolicy);
        return {
            summaries: state.summaries, accountsWithoutUsage: [], isRefreshing: false, hasConnectedProfiles: state.summaries.length > 0,
            accountsNeedingSignIn: [], keysWithoutLimits: 0, inUseAccountKeys: new Set<string>(), usageRecordIdsByKey: {},
        };
    },
}));
// Device persistence (the encrypted warm cache).
vi.mock('@/sync/domains/state/warmCachePersistence', () => ({
    loadUsageSummaryWarmCache: () => null,
    saveUsageSummaryWarmCache: () => undefined,
}));
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ useActiveServerAccountScope: () => ({ serverId: 's1', accountId: 'a1' }) });
});

afterEach(() => {
    standardCleanup();
    state.summaries = [];
    state.policies = [];
    vi.resetModules();
});

function summary(key: string, meters: ReadonlyArray<Readonly<{ meterId: string; label: string; remainingPct: number; resetsAt: number }>>) {
    return {
        key,
        serviceLabel: 'Claude subscription',
        serviceGroupKey: 'anthropic/claude',
        legacyServiceId: 'claude',
        accountLabel: 'Work',
        profileLabel: 'Work',
        planLabel: 'Max',
        fetchedAt: 1_000,
        primaryMeter: null,
        meters: meters.map((meter) => ({ ...meter, utilizationPct: 100 - meter.remainingPct, status: 'ok' })),
    };
}

async function renderSection() {
    const [{ HubUsageSection }, { ListPresentationProvider }] = await Promise.all([
        import('./HubUsageSection'),
        import('@/components/ui/lists/listPresentation'),
    ]);
    const screen = await renderScreen(<ListPresentationProvider value="page"><HubUsageSection /></ListPresentationProvider>);
    await flushHookEffects({ cycles: 3 });
    return screen;
}

describe('HubUsageSection', () => {
    it('is absent while no connected account reported usage', async () => {
        const screen = await renderSection();
        expect(screen.findByTestId('hub-usage.grid')).toBeNull();
    });

    it('shows one card per connected account, each window with what is left and when it resets, read once per launch', async () => {
        state.summaries = [
            summary('claude/work', [
                { meterId: '5h', label: '5-hour', remainingPct: 42, resetsAt: Date.now() + 3_600_000 },
                { meterId: 'week', label: 'Weekly', remainingPct: 64, resetsAt: Date.now() + 86_400_000 },
            ]),
            summary('codex/personal', [{ meterId: '5h', label: '5-hour', remainingPct: 8, resetsAt: Date.now() + 3_600_000 }]),
        ];
        const screen = await renderSection();

        expect(screen.findByTestId('hub-usage.grid')).toBeTruthy();
        expect(screen.findByTestId('hub-usage.claude/work')).toBeTruthy();
        expect(screen.findByTestId('hub-usage.codex/personal')).toBeTruthy();
        const text = screen.getTextContent();
        expect(text).toContain('connectedServices.quota.remaining(percent=42%)');
        expect(text).toContain('connectedServices.quota.remaining(percent=64%)');
        expect(text).toContain('connectedServices.quota.remaining(percent=8%)');
        expect(text).toContain('connectedServicesCollection.meterResetsIn');
        expect(new Set(state.policies)).toEqual(new Set(['once', 'cache_only']));
    });
});
