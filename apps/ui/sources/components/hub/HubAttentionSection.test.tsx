import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { ConnectedServiceRegistryEntry } from '@/sync/domains/connectedServices/connectedServiceRegistry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
    profile: null as unknown,
    loginState: 'logged_in' as 'logged_in' | 'logged_out',
    push: null as ((route: unknown) => void) | null,
    pluginCapabilities: null as unknown,
    unavailableServerIds: [] as string[],
    retried: [] as string[],
}));

const SERVICE = { pluginId: 'happier.example', localId: 'subscription' } as const;
const SERVICE_ENTRY = {
    serviceId: 'example-subscription',
    service: SERVICE,
    connectCommand: 'happier connect example-subscription',
    supportsOauth: true,
    projectedTitle: 'Example subscription',
} as unknown as ConnectedServiceRegistryEntry;

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: (route: unknown) => state.push?.(route) } }).module;
});

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ useProfile: () => state.profile });
});

// The server's feature answer decides which account transport the profile carries.
vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: () => ({
        status: 'ready',
        features: { capabilities: { connectedServices: { qualifiedAccounts: { protocolVersion: 4 } } } },
    }),
}));

// Plugin-contributed service descriptors arrive through the app-shell projection.
vi.mock('@/components/appShell/plugins/AppShellPluginUiProjection', () => ({
    useProjectedConnectedServicesRegistry: () => ({ status: 'ready', entries: [SERVICE_ENTRY] }),
    useProjectedPluginLocalizedTextResolver: () => (_pluginId: string, value: unknown) => (typeof value === 'string' ? value : null),
}));

// The Agents machine: its selection and daemon projection, then its CLI detection cache.
vi.mock('@/components/settings/agents/collection/useAgentAdministrationCatalog', async () => {
    const { createResolvedAgentCatalogEntryFixture: fixture } = await import('@/dev/testkit/fixtures/agentCatalogFixtures');
    const entries = [fixture({
        agentId: 'claude',
        // A machine-installed CLI agent: the detection reports its sign-in state.
        overrides: {
            title: 'Claude',
            enabled: true,
            cli: { executable: { binaryName: 'claude', sourcePreference: 'system-first' } } as never,
        },
    })];
    return {
        useAgentAdministrationCatalog: (options?: { loadProjection?: boolean }) => {
            // Loading the projection is a daemon call; the Settings home reads the cache only.
            if (options?.loadProjection !== false) throw new Error('the Settings home must not load the agent projection');
            return {
                targetSelection: {},
                executionTarget: { machine: { id: 'machine-1' }, serverId: 'server-1' },
                machineOnline: true,
                machineLabel: 'MacBook Pro',
                projectionCurrent: true,
                agentEntries: entries,
            };
        },
    };
});


vi.mock('@/agents/presentation/AgentCatalogIdentityIcon', () => ({
    AgentCatalogIdentityIcon: () => null,
}));

// The Plugins machine (selection store) and its last daemon answer (the capabilities cache).
vi.mock('@/sync/domains/machines/administration/useTargetSelection', () => ({
    useMachineAdministrationTargetSelection: () => ({
        resolveExecutionTarget: () => ({ machine: { id: 'machine-1', daemonStateVersion: 3 }, serverId: 'server-1' }),
    }),
}));

// The getting-started model owner decides which selected Homes are not answering (tested at its owner).
vi.mock('@/components/sessions/guidance/useSessionGettingStartedGuidanceBaseModel', () => ({
    useSessionGettingStartedGuidanceBaseModel: () => ({ kind: 'create_session', unavailableServerIds: state.unavailableServerIds }),
}));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    getServerProfileById: (id: string) => (id === 'srv-b' ? { id: 'srv-b', name: 'Studio', serverUrl: 'https://studio.example' } : null),
}));
// The other Home's refresh (its transport boundary).
vi.mock('@/sync/domains/session/listing/sessionListQueryRuntime', () => ({
    refreshOrdinarySessionList: async (serverId: string) => { state.retried.push(serverId); },
}));

// The daemon RPC boundary under the real capabilities cache: the Plugins page asks through it.
vi.mock('@/sync/ops', () => ({
    machineCapabilitiesDetect: async () => ({ supported: true, response: state.pluginCapabilities }),
}));

