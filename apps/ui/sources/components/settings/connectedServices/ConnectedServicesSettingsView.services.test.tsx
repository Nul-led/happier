import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';

import {
    connectedServicesModuleState,
    installConnectedServicesCommonModuleMocks,
} from './connectedServicesTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installConnectedServicesCommonModuleMocks();

const profileState = vi.hoisted(() => ({
    connectedServicesV2: [] as Array<Record<string, unknown>>,
    connectedAccountsV4: [] as Array<Record<string, unknown>>,
    connectedAccountGroupsV4: [] as Array<Record<string, unknown>>,
}));
const registryState = vi.hoisted(() => ({
    status: 'ready' as 'loading' | 'ready' | 'stale' | 'error' | 'conflict',
    entries: [] as Array<Record<string, unknown>>,
}));

const CLAUDE = { pluginId: 'happier.agent.claude', localId: 'anthropic' };
const CODEX = { pluginId: 'happier.agent.codex', localId: 'openai-codex' };
const VAULT = { pluginId: 'acme.connected-accounts-conformance', localId: 'vault' };

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: () => ({
        status: 'ready',
        features: {
            capabilities: {
                connectedServices: { qualifiedAccounts: { protocolVersion: 4 } },
            },
        },
    }),
}));

vi.mock('@/sync/store/hooks', () => ({
    useActiveServerAccountScope: () => null,
    useProfile: () => ({
        connectedServicesV2: profileState.connectedServicesV2,
        connectedAccountsV4: profileState.connectedAccountsV4,
        connectedAccountGroupsV4: profileState.connectedAccountGroupsV4,
    }),
    useSettings: () => ({
        connectedServicesDefaultProfileByServiceId: {},
        connectedServicesProfileLabelByKey: {},
        connectedServicesProviderStateSharingSettingsV1: {},
        connectedServicesDefaultAuthByAgentIdV1: {},
    }),
    useSettingMutable: () => [{}, vi.fn()],
    useLocalSetting: () => 1,
}));

vi.mock('@/hooks/teams/useHomeTeamCredentialModelCatalog', () => ({
    useHomeTeamCredentialModelCatalog: () => ({
        resources: [], teamNameById: {}, homeNameByTeamId: {}, currentResourceKeys: new Set(), current: true,
    }),
}));

vi.mock('@/components/appShell/plugins/AppShellPluginUiProjection', () => ({
    useAppShellPluginUiProjection: () => ({ machineId: null, serverId: null }),
    useProjectedPluginLocalizedTextResolver: () => (_pluginId: string, value: unknown) => (typeof value === 'string' ? value : ''),
    useProjectedConnectedServicesRegistry: () => ({
        scopeKey: 'server-1',
        status: registryState.status,
        errorReason: null,
        entries: registryState.entries,
    }),
}));

vi.mock('@/sync/domains/connectedServices/connectedServiceRegistry', () => ({
    getLegacyConnectedServiceRegistryEntry: (serviceId: string) => ({
        serviceId, connectCommand: `happier connect ${serviceId}`, supportsOauth: false, executable: false,
    }),
    // The generated built-in fallback names a released service no machine publishes right now.
    getGeneratedLegacyConnectedServiceRegistryFallback: (service: { pluginId: string; localId: string }) => (
        service.pluginId === CLAUDE.pluginId && service.localId === CLAUDE.localId
            ? {
                serviceId: 'anthropic', legacyServiceId: 'anthropic', service: CLAUDE,
                connectCommand: 'happier connect anthropic', supportsOauth: false,
                displayNameKey: 'connectedServices.names.anthropic',
            }
            : null
    ),
    getConnectedServiceRegistrySnapshot: () => ({
        scopeKey: 'server-1', status: 'ready', errorReason: null, entries: registryState.entries,
    }),
    installConnectedAccountDescriptorProjection: vi.fn(),
}));

// Quota reads are server requests; the index's account list does not depend on them.
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaBadges', () => ({
    useConnectedServiceQuotaBadges: () => ({}),
}));
vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaSummaries', () => ({
    useConnectedServiceQuotaSummaries: () => ({ summaries: [], isRefreshing: false, hasConnectedProfiles: false }),
}));

vi.mock('./ConnectedServicesDefaultAuthRow', () => ({
    ConnectedServicesDefaultAuthRow: (props: Record<string, unknown>) =>
        React.createElement('ConnectedServicesDefaultAuthRow', props),
}));

vi.mock('./ConnectedServicesProviderStateSharingSettings', () => ({
    ConnectedServicesProviderStateSharingDisclosure: (props: Record<string, unknown>) =>
        React.createElement('ConnectedServicesProviderStateSharingDisclosure', props),
}));

