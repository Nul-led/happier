import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { SelectionListProps } from '@/components/ui/selectionList';

const harness = vi.hoisted(() => ({
    selectionListProps: null as SelectionListProps | null,
    navigateToSession: vi.fn(),
    searchHomeMemory: vi.fn(),
    homeCredentialMutationListeners: new Set<(event: { kind: 'credentials_set' | 'credentials_removed'; serverId: string; serverUrl: string }) => void>(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Platform: { OS: 'web' } });
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

vi.mock('@/components/ui/selectionList', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/ui/selectionList')>();
    return {
        ...actual,
        SelectionList: (props: SelectionListProps) => {
            harness.selectionListProps = props;
            return React.createElement('SelectionList');
        },
    };
});

vi.mock('@/hooks/session/useNavigateToSession', () => ({
    useNavigateToSession: () => harness.navigateToSession,
}));

vi.mock('@/components/projects/useOpenProject', () => ({ useOpenProject: () => vi.fn(() => true) }));
vi.mock('@/components/settings/catalog/runtime/useResolvedSettingsPageCatalog', () => ({
    useResolvedSettingsPageCatalog: () => ({ tree: [], search: () => [] }),
}));
vi.mock('@/components/appShell/plugins/AppShellPluginUiProjection', () => ({
    useAppShellPluginUiProjection: () => ({
        pluginUiProjection: null,
        serverId: null,
        machineId: null,
        interactionEnabled: false,
    }),
}));
vi.mock('@/components/appShell/currentUiContext/CurrentUiContextProvider', () => ({
    useOptionalCurrentUiContextReader: () => null,
}));
vi.mock('@/components/plugins/surfaces/pluginSurfaceDestinationNavigation', () => ({
    usePluginSurfaceDestinationNavigationBinding: () => null,
}));

vi.mock('@/sync/store/hooks', () => ({
    useAllSessions: () => [{
        id: 'session-b',
        serverId: 'home-b',
        updatedAt: 1,
        metadata: { name: 'Home B session', path: '/repo/b' },
    }],
}));
vi.mock('@/sync/domains/state/storage', () => ({ useSetting: () => [] }));
vi.mock('@/sync/domains/state/storageStore', () => ({
    storage: { getState: () => ({ sessions: { 'session-b': { id: 'session-b', serverId: 'home-b' } } }) },
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => ({
        scope: { serverId: 'home-a', accountId: 'account-1' },
        isCurrent: () => true,
        onRetire: () => ({ dispose: () => undefined }),
    }),
}));
vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'home-a' }),
}));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (id: string) => id === 'search',
}));
vi.mock('@/sync/domains/features/featureDecisionRuntime', () => {
    const ready = {
        status: 'ready',
        features: { capabilities: { homeSearch: { enabled: true } } },
    };
    return {
        useServerFeaturesRuntimeSnapshot: () => ready,
        useServerFeaturesSnapshotForServerId: () => ready,
    };
});
vi.mock('@/sync/domains/machines/administration/useTargetSelection', () => ({
    useMachineAdministrationTargetSelection: () => ({ resolveExecutionTarget: () => null }),
}));
vi.mock('@/sync/domains/memory/searchHomeMemory', () => ({
    searchHomeMemory: harness.searchHomeMemory,
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    subscribeHomeCredentialMutations: (listener: (event: { kind: 'credentials_set' | 'credentials_removed'; serverId: string; serverUrl: string }) => void) => {
        harness.homeCredentialMutationListeners.add(listener);
        return () => harness.homeCredentialMutationListeners.delete(listener);
    },
}));
vi.mock('@/sync/domains/memory/searchDaemonMemory', () => ({ searchDaemonMemory: vi.fn() }));
vi.mock('@/sync/ops/sessionMachineTarget', () => ({ readMachineControlTargetForSession: () => null }));
vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({ useServerProfilesGeneration: () => 1 }));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => ({
        serverId: 'home-a',
        serverUrl: 'https://home-a.example.test',
        generation: 1,
        isSelectionExplicit: true,
    }),
    listServerProfiles: () => [
        { id: 'home-a', name: 'Home A' },
        { id: 'home-b', name: 'Home B' },
    ],
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
}));

afterEach(() => {
    harness.selectionListProps = null;
    harness.homeCredentialMutationListeners.clear();
    vi.clearAllMocks();
    standardCleanup();
});