function pluginsAnswer(pendingChanges: unknown[]) {
    return { protocolVersion: 1, results: { 'tool.plugins': { ok: true, checkedAt: 1, data: { installedPlugins: [], pendingChanges } } } };
}

afterEach(() => {
    standardCleanup();
    state.unavailableServerIds = [];
    state.retried = [];
    vi.resetModules();
});

function account(accountId: string, status: 'connected' | 'needs_reauth') {
    return { ref: { service: SERVICE, accountId }, status };
}

async function renderSection() {
    const push = vi.fn();
    state.push = push;
    const { HubAttentionSection } = await import('./HubAttentionSection');
    const screen = await renderScreen(<HubAttentionSection />);
    const actions = screen.findAll((node) => typeof node.props?.testID === 'string'
        && node.props.testID.endsWith('.action')
        && typeof node.props.onPress === 'function');
    return { screen, push, actions };
}

describe('HubAttentionSection', () => {
    it('lists a signed-out agent and an expired account, each with the action that fixes it', async () => {
        state.loginState = 'logged_out';
        state.profile = { connectedServicesV2: [], connectedAccountsV4: [account('acct-ok', 'connected'), account('acct-1', 'needs_reauth')] };
        const { screen, push, actions } = await renderSection();

        expect(screen.getTextContent()).toContain('MacBook Pro');
        expect(screen.getTextContent()).toContain('Example subscription');
        const testIDs = [...new Set(actions.map((node) => node.props.testID as string))];
        expect(testIDs).toEqual([
            'settings-overview-attention.agent:claude.action',
            'settings-overview-attention.service:happier.example/subscription/acct-1.action',
        ]);

        actions.find((node) => node.props.testID === testIDs[0])!.props.onPress();
        actions.find((node) => node.props.testID === testIDs[1])!.props.onPress();
        expect(push).toHaveBeenNthCalledWith(1, '/(app)/settings/agents/claude');
        expect(push).toHaveBeenNthCalledWith(2, expect.objectContaining({
            params: expect.objectContaining({ pluginId: SERVICE.pluginId, localId: SERVICE.localId, accountId: 'acct-1' }),
        }));
    });

    it('is absent when nothing needs the person', async () => {
        state.loginState = 'logged_in';
        state.profile = { connectedServicesV2: [], connectedAccountsV4: [account('acct-ok', 'connected')] };
        const { screen } = await renderSection();

        expect(screen.getTextContent()).toBe('');
    });

    it('asks for a review when the Plugins machine last reported changes awaiting a decision', async () => {
        const { createPluginInstallationReviewFixture } = await import('@happier-dev/protocol/testing/pluginInstallationReviewFixture');
        state.loginState = 'logged_in';
        state.profile = { connectedServicesV2: [], connectedAccountsV4: [] };
        state.pluginCapabilities = pluginsAnswer([
            { kind: 'reviewRequired', reviewKind: 'installation', reason: 'firstInstall', currentVersion: null, authorityExpansion: [], pendingChangeId: 'p-1', review: createPluginInstallationReviewFixture() },
            { kind: 'applying', pendingChangeId: 'p-2' },
        ]);
        // The Plugins page asked after a transport reconnect (its second freshness generation).
        const { prefetchMachineCapabilities } = await import('@/hooks/server/useMachineCapabilitiesCache');
        await prefetchMachineCapabilities({
            machineId: 'machine-1', serverId: 'server-1', cacheKeySalt: '3:1',
            request: { requests: [{ id: 'tool.plugins' }] } as never, timeoutMs: 1000,
        });
        const { push, actions } = await renderSection();

        const review = actions.find((node) => node.props.testID === 'settings-overview-attention.plugins:awaitingReview.action');
        expect(review).toBeTruthy();
        review!.props.onPress();
        expect(push).toHaveBeenCalledWith('/settings/plugins');
        state.pluginCapabilities = null;
    });

    it('says which other Home is not answering, with Retry, instead of the home waiting on it', async () => {
        state.loginState = 'logged_in';
        state.profile = { connectedServicesV2: [], connectedAccountsV4: [] };
        state.unavailableServerIds = ['srv-b'];
        const { screen, actions } = await renderSection();

        expect(screen.getTextContent()).toContain('Studio');
        const retry = actions.find((node) => node.props.testID === 'settings-overview-attention.home:srv-b.action');
        expect(retry).toBeTruthy();
        await retry!.props.onPress();
        expect(state.retried).toEqual(['srv-b']);
    });
});