// The account block owns its own quota subscription (a network read); the index only decides which
// accounts it lists, so a host stand-in keeps the props assertable.
vi.mock('./account/QualifiedAccountBlock', () => ({
    QualifiedAccountBlock: (props: Record<string, unknown>) => React.createElement('QualifiedAccountBlock', props),
}));
vi.mock('./account/AccountBlock', () => ({
    AccountBlock: (props: Record<string, unknown>) => React.createElement('AccountBlock', props),
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: ({ children }: { children?: React.ReactNode }) => React.createElement('ItemList', null, children),
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, ...props }: { children?: React.ReactNode }) =>
        React.createElement('ItemGroup', props, children),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: { rightElement?: React.ReactNode; leftElement?: React.ReactNode }) =>
        React.createElement('Item', props, props.leftElement, props.rightElement),
}));

function account(service: { pluginId: string; localId: string }, accountId: string, status: string) {
    return {
        ref: { service, accountId },
        status,
        authenticationModeId: 'oauth',
        revisionSemantics: 'revisioned',
        credentialRevision: `cred-${accountId}`,
        configurationReady: true,
        configurationRevision: null,
        scopes: [],
        providerIdentity: { email: `${accountId}@example.com` },
    };
}

function entry(service: { pluginId: string; localId: string }, title: string) {
    return {
        serviceId: service.localId,
        service,
        connectCommand: `happier connect ${service.localId}`,
        supportsOauth: true,
        executable: true,
        projectedTitle: title,
    };
}

async function renderView() {
    const { ConnectedServicesSettingsView } = await import('./ConnectedServicesSettingsView');
    return (await renderScreen(<ConnectedServicesSettingsView />)).tree;
}

function byTestId(tree: Awaited<ReturnType<typeof renderView>>, testID: string) {
    return tree.root.findAll((node) => node.props?.testID === testID);
}

describe('ConnectedServicesSettingsView services', () => {
    beforeEach(() => {
        registryState.status = 'ready';
        registryState.entries = [entry(CLAUDE, 'Claude subscription'), entry(CODEX, 'ChatGPT subscription'), entry(VAULT, 'Acme Vault')];
        profileState.connectedServicesV2 = [];
        profileState.connectedAccountsV4 = [
            account(CLAUDE, 'work', 'connected'),
            account(CLAUDE, 'personal', 'needs_reauth'),
        ];
        profileState.connectedAccountGroupsV4 = [];
        connectedServicesModuleState.routerPushSpy.mockClear();
    });

    it('lists a service with its accounts inside it, and offers services without accounts in one connect row', async () => {
        const tree = await renderView();

        const header = byTestId(tree, 'connected-services-service:happier.agent.claude/anthropic')[0]!;
        let claudeSheet = header.parent;
        while (claudeSheet && claudeSheet.type !== ('ItemGroup' as never)) claudeSheet = claudeSheet.parent;
        expect(claudeSheet).toBeTruthy();
        const blocks = claudeSheet!.findAllByType('QualifiedAccountBlock' as never);
        // Attention first: the account that needs a new sign-in leads.
        expect(blocks.map((block) => block.props.account.accountId)).toEqual(['personal', 'work']);

        expect(byTestId(tree, 'connected-services-service:happier.agent.codex/openai-codex')).toHaveLength(0);
        expect(byTestId(tree, 'connected-services-connect')).not.toHaveLength(0);
        // Two candidates: the invitation's button opens a menu of them rather than guessing one.
        const menu = byTestId(tree, 'connected-services-connect-menu')[0]!;
        expect(menu.props.items.map((item: { title: string }) => item.title))
            .toEqual(['Acme Vault', 'ChatGPT subscription']);
    });

    it('keeps accounts listed when no online machine publishes their service', async () => {
        registryState.entries = [];

        const tree = await renderView();

        const header = byTestId(tree, 'connected-services-service:happier.agent.claude/anthropic');
        expect(header).not.toHaveLength(0);
        expect(header[0]!.props.title).toBeTruthy();
        expect(tree.root.findAllByType('QualifiedAccountBlock' as never)).toHaveLength(2);
    });

    it('leads a service that needs a sign-in to that account, and adds accounts from the service header', async () => {
        const tree = await renderView();

        await pressTestInstanceAsync(byTestId(tree, 'connected-services-service:happier.agent.claude/anthropic:sign-in-again')[0]!);
        expect(connectedServicesModuleState.routerPushSpy).toHaveBeenLastCalledWith({
            pathname: '/(app)/settings/connected-services/account',
            params: { pluginId: CLAUDE.pluginId, localId: CLAUDE.localId, accountId: 'personal' },
        });

        profileState.connectedAccountsV4 = [account(CLAUDE, 'work', 'connected')];
        const healthy = await renderView();
        expect(byTestId(healthy, 'connected-services-service:happier.agent.claude/anthropic:sign-in-again')).toHaveLength(0);
        // "Add account" opens the service on its new-account draft.
        await pressTestInstanceAsync(byTestId(healthy, 'connected-services-service:happier.agent.claude/anthropic:add-account')[0]!);
        expect(connectedServicesModuleState.routerPushSpy).toHaveBeenLastCalledWith({
            pathname: '/(app)/settings/connected-services/account',
            params: { pluginId: CLAUDE.pluginId, localId: CLAUDE.localId, add: '1' },
        });
    });
});
