import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { collectRenderedTestIds, renderScreen, standardCleanup } from '@/dev/testkit';
import { TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1 } from '@happier-dev/protocol';

const directoryBinding = vi.hoisted(() => ({
    version: 0,
    listeners: new Set<() => void>(),
    state: { kind: 'loading' } as Record<string, unknown>,
    publish() {
        this.version += 1;
        for (const listener of this.listeners) listener();
    },
}));
const directoryGroupsBinding = vi.hoisted(() => ({
    rows: [] as Array<Record<string, unknown>>,
    enabled: null as boolean | null,
    accountChange: null as Readonly<{ serverId: string; entityId: string }> | null,
}));
const nativeGroupsBinding = vi.hoisted(() => ({
    rows: [] as Array<Readonly<{ id: string; name: string; memberCount: number }>>,
}));
const useTeamGroupMock = vi.hoisted(() => vi.fn());
const canMutateMock = vi.hoisted(() => ({ current: true }));
const runActionMock = vi.hoisted(() => vi.fn());
const removeSourceMock = vi.hoisted(() => vi.fn());
const readRemovalImpactMock = vi.hoisted(() => vi.fn());
const routerBackMock = vi.hoisted(() => vi.fn());
const executeExternalGroupBindingMock = vi.hoisted(() => vi.fn());
const executeIdentityActionMock = vi.hoisted(() => vi.fn());
const openExternalUrlMock = vi.hoisted(() => vi.fn(async () => true));
const directoryGroupsReloadMock = vi.hoisted(() => vi.fn());
const modalConfirmMock = vi.hoisted(() => vi.fn(async () => true));
const capabilitiesMock = vi.hoisted(() => ({
    current: { manageAuthentication: true, manageGroups: true },
}));
const announceMock = vi.hoisted(() => vi.fn());
const refreshSourceMock = vi.hoisted(() => vi.fn());
const appStateListeners = vi.hoisted(() => new Set<(state: string) => void>());