describe('UniversalSearchController exact Home scope', () => {
    it('keeps a contextual Home B seed through query, result identity, and canonical scoped activation while Home A is focused', async () => {
        harness.searchHomeMemory.mockResolvedValue({
            v: 1,
            ok: true,
            hits: [{
                sessionId: 'session-b',
                seqFrom: 7,
                seqTo: 7,
                createdAtFromMs: 1,
                createdAtToMs: 1,
                summary: 'Needle in Home B',
                score: 1,
            }],
        });
        const { UniversalSearchController } = await import('./UniversalSearchController');

        await renderScreen(
            <UniversalSearchController
                commands={[]}
                initialQuery="needle"
                initialScope={{ accountId: 'account-1', serverId: 'home-b', sessionId: 'session-b', machineId: null, rootPath: null }}
                activeSessionId="ambient-session-a"
                presentation="modal"
                onRequestClose={vi.fn()}
            />,
        );

        const rootStep = harness.selectionListProps?.rootStep;
        const transcript = rootStep?.sections.find((section) => section.id === 'transcript');
        expect(transcript?.kind).toBe('dynamic');
        if (!transcript || transcript.kind !== 'dynamic') throw new Error('Transcript section not ready');
        const resolved = await transcript.resolve('needle', new AbortController().signal);
        const option = resolved.options[0];
        expect(harness.searchHomeMemory).toHaveBeenCalledWith(expect.objectContaining({
            serverId: 'home-b',
            accountId: 'account-1',
            query: 'needle',
        }));
        expect(option?.id).toContain('home-b');

        option?.onSelect?.();
        harness.selectionListProps?.onSelect?.(option!.id, option!);
        await vi.waitFor(() => {
            expect(harness.navigateToSession).toHaveBeenCalledWith('session-b', {
                serverId: 'home-b',
                query: { jumpSeq: 7 },
            });
        });
    });

    it('invalidates the Home transcript resolver identity when that Home credential mutates', async () => {
        const { UniversalSearchController } = await import('./UniversalSearchController');

        await renderScreen(
            <UniversalSearchController
                commands={[]}
                initialQuery="needle"
                initialScope={{ accountId: 'account-1', serverId: 'home-b', sessionId: null, machineId: null, rootPath: null }}
                activeSessionId={null}
                presentation="modal"
                onRequestClose={vi.fn()}
            />,
        );

        const before = harness.selectionListProps?.rootStep?.sections.find((section) => section.id === 'transcript');
        if (!before || before.kind !== 'dynamic') throw new Error('Transcript section not ready');
        const retiredCache = harness.selectionListProps?.dynamicSectionCache;
        if (!retiredCache) throw new Error('Credential-scoped cache not installed');
        retiredCache.set('transcript::old-credential::needle', [{ id: 'sensitive-old-row', label: 'Sensitive old row' }]);

        await act(async () => {
            for (const listener of harness.homeCredentialMutationListeners) {
                listener({ kind: 'credentials_set', serverId: 'home-b', serverUrl: 'https://home-b.example.test' });
            }
        });

        const after = harness.selectionListProps?.rootStep?.sections.find((section) => section.id === 'transcript');
        if (!after || after.kind !== 'dynamic') throw new Error('Transcript section not ready after credential mutation');
        const activeCache = harness.selectionListProps?.dynamicSectionCache;
        if (!activeCache) throw new Error('Replacement credential-scoped cache not installed');
        expect(after.resolverKey).not.toBe(before.resolverKey);
        expect(activeCache).not.toBe(retiredCache);
        expect(retiredCache.size()).toBe(0);

        // Completion from work admitted under the old credential can only touch its retired
        // cache instance; it cannot publish into the replacement credential lifetime.
        retiredCache.set('transcript::old-credential::needle', [{ id: 'late-old-row', label: 'Late old row' }]);
        expect(activeCache.get('transcript::old-credential::needle')).toBeUndefined();
    });

    it('normalizes a provider hit session id once for authorization, identity, and activation', async () => {
        harness.searchHomeMemory.mockResolvedValue({
            v: 1,
            ok: true,
            hits: [{
                sessionId: '  session-b  ',
                seqFrom: 9,
                seqTo: 9,
                createdAtFromMs: 1,
                createdAtToMs: 1,
                summary: 'Whitespace-bearing provider hit',
                score: 1,
            }],
        });
        const { UniversalSearchController } = await import('./UniversalSearchController');

        await renderScreen(
            <UniversalSearchController
                commands={[]}
                initialQuery="needle"
                initialScope={{ accountId: 'account-1', serverId: 'home-b', sessionId: 'session-b' }}
                activeSessionId={null}
                presentation="modal"
                onRequestClose={vi.fn()}
            />,
        );

        const transcript = harness.selectionListProps?.rootStep?.sections.find((section) => section.id === 'transcript');
        if (!transcript || transcript.kind !== 'dynamic') throw new Error('Transcript section not ready');
        const resolved = await transcript.resolve('needle', new AbortController().signal);
        const option = resolved.options[0];

        expect(option).toBeTruthy();
        option?.onSelect?.();
        harness.selectionListProps?.onSelect?.(option!.id, option!);
        await vi.waitFor(() => {
            expect(harness.navigateToSession).toHaveBeenCalledWith('session-b', {
                serverId: 'home-b',
                query: { jumpSeq: 9 },
            });
        });
    });
});