vi.mock('expo-router', () => ({ useRouter: () => ({ back: routerBackMock }) }));
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    return {
        ...actual,
        AppState: {
            ...actual.AppState,
            addEventListener: (_type: string, listener: (state: string) => void) => {
                appStateListeners.add(listener);
                return { remove: () => appStateListeners.delete(listener) };
            },
        },
    };
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { confirm: modalConfirmMock } }).module;
});
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({ ActivitySpinner: 'ActivitySpinner' }));
vi.mock('@/components/ui/forms/SearchHeader', () => ({ SearchHeader: 'SearchHeader' }));
vi.mock('@/components/ui/lists/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ui/accessibility/announceAccessibilityMessage', () => ({
    announceAccessibilityMessage: announceMock,
}));
vi.mock('@/utils/url/openExternalUrl', () => ({ openExternalUrl: openExternalUrlMock }));
vi.mock('@/components/ui/lists/virtualized', () => ({
    VirtualizedList: (props: Readonly<Record<string, any>>) => React.createElement(
        'VirtualizedList',
        props,
        props.ListHeaderComponent,
        ...(props.data ?? []).map((item: unknown, index: number) => props.renderItem({ item, index })),
    ),
}));
// The generated bundled-plugin inventory is an unrelated build boundary and
// is intentionally absent from synchronized source-only test targets.
vi.mock('@/sync/domains/plugins/availability/generatedBundledPluginUiArtifacts', () => ({
    BUNDLED_PLUGIN_UI_APP_ARTIFACTS: [],
}));
vi.mock('@/sync/domains/plugins/availability/bundledAppExactArtifactSource', () => ({
    createBundledPluginUiAppExactArtifactSource: () => Object.freeze({
        kind: 'appExact' as const,
        fetch: async () => null,
    }),
    createBundledPluginUiAppExactArtifactSourceFromInventory: () => Object.freeze({
        kind: 'appExact' as const,
        fetch: async () => null,
    }),
}));
vi.mock('@/sync/domains/plugins/availability/reader', () => ({
    createPluginAccountAvailabilityReader: vi.fn(),
    createPluginAccountAvailabilityReaderStore: () => Object.freeze({
        replace: () => null,
        clear: () => null,
        subscribe: () => () => undefined,
        bind: vi.fn(),
    }),
    projectPluginAccountAvailabilityMaterializationIdentity: vi.fn(),
}));
vi.mock('@/hooks/teams/useTeamGroups', () => ({
    useTeamGroups: () => ({ rows: nativeGroupsBinding.rows, hasMore: false, status: 'idle', loadMore: vi.fn() }),
    useTeamGroup: useTeamGroupMock,
}));
vi.mock('@/hooks/teams/useTeamPagedList', () => ({
    useTeamPagedList: (params: Readonly<{
        enabled: boolean;
        accountChange?: Readonly<{ serverId: string; entityId: string }>;
    }>) => {
        directoryGroupsBinding.enabled = params.enabled;
        directoryGroupsBinding.accountChange = params.accountChange ?? null;
        return { rows: directoryGroupsBinding.rows, hasMore: false, status: 'idle', error: null, reload: directoryGroupsReloadMock, loadMore: vi.fn() };
    },
}));
vi.mock('./DirectoryPeopleList', () => ({
    useDirectoryPeopleList: () => ({ rows: [], hasMore: false, status: 'ready', error: null, reload: vi.fn(), loadMore: vi.fn() }),
}));
vi.mock('./identityAdministrationClient', () => ({
    createIdentityAdministrationClient: () => ({
        execute: executeIdentityActionMock,
        executeDirectory: vi.fn(),
        executeExternalGroupBinding: executeExternalGroupBindingMock,
    }),
}));
vi.mock('./useDirectoryAdministration', async () => {
    const ReactModule = await import('react');
    return {
        useDirectorySourceAdministration: () => {
            ReactModule.useSyncExternalStore(
                (listener) => {
                    directoryBinding.listeners.add(listener);
                    return () => directoryBinding.listeners.delete(listener);
                },
                () => directoryBinding.version,
            );
            return {
                state: directoryBinding.state,
                refresh: refreshSourceMock,
                pendingAction: null,
                runAction: runActionMock,
                readRemovalImpact: readRemovalImpactMock,
                removeSource: removeSourceMock,
            };
        },
    };
});
vi.mock('../TeamSection', () => ({
    TeamSection: (props: Readonly<{
        children: (context: unknown, header?: React.ReactNode) => React.ReactNode;
    }>) => props.children(
        {
            team: {
                id: 'team-1',
                capabilities: {
                    manageAuthentication: capabilitiesMock.current.manageAuthentication,
                    manageGroups: capabilitiesMock.current.manageGroups,
                },
            },
            scope: { serverId: 'home-1', accountId: 'account-1' },
            address: { serverId: 'home-1', teamId: 'team-1' },
            canMutate: canMutateMock.current,
            requestApproval: vi.fn(),
        },
        // The real shell hands its approval/stale/archived notices to a
        // virtualized child. Reproducing that here is what lets these tests see
        // whether a non-ready branch silently drops them.
        React.createElement('TeamShellHeader', { testID: 'team-shell-header' }),
    ),
}));
vi.mock('@/text', async () => {
    // The canonical text mock so a parameterized string is observable as
    // `key(param=value)`: a count this screen shows must be assertable.
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

import { DirectorySourceDetailScreen } from './DirectorySourceDetailScreen';

beforeEach(() => {
    standardCleanup();
    modalConfirmMock.mockReset();
    modalConfirmMock.mockResolvedValue(true);
    directoryBinding.state = { kind: 'loading' };
    directoryGroupsBinding.rows = [];
    directoryGroupsBinding.enabled = null;
    directoryGroupsBinding.accountChange = null;
    nativeGroupsBinding.rows = [];
    useTeamGroupMock.mockReset();
    canMutateMock.current = true;
    runActionMock.mockReset();
    runActionMock.mockResolvedValue({ ok: true, value: {} });
    removeSourceMock.mockReset();
    removeSourceMock.mockResolvedValue({ ok: true, value: { v: 1, sourceId: 'source-1' } });
    readRemovalImpactMock.mockReset();
    readRemovalImpactMock.mockResolvedValue({
        ok: true,
        value: {
            v: 1,
            status: 'allowed',
            sourceId: 'source-1',
            sourceLabel: 'Example directory',
            impact: {
                teamMembershipsRemoved: 0,
                groupMembershipsRemoved: 0,
                groupContributionsRemoved: 0,
                directoryCreatedGroupsRetained: 0,
                nativeMembershipsPreserved: 0,
                nativeGroupContributionsPreserved: 0,
            },
        },
    });
    routerBackMock.mockReset();
    executeExternalGroupBindingMock.mockReset();
    executeIdentityActionMock.mockReset();
    executeIdentityActionMock.mockResolvedValue({ ok: true, value: { url: 'https://setup.example.test/dsync' } });
    openExternalUrlMock.mockClear();
    directoryGroupsReloadMock.mockReset();
    announceMock.mockReset();
    refreshSourceMock.mockReset();
    appStateListeners.clear();
    capabilitiesMock.current = { manageAuthentication: true, manageGroups: true };
});

describe('DirectorySourceDetailScreen', () => {
    it('renders a bound directory Group with the canonical Team Group display name', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: [], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = [{
            id: 'external-group-1', sourceId: 'source-1', externalGroupId: 'external-1', displayName: 'External engineering',
            memberCount: 4, mapping: { state: 'bound', bindingId: 'binding-1', teamGroupId: 'team-group-opaque-id' },
        }];
        nativeGroupsBinding.rows = [{ id: 'team-group-opaque-id', name: 'Platform Engineering', memberCount: 4 }];

        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('directory-group:external-group-1')?.props.subtitle)
            .toBe('identityAdministration.mappedTo: Platform Engineering');
    });

    it('projects a full directory page of mapping labels from one Team Groups snapshot', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: [], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = Array.from({ length: 50 }, (_, index) => ({
            id: `external-group-${index}`,
            displayName: `External Group ${index}`,
            memberCount: index,
            mapping: { state: 'bound', teamGroupId: `team-group-${index}` },
        }));
        nativeGroupsBinding.rows = Array.from({ length: 50 }, (_, index) => ({
            id: `team-group-${index}`,
            name: `Team Group ${index}`,
            memberCount: index,
        }));

        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('directory-group:external-group-49')?.props.subtitle)
            .toBe('identityAdministration.mappedTo: Team Group 49');
        expect(useTeamGroupMock).not.toHaveBeenCalled();
    });

    it('disables source and mapping mutations for a read-only Team', async () => {
        canMutateMock.current = false;
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: ['teams.directory.sources.sync', 'teams.directory.sources.remove'], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = [{
            id: 'external-group-1', displayName: 'Engineering', memberCount: 4, mapping: { state: 'unbound' },
        }];
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('team-directory-source-sync')?.props.disabled).toBe(true);
        expect(screen.findByTestId('team-directory-source-remove')?.props.disabled).toBe(true);
        expect(screen.findByTestId('directory-group:external-group-1')?.props.disabled).toBe(true);
    });

    it('blocks source and mapping mutations while its authoritative projection refreshes', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: true, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: ['teams.directory.sources.sync', 'teams.directory.sources.remove'], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = [{
            id: 'external-group-1', displayName: 'Engineering', memberCount: 4, mapping: { state: 'unbound' },
        }];
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('team-directory-source-sync')?.props.disabled).toBe(true);
        expect(screen.findByTestId('team-directory-source-remove')?.props.disabled).toBe(true);
        expect(screen.findByTestId('directory-group:external-group-1')?.props.disabled).toBe(true);
    });

    it('keeps its hook order stable when the source finishes loading', async () => {
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);
        await expect(act(async () => {
            directoryBinding.state = {
                kind: 'ready',
                refreshing: false,
                stale: false,
                failure: null,
                item: {
                    v: 1,
                    id: 'source-1',
                    teamId: 'team-1',
                    kind: 'workos_directory',
                    displayName: 'Example directory',
                    state: 'paused',
                    allowedActions: ['teams.directory.sources.resume'],
                    sync: {
                        mode: 'events_and_full',
                        attempt: 'paused',
                        freshness: 'stale',
                        lastAttemptAt: null,
                        lastSuccessAt: null,
                        lastFullReconcileAt: null,
                        nextScheduledAt: null,
                    },
                    error: null,
                },
            };
            directoryBinding.publish();
        })).resolves.toBeUndefined();
        expect(screen.findByTestId('team-directory-source-status')?.props.detail)
            .toBe('teams.authentication.directory.state.paused');
        expect(screen.tree.root.findAllByType('VirtualizedList' as never)).toHaveLength(1);
    });

    it('keeps the Team shell notices and one list root while the source is still loading', async () => {
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('team-shell-header')).not.toBeNull();
        expect(screen.tree.root.findAllByType('VirtualizedList' as never)).toHaveLength(1);
    });

    it('keeps the Team shell notices and one list root when the source is unavailable', async () => {
        directoryBinding.state = {
            kind: 'unavailable',
            failure: { code: 'home_unreachable', retryable: true },
        };
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('team-shell-header')).not.toBeNull();
        expect(screen.findByTestId('team-directory-source-unavailable')).not.toBeNull();
        expect(screen.tree.root.findAllByType('VirtualizedList' as never)).toHaveLength(1);
    });

    it('keeps the Team shell notices when the viewer may not manage this directory', async () => {
        capabilitiesMock.current = { manageAuthentication: false, manageGroups: false };
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('team-shell-header')).not.toBeNull();
        expect(screen.findByTestId('team-directory-source-forbidden')).not.toBeNull();
    });

    it('keeps source administration available without exposing Group mappings to an authentication-only manager', async () => {
        capabilitiesMock.current = { manageAuthentication: true, manageGroups: false };
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: ['teams.directory.sources.sync', 'teams.directory.sources.pause', 'teams.directory.sources.remove'], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = [{
            id: 'external-group-1', displayName: 'Engineering', memberCount: 4, mapping: { state: 'unbound' },
        }];

        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('team-directory-source-status')).not.toBeNull();
        expect(screen.findByTestId('team-directory-source-sync')?.props.disabled).toBe(false);
        expect(screen.findByTestId('team-directory-source-pause')?.props.disabled).toBe(false);
        expect(screen.findByTestId('team-directory-source-remove')?.props.disabled).toBe(false);
        expect(screen.findByTestId('directory-groups-search')).toBeNull();
        expect(screen.findByTestId('directory-group:external-group-1')).toBeNull();
        expect(directoryGroupsBinding.enabled).toBe(false);

        await screen.pressByTestIdAsync('team-directory-source-sync');
        expect(runActionMock).toHaveBeenCalledWith('teams.directory.sources.sync', {
            onApprovalFailed: expect.any(Function),
        });
    });

    it('does not let Group authority substitute for authentication administration authority', async () => {
        capabilitiesMock.current = { manageAuthentication: false, manageGroups: true };

        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        expect(screen.findByTestId('team-directory-source-forbidden')).not.toBeNull();
        expect(screen.findByTestId('directory-groups-search')).toBeNull();
    });

    it('presents the canonical typed message for source and action failures', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'needs_attention', allowedActions: ['teams.directory.sources.sync'],
                error: { code: 'directory_source_permission_lost', retryable: false },
                sync: { mode: 'events_and_full', attempt: 'failed', freshness: 'stale', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        runActionMock.mockResolvedValueOnce({
            ok: false,
            failure: { code: 'directory_sync_rate_limited', retryable: true },
        });

        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        // A lost directory permission is an administrator's job, not a provider
        // outage: the one failure owner answers `needs_attention` so no Retry
        // is offered for something a retry cannot clear.
        expect(screen.findByTestId('team-directory-source-error')?.props.title)
            .toBe('identityAdministration.errorNeedsAttention');
        await screen.pressByTestIdAsync('team-directory-source-sync');
        const visibleMessage = screen.findByTestId('team-directory-source-action-error')?.props.title;
        expect(visibleMessage).toBe('identityAdministration.errorRateLimited');
        expect(announceMock).toHaveBeenCalledWith(visibleMessage);

        // The Home refuses Sync with needs-attention only for a paused source
        // (child 05 :498), whose recovery is Resume.
        runActionMock.mockResolvedValueOnce({
            ok: false,
            failure: { code: 'directory_sync_needs_attention', retryable: false },
        });
        await screen.pressByTestIdAsync('team-directory-source-sync');
        expect(screen.findByTestId('team-directory-source-action-error')?.props.title)
            .toBe('identityAdministration.errorSyncPaused');
    });

    it('offers the existing Sync control as Retry while the source reports a failure', async () => {
        const sourceWith = (error: Record<string, unknown> | null) => ({
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: error ? 'needs_attention' : 'active',
                allowedActions: ['teams.directory.sources.sync', 'teams.directory.sources.pause'],
                error,
                sync: { mode: 'events_and_full', attempt: error ? 'failed' : 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        });
        directoryBinding.state = sourceWith({ code: 'directory_source_permission_lost', retryable: false });

        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        // child 05 §14.1: a failed source offers Retry, and pressing it runs
        // the one Sync Action (a complete scan), not a Pause → Resume detour.
        expect(screen.findByTestId('team-directory-source-sync')?.props.title).toBe('common.retry');
        await screen.pressByTestIdAsync('team-directory-source-sync');
        expect(runActionMock).toHaveBeenCalledWith('teams.directory.sources.sync', expect.anything());

        await act(async () => {
            directoryBinding.state = sourceWith(null);
            directoryBinding.publish();
        });
        expect(screen.findByTestId('team-directory-source-sync')?.props.title)
            .toBe('teams.authentication.directory.actions.sync');
    });

    it('binds the mounted directory Group list to its exact Home Team wake', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: [], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };

        await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        // A projection change is published as the Team AccountChange; without
        // this subscription a mounted Group list kept its old rows until remount.
        expect(directoryGroupsBinding.accountChange)
            .toEqual({ serverId: 'home-1', entityId: TEAMS_ACCOUNT_CHANGE_ENTITY_ID_V1 });
    });

    it('opens exact source-bound WorkOS recovery for immediate and approved results', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                workosAdminPortalConnectionId: 'connection-1',
                state: 'needs_attention', allowedActions: ['teams.directory.sources.sync'], error: null,
                sync: { mode: 'events_and_full', attempt: 'failed', freshness: 'stale', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        await screen.pressByTestIdAsync('team-directory-source-open-workos');
        expect(executeIdentityActionMock).toHaveBeenCalledWith(
            'teams.identity.workos.adminPortalLink.create',
            {
                v: 1,
                teamId: 'team-1',
                connectionId: 'connection-1',
                directorySourceId: 'source-1',
                intent: 'dsync',
            },
            expect.objectContaining({
                onApprovalSucceeded: expect.any(Function),
                onApprovalFailed: expect.any(Function),
            }),
        );
        expect(openExternalUrlMock).toHaveBeenCalledWith('https://setup.example.test/dsync');
        await act(async () => {
            for (const listener of appStateListeners) listener('active');
        });
        expect(refreshSourceMock).toHaveBeenCalledOnce();

        let continueApproved: ((value: Readonly<{ url: string }>) => Promise<void>) | undefined;
        executeIdentityActionMock.mockImplementationOnce(async (
            _actionId: string,
            _input: unknown,
            options: Readonly<{ onApprovalSucceeded: typeof continueApproved }>,
        ) => {
            continueApproved = options.onApprovalSucceeded;
            return { ok: false, approvalPending: true, artifactId: 'approval-portal', failure: { code: 'approval_pending', retryable: false } };
        });
        await screen.pressByTestIdAsync('team-directory-source-open-workos');
        expect(continueApproved).toBeTypeOf('function');
        await act(async () => {
            await continueApproved?.({ url: 'https://setup.example.test/approved' });
        });
        expect(openExternalUrlMock).toHaveBeenCalledWith('https://setup.example.test/approved');
    });

    it('navigates back exactly once when approved source removal executes', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: ['teams.directory.sources.remove'], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        let finishRemoval: ((value: Readonly<{ sourceId: string }>) => void | Promise<void>) | undefined;
        removeSourceMock.mockImplementationOnce(async (
            options?: Readonly<{ onApprovalSucceeded?: typeof finishRemoval }>,
        ) => {
            finishRemoval = options?.onApprovalSucceeded;
            return {
                ok: false,
                approvalPending: true,
                artifactId: 'approval-source-remove',
                failure: { code: 'approval_pending', retryable: false },
            };
        });
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        await screen.pressByTestIdAsync('team-directory-source-remove');
        expect(removeSourceMock).toHaveBeenCalledWith(expect.objectContaining({
            onApprovalSucceeded: expect.any(Function),
            onApprovalFailed: expect.any(Function),
        }));
        expect(finishRemoval).toBeTypeOf('function');
        expect(routerBackMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('team-directory-source-action-error')).toBeNull();

        await act(async () => {
            await finishRemoval?.({ sourceId: 'source-1' });
        });
        expect(routerBackMock).toHaveBeenCalledOnce();
    });

    it('reloads a mapping after approval and exposes terminal failure for retry', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: [], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = [{
            id: 'external-group-1', sourceId: 'source-1', externalGroupId: 'external-1', displayName: 'Engineering',
            memberCount: 4, mapping: { state: 'unbound' },
        }];
        let finishMapping: (() => void | Promise<void>) | undefined;
        let failMapping: ((code: string) => void) | undefined;
        executeExternalGroupBindingMock.mockImplementationOnce(async (
            _actionId: string,
            _input: unknown,
            options?: Readonly<{
                onApprovalSucceeded?: typeof finishMapping;
                onApprovalFailed?: typeof failMapping;
            }>,
        ) => {
            finishMapping = options?.onApprovalSucceeded;
            failMapping = options?.onApprovalFailed;
            return {
                ok: false,
                approvalPending: true,
                artifactId: 'approval-group-map',
                failure: { code: 'approval_pending', retryable: false },
            };
        });
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        await screen.pressByTestIdAsync('directory-group:external-group-1');
        await screen.pressByTestIdAsync('directory-group-map-create');
        expect(executeExternalGroupBindingMock).toHaveBeenCalledWith(
            'teams.externalGroupBindings.set',
            expect.any(Object),
            expect.objectContaining({
                onApprovalSucceeded: expect.any(Function),
                onApprovalFailed: expect.any(Function),
            }),
        );
        expect(finishMapping).toBeTypeOf('function');
        expect(failMapping).toBeTypeOf('function');
        expect(directoryGroupsReloadMock).not.toHaveBeenCalled();
        expect(screen.findByTestId('directory-group-mapping-failure')).toBeNull();

        await act(async () => {
            await finishMapping?.();
        });
        expect(directoryGroupsReloadMock).toHaveBeenCalledOnce();
        expect(screen.findByTestId('directory-group-map-create')).toBeNull();

        await act(async () => {
            failMapping?.('approval_rejected');
        });
        expect(screen.findByTestId('directory-group-mapping-failure')).not.toBeNull();
        expect(screen.findByTestId('directory-group:external-group-1')?.props.disabled).toBe(false);
    });

    it('names the target Team Group and the people a mapping change moves before asking to confirm', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: [], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = [{
            id: 'external-group-1', sourceId: 'source-1', externalGroupId: 'external-1', displayName: 'External engineering',
            memberCount: 12, mapping: { state: 'bound', bindingId: 'binding-1', teamGroupId: 'team-group-opaque-id' },
        }];
        nativeGroupsBinding.rows = [{ id: 'team-group-opaque-id', name: 'Platform Engineering', memberCount: 4 }];
        // Declining keeps this test on the confirmation contract: what the
        // person is told before anything is written.
        modalConfirmMock.mockResolvedValue(false);
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        await screen.pressByTestIdAsync('directory-group:external-group-1');
        await screen.pressByTestIdAsync('directory-group-native-target:team-group-opaque-id');

        expect(modalConfirmMock).toHaveBeenCalledWith(
            'identityAdministration.chooseGroup',
            'External engineering\nidentityAdministration.mappedTo: Platform Engineering\nteams.groups.memberCount(count=12)',
            expect.any(Object),
        );

        modalConfirmMock.mockClear();
        await screen.pressByTestIdAsync('directory-group-remove-mapping');

        expect(modalConfirmMock).toHaveBeenCalledWith(
            'identityAdministration.removeMapping',
            'External engineering\nidentityAdministration.mappedTo: Platform Engineering\nteams.groups.memberCount(count=12)',
            expect.objectContaining({ destructive: true }),
        );
    });

    it('opens the mapping chooser beside the pressed group instead of after the whole list', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: [], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = Array.from({ length: 30 }, (_, index) => ({
            id: `external-group-${index}`,
            displayName: `External Group ${index}`,
            memberCount: index,
            mapping: { state: 'unbound' },
        }));
        nativeGroupsBinding.rows = [{ id: 'team-group-1', name: 'Platform Engineering', memberCount: 4 }];
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        await screen.pressByTestIdAsync('directory-group:external-group-0');

        const order = collectRenderedTestIds(screen.tree.toJSON());
        expect(order.indexOf('directory-group:external-group-11'))
            .toBeLessThan(order.indexOf('directory-group-map-create'));
        expect(order.indexOf('directory-group-map-create'))
            .toBeLessThan(order.indexOf('directory-group:external-group-12'));
    });

    it('lets the expanded existing-group chooser collapse instead of rendering an inert row', async () => {
        directoryBinding.state = {
            kind: 'ready', refreshing: false, stale: false, failure: null,
            item: {
                v: 1, id: 'source-1', teamId: 'team-1', kind: 'workos_directory', displayName: 'Example directory',
                state: 'active', allowedActions: [], error: null,
                sync: { mode: 'events_and_full', attempt: 'succeeded', freshness: 'fresh', lastAttemptAt: null, lastSuccessAt: null, lastFullReconcileAt: null, nextScheduledAt: null },
            },
        };
        directoryGroupsBinding.rows = [{
            id: 'external-group-1', displayName: 'Engineering', memberCount: 4, mapping: { state: 'unbound' },
        }];
        const screen = await renderScreen(<DirectorySourceDetailScreen serverId="home-1" teamId="team-1" sourceId="source-1" />);

        await screen.pressByTestIdAsync('directory-group:external-group-1');
        expect(screen.findByTestId('directory-group-map-existing')?.props.onPress).toEqual(expect.any(Function));

        await screen.pressByTestIdAsync('directory-group-map-existing');
        expect(screen.findByTestId('directory-group-map-existing')).toBeNull();
    });
});
