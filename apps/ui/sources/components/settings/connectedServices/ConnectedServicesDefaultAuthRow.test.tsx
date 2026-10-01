import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installConnectedServicesCommonModuleMocks } from './connectedServicesTestHelpers';
import type {
    AccountProfile,
    ConnectedServicesDefaultAuthByAgentIdV1,
    PluginProjectedAgentConnectedAccountPurposeV2,
    QualifiedConnectedAccountPurposeBindingsV1,
} from '@happier-dev/protocol';
import type { TeamCredentialResourceCatalogEntryV1 } from '@happier-dev/protocol/teams';
import type { ConnectedServicesServiceBinding } from '@/sync/domains/connectedServices/connectedServicesAgentOptionStateBindings';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Canonical qualified Connected Account service keys.
const CLAUDE_SERVICE_KEY = 'happier.agent.claude/anthropic';
const CODEX_SERVICE_KEY = 'happier.agent.codex/openai-codex';
const ENCODED_CLAUDE_SERVICE_KEY = encodeURIComponent(CLAUDE_SERVICE_KEY);
const ENCODED_CODEX_SERVICE_KEY = encodeURIComponent(CODEX_SERVICE_KEY);
const CLAUDE_ACCOUNT_PURPOSES: readonly PluginProjectedAgentConnectedAccountPurposeV2[] = [
    { purpose: 'primary', service: { pluginId: 'happier.agent.claude', localId: 'anthropic' } },
];
const CLAUDE_IDENTITY = { pluginId: 'happier.agent.claude', localId: 'claude' } as const;
const CODEX_IDENTITY = { pluginId: 'happier.agent.codex', localId: 'codex' } as const;
/** The Agent default-authentication write: one purpose-binding store, released entries folded away. */
function agentDefaultWrite(
    consumer: Readonly<{ pluginId: string; localId: string }>,
    target: Record<string, unknown>,
) {
    return {
        connectedAccountPurposeBindingsV1: {
            v: 1,
            bindings: [{ purpose: { consumer, purpose: 'primary' }, target }],
        },
        connectedServicesDefaultAuthByAgentIdV1: { v: 1, bindingsByAgentId: {} },
    };
}
/** A Team default persists as the canonical Team selection of its Team (lane 10 child 02 :271). */
function agentTeamDefaultWrite(
    consumer: Readonly<{ pluginId: string; localId: string }>,
    teamResource: Readonly<{ teamId: string; selection: Record<string, unknown> }>,
) {
    return {
        connectedAccountPurposeBindingsV1: {
            v: 1,
            bindings: [],
            teamResourceSelections: [{ purpose: { consumer, purpose: 'primary' }, ...teamResource }],
        },
        connectedServicesDefaultAuthByAgentIdV1: { v: 1, bindingsByAgentId: {} },
    };
}
const CODEX_ACCOUNT_PURPOSES: readonly PluginProjectedAgentConnectedAccountPurposeV2[] = [
    { purpose: 'primary', service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' }, credentialKinds: ['oauth'] },
];

type CapturedDefaultAuthModalProps = Readonly<{
    setBindingForService: (serviceId: string, binding: ConnectedServicesServiceBinding) => void;
}> & Record<string, unknown>;

type CapturedDefaultAuthModalConfig = Readonly<{
    component: React.ComponentType<CapturedDefaultAuthModalProps>;
    props: CapturedDefaultAuthModalProps;
}>;

const modalShowMock = vi.fn((_config: CapturedDefaultAuthModalConfig) => 'default-auth-modal');
const modalUpdateMock = vi.fn((_modalId: string, _props: Record<string, unknown>) => {});

installConnectedServicesCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                show: (config: unknown) => modalShowMock(config as CapturedDefaultAuthModalConfig),
                update: (modalId: string, props: Record<string, unknown>) => modalUpdateMock(modalId, props),
            },
        }).module;
    },
});

vi.mock('@/hooks/server/connectedServices/useConnectedServiceQuotaBadges', () => ({
    useConnectedServiceQuotaBadges: () => ({}),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

const narrowLayoutRef = vi.hoisted(() => ({ value: false }));
vi.mock('@/components/settings/actions/useActionSettingsNarrowLayout', () => ({
    useActionSettingsNarrowLayout: () => narrowLayoutRef.value,
}));

type SelectionListProps = Readonly<{
    selectedOptionId: string | null;
    rootStep: {
        sections: ReadonlyArray<{
            options: ReadonlyArray<{
                id: string;
                disabled?: boolean;
                onSelect: () => void;
            }>;
        }>;
    };
}>;

type ConnectedAccountV4 = AccountProfile['connectedAccountsV4'][number];

function v4Account(params: Readonly<{
    pluginId: string;
    localId: string;
    accountId: string;
    email?: string;
    displayName?: string;
    kind?: 'oauth' | 'token';
}>): ConnectedAccountV4 {
    return {
        revisionSemantics: 'legacy_unfenced',
        ref: {
            service: { pluginId: params.pluginId, localId: params.localId },
            accountId: params.accountId,
        },
        status: 'connected',
        authenticationModeId: null,
        configurationReady: true,
        configurationRevision: null,
        kind: params.kind ?? null,
        expiresAt: null,
        lastUsedAt: null,
        providerIdentity: params.email ? { email: params.email } : {},
        ...(params.displayName ? { displayName: params.displayName } : {}),
    } as ConnectedAccountV4;
}

const CLAUDE_V4_ACCOUNT = v4Account({
    pluginId: 'happier.agent.claude',
    localId: 'anthropic',
    accountId: 'work',
    email: 'work@example.com',
    displayName: 'Work',
    kind: 'token',
});

const CODEX_V4_GROUP: AccountProfile['connectedAccountGroupsV4'][number] = {
    v: 1,
    ref: { service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' }, groupId: 'primary' },
    incarnation: 'primary:1',
    displayName: 'Primary pool',
    policy: { v: 1, strategy: 'least_limited', autoSwitch: true, switchOn: { usageLimit: true, authExpired: true, accountChanged: false, refreshFailure: true } },
    activeConnectedAccountId: 'fresh',
    generation: 0,
    runtimeStateRevision: 1,
    state: { status: 'ready' },
    createdAt: 0,
    updatedAt: 0,
    members: [
        { v: 1, connectedAccountId: 'fresh', priority: 100, enabled: true, state: {}, createdAt: 0, updatedAt: 0 },
    ],
} as AccountProfile['connectedAccountGroupsV4'][number];

const TEAM_RESOURCE: TeamCredentialResourceCatalogEntryV1 = {
    id: 'resource-a',
    teamId: 'team-a',
    displayName: 'Team Codex',
    resourceRevision: 7,
    mayBroker: true,
    mayReceiveDirect: true,
    directMaterialState: 'current',
    sessionUsePolicy: 'personal_allowed',
    providerModels: [],
    sourcePresentation: {
        kind: 'connected_service',
        service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' },
    },
    readiness: { kind: 'available' },
    recoveryAction: null,
    connectedServiceSelections: [
        { source: 'team_resource', resourceId: 'resource-a', deliveryMode: 'brokered' },
        {
            source: 'team_resource', resourceId: 'resource-a', deliveryMode: 'direct',
            disclosedMember: {
                service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' },
                accountId: 'account-a',
            },
        },
    ],
};

function findSelectionListProps(tree: renderer.ReactTestRenderer): SelectionListProps {
    return tree.root.findByProps({
        testID: 'new-session.connected-services.selection-list',
    }).props as SelectionListProps;
}

function findSelectionOption(
    tree: renderer.ReactTestRenderer,
    optionId: string,
): { onSelect: () => void; disabled?: boolean } {
    const listProps = findSelectionListProps(tree);
    for (const section of listProps.rootStep.sections) {
        const option = section.options.find((candidate) => candidate.id === optionId);
        if (option) return option;
    }
    throw new Error(`Selection option not found: ${optionId}`);
}

function getShownModalConfig(index: number): CapturedDefaultAuthModalConfig {
    const config = modalShowMock.mock.calls[index]?.[0];
    if (!config) {
        throw new Error(`Expected shown modal at index ${index}`);
    }
    return config;
}

function findDefaultAuthTrigger(tree: renderer.ReactTestRenderer, agentId: string): Record<string, any> {
    const node = tree.root.findAll((candidate) =>
        candidate.props?.testID === `settings-connected-services-default-auth-${agentId}`
    )[0];
    if (!node) {
        throw new Error(`Expected default auth trigger for ${agentId}`);
    }
    return node.props as Record<string, any>;
}

async function openPickerModal(
    tree: renderer.ReactTestRenderer,
    agentId: string,
    modalIndex = 0,
): Promise<renderer.ReactTestRenderer> {
    await act(async () => {
        findDefaultAuthTrigger(tree, agentId).onPress();
    });
    const config = getShownModalConfig(modalIndex);
    const Content = config.component;
    return (await renderScreen(<Content {...config.props} />)).tree;
}

function hasPoolSuggestion(
    tree: renderer.ReactTestRenderer,
    agentId: string,
    serviceId: string,
): boolean {
    const prefix = `settings-connected-services-pool-adoption-suggestion-${agentId}-${serviceId}`;
    return tree.root.findAll((candidate) => candidate.props?.testID === `${prefix}-accept`).length > 0;
}

describe('ConnectedServicesDefaultAuthRow', () => {
    beforeEach(() => {
        modalShowMock.mockClear();
        modalUpdateMock.mockClear();
        narrowLayoutRef.value = false;
    });

    async function renderClaudeNativeRow() {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');
        return (await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="claude"
                agentIdentity={CLAUDE_IDENTITY}
                agentTitle="Claude"
                connectedAccountPurposes={CLAUDE_ACCOUNT_PURPOSES}
                connectedAccountServiceKeys={[CLAUDE_SERVICE_KEY]}
                connectedAccountsV4={[CLAUDE_V4_ACCOUNT]}
                connectedAccountGroupsV4={[]}
                accountGroupsEnabled={false}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: { v: 1, bindingsByAgentId: {} },
                }}
                setDefaultAuthSettings={vi.fn()}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        )).tree;
    }

    it('on a compact layout shows the selected value in the subtitle and hides the right detail', async () => {
        narrowLayoutRef.value = true;
        const tree = await renderClaudeNativeRow();
        const trigger = findDefaultAuthTrigger(tree, 'claude');
        // Compact: the (long) selected value moves to the subtitle; the right detail
        // is suppressed so it doesn't crowd the title.
        expect(trigger.detail).toBeUndefined();
        expect(trigger.subtitle).toBe('connectedServices.authChip.nativeLabel');
    });

    it('on a wide layout keeps the selected value in the right detail, not the subtitle', async () => {
        narrowLayoutRef.value = false;
        const tree = await renderClaudeNativeRow();
        const trigger = findDefaultAuthTrigger(tree, 'claude');
        expect(trigger.detail).toBe('connectedServices.authChip.nativeLabel');
        expect(trigger.subtitle).toBe('connectedServices.defaultAuth.rowDetail');
    });

    it('writes the per-agent default binding under the canonical qualified key', async () => {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');
        const setDefaultAuthSettings = vi.fn();

        const { tree } = await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="claude"
                agentIdentity={CLAUDE_IDENTITY}
                agentTitle="Claude"
                connectedAccountPurposes={CLAUDE_ACCOUNT_PURPOSES}
                connectedAccountServiceKeys={[CLAUDE_SERVICE_KEY]}
                connectedAccountsV4={[CLAUDE_V4_ACCOUNT]}
                connectedAccountGroupsV4={[]}
                accountGroupsEnabled={false}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: { v: 1, bindingsByAgentId: {} },
                }}
                setDefaultAuthSettings={setDefaultAuthSettings}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        );

        expect(findDefaultAuthTrigger(tree, 'claude').title).toBe('Claude');
        expect(modalShowMock).not.toHaveBeenCalled();

        const modalTree = await openPickerModal(tree, 'claude');
        expect(findSelectionListProps(modalTree).selectedOptionId)
            .toBe(`connected-service:${ENCODED_CLAUDE_SERVICE_KEY}:native`);

        await act(async () => {
            findSelectionOption(modalTree, `connected-service:${ENCODED_CLAUDE_SERVICE_KEY}:profile:work`).onSelect();
        });

        expect(setDefaultAuthSettings).toHaveBeenCalledWith(agentDefaultWrite(CLAUDE_IDENTITY, {
            kind: 'account',
            account: { service: { pluginId: 'happier.agent.claude', localId: 'anthropic' }, accountId: 'work' },
        }));
    });

    it('translates released bundled scalar declarations through the generated built-in mapping', async () => {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');
        const setDefaultAuthSettings = vi.fn();

        const { tree } = await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="claude"
                agentIdentity={CLAUDE_IDENTITY}
                agentTitle="Claude"
                connectedAccountPurposes={CLAUDE_ACCOUNT_PURPOSES}
                // No machine projection passed: the released bundled scalar
                // declaration is the only source and must land qualified.
                connectedAccountServiceKeys={['anthropic']}
                connectedAccountsV4={[CLAUDE_V4_ACCOUNT]}
                connectedAccountGroupsV4={[]}
                accountGroupsEnabled={false}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: { v: 1, bindingsByAgentId: {} },
                }}
                setDefaultAuthSettings={setDefaultAuthSettings}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        );

        const modalTree = await openPickerModal(tree, 'claude');
        await act(async () => {
            findSelectionOption(modalTree, `connected-service:${ENCODED_CLAUDE_SERVICE_KEY}:profile:work`).onSelect();
        });

        expect(setDefaultAuthSettings).toHaveBeenCalledWith(agentDefaultWrite(CLAUDE_IDENTITY, {
            kind: 'account',
            account: { service: { pluginId: 'happier.agent.claude', localId: 'anthropic' }, accountId: 'work' },
        }));
    });

    it('reflects the persisted qualified binding as the selected option in the picker list', async () => {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');

        const { tree } = await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="claude"
                agentIdentity={CLAUDE_IDENTITY}
                agentTitle="Claude"
                connectedAccountPurposes={CLAUDE_ACCOUNT_PURPOSES}
                connectedAccountServiceKeys={[CLAUDE_SERVICE_KEY]}
                connectedAccountsV4={[CLAUDE_V4_ACCOUNT]}
                connectedAccountGroupsV4={[]}
                accountGroupsEnabled={false}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: {
                        v: 1,
                        bindingsByAgentId: {
                            claude: {
                                v: 1,
                                bindingsByServiceId: {
                                    [CLAUDE_SERVICE_KEY]: { source: 'connected', selection: 'profile', profileId: 'work' },
                                },
                            },
                        },
                    },
                }}
                setDefaultAuthSettings={vi.fn()}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        );

        const modalTree = await openPickerModal(tree, 'claude');
        expect(findSelectionListProps(modalTree).selectedOptionId)
            .toBe(`connected-service:${ENCODED_CLAUDE_SERVICE_KEY}:profile:work`);
        expect(modalUpdateMock).not.toHaveBeenCalled();
    });

    it('stores group defaults as group bindings without a fallback profile id', async () => {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');
        const setDefaultAuthSettings = vi.fn();

        const { tree } = await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="codex"
                agentIdentity={CODEX_IDENTITY}
                agentTitle="Codex"
                connectedAccountPurposes={CODEX_ACCOUNT_PURPOSES}
                connectedAccountServiceKeys={[CODEX_SERVICE_KEY]}
                connectedAccountsV4={[v4Account({
                    pluginId: 'happier.agent.codex',
                    localId: 'openai-codex',
                    accountId: 'fresh',
                    kind: 'oauth',
                    displayName: 'Fresh',
                })]}
                connectedAccountGroupsV4={[CODEX_V4_GROUP]}
                accountGroupsEnabled={true}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: { v: 1, bindingsByAgentId: {} },
                }}
                setDefaultAuthSettings={setDefaultAuthSettings}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        );

        const modalTree = await openPickerModal(tree, 'codex');
        await act(async () => {
            findSelectionOption(modalTree, `connected-service:${ENCODED_CODEX_SERVICE_KEY}:group:primary`).onSelect();
        });

        expect(setDefaultAuthSettings).toHaveBeenCalledWith(agentDefaultWrite(CODEX_IDENTITY, {
            kind: 'group',
            service: { pluginId: 'happier.agent.codex', localId: 'openai-codex' },
            groupId: 'primary',
        }));
    });

    it.each(['brokered', 'direct'] as const)(
        'persists and reloads an exact Team-qualified %s Team resource default',
        async (deliveryMode) => {
            const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');
            const setDefaultAuthSettings = vi.fn();
            const selection = TEAM_RESOURCE.connectedServiceSelections.find((candidate) => candidate.deliveryMode === deliveryMode)!;

            const renderRow = async (
                persisted: QualifiedConnectedAccountPurposeBindingsV1 = { v: 1, bindings: [] },
            ) => (await renderScreen(
                <ConnectedServicesDefaultAuthRow
                    agentId="codex"
                    agentIdentity={CODEX_IDENTITY}
                    agentTitle="Codex"
                    connectedAccountPurposes={CODEX_ACCOUNT_PURPOSES}
                    connectedAccountServiceKeys={[CODEX_SERVICE_KEY]}
                    connectedAccountsV4={[]}
                    connectedAccountGroupsV4={[]}
                    accountGroupsEnabled={true}
                    teamCredentialResources={[TEAM_RESOURCE]}
                    teamNameById={{ 'team-a': 'Acme' }}
                    currentTeamCredentialResourceKeys={new Set(['team-a:resource-a'])}
                    settings={{
                        connectedServicesProfileLabelByKey: {},
                        connectedServicesDefaultProfileByServiceId: {},
                        connectedAccountPurposeBindingsV1: persisted,
                    }}
                    setDefaultAuthSettings={setDefaultAuthSettings}
                    onOpenConnectedServicesSettings={vi.fn()}
                />,
            )).tree;

            const tree = await renderRow();
            const modalTree = await openPickerModal(tree, 'codex');
            const optionId = deliveryMode === 'brokered'
                ? 'connected-service:team-resource:resource-a:brokered:brokered'
                : `connected-service:team-resource:resource-a:direct:${CODEX_SERVICE_KEY.replace('/', '%2F')}:account-a`;
            await act(async () => findSelectionOption(modalTree, optionId).onSelect());

            const written = setDefaultAuthSettings.mock.calls[0]![0];
            // A default is a Team-qualified reference, never a pinned revision.
            expect(written).toEqual(agentTeamDefaultWrite(CODEX_IDENTITY, {
                teamId: 'team-a',
                selection,
            }));

            const reloadedTree = await renderRow(written.connectedAccountPurposeBindingsV1);
            const reloadedModal = await openPickerModal(reloadedTree, 'codex', 1);
            expect(findSelectionListProps(reloadedModal).selectedOptionId).toBe(optionId);
        },
    );

    it('keeps an earlier-0.3 Team resource default the Home no longer offers selected and unavailable, without native fallback', async () => {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');
        const onRecoverTeamCredentialResource = vi.fn();
        // Exactly what an earlier 0.3 build's row persisted (service-keyed, Home-qualified).
        const persisted: ConnectedServicesDefaultAuthByAgentIdV1 = {
            v: 1,
            bindingsByAgentId: {
                codex: {
                    v: 2,
                    bindingsByServiceId: {
                        [CODEX_SERVICE_KEY]: {
                            source: 'team_resource',
                            serverId: 'home-a',
                            accountId: 'recipient-account',
                            teamId: 'team-a',
                            resourceId: 'resource-a',
                            expectedResourceRevision: 6,
                            deliveryMode: 'brokered',
                        },
                    },
                },
            },
        };
        const { tree } = await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="codex"
                agentIdentity={CODEX_IDENTITY}
                agentTitle="Codex"
                connectedAccountPurposes={CODEX_ACCOUNT_PURPOSES}
                connectedAccountServiceKeys={[CODEX_SERVICE_KEY]}
                connectedAccountsV4={[]}
                connectedAccountGroupsV4={[]}
                accountGroupsEnabled={true}
                teamCredentialResources={[TEAM_RESOURCE]}
                teamNameById={{ 'team-a': 'Acme' }}
                currentTeamCredentialResourceKeys={new Set<string>()}
                onRecoverTeamCredentialResource={onRecoverTeamCredentialResource}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: persisted,
                }}
                setDefaultAuthSettings={vi.fn()}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        );

        const modalTree = await openPickerModal(tree, 'codex');
        const list = findSelectionListProps(modalTree);
        const teamOptionId = 'connected-service:team-resource:resource-a:brokered:brokered';
        expect(list.selectedOptionId).toBe(teamOptionId);
        const staleOption = findSelectionOption(modalTree, teamOptionId);
        expect(staleOption.disabled).toBe(false);
        await act(async () => staleOption.onSelect());
        expect(onRecoverTeamCredentialResource).toHaveBeenCalledWith(TEAM_RESOURCE);
        expect(list.selectedOptionId).not.toBe(`connected-service:${ENCODED_CODEX_SERVICE_KEY}:native`);
    });

    it('offers the ready autoSwitch pool of a stored member profile as a pool-adoption suggestion', async () => {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');

        const { tree } = await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="codex"
                agentIdentity={CODEX_IDENTITY}
                agentTitle="Codex"
                connectedAccountPurposes={CODEX_ACCOUNT_PURPOSES}
                connectedAccountServiceKeys={[CODEX_SERVICE_KEY]}
                connectedAccountsV4={[v4Account({
                    pluginId: 'happier.agent.codex',
                    localId: 'openai-codex',
                    accountId: 'fresh',
                    kind: 'oauth',
                    displayName: 'Fresh',
                })]}
                connectedAccountGroupsV4={[CODEX_V4_GROUP]}
                accountGroupsEnabled={true}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: {
                        v: 1,
                        bindingsByAgentId: {
                            codex: {
                                v: 1,
                                bindingsByServiceId: {
                                    [CODEX_SERVICE_KEY]: { source: 'connected', selection: 'profile', profileId: 'fresh' },
                                },
                            },
                        },
                    },
                }}
                setDefaultAuthSettings={vi.fn()}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        );

        expect(hasPoolSuggestion(tree, 'codex', CODEX_SERVICE_KEY)).toBe(true);
    });

    it('renders the effective fallback warning for stale group defaults on the trigger', async () => {
        const { ConnectedServicesDefaultAuthRow } = await import('./ConnectedServicesDefaultAuthRow');

        const { tree } = await renderScreen(
            <ConnectedServicesDefaultAuthRow
                agentId="codex"
                agentIdentity={CODEX_IDENTITY}
                agentTitle="Codex"
                connectedAccountPurposes={CODEX_ACCOUNT_PURPOSES}
                connectedAccountServiceKeys={[CODEX_SERVICE_KEY]}
                connectedAccountsV4={[v4Account({
                    pluginId: 'happier.agent.codex',
                    localId: 'openai-codex',
                    accountId: 'work',
                    kind: 'oauth',
                    displayName: 'Work',
                })]}
                connectedAccountGroupsV4={[]}
                accountGroupsEnabled={true}
                settings={{
                    connectedServicesProfileLabelByKey: {},
                    connectedServicesDefaultProfileByServiceId: {},
                    connectedServicesDefaultAuthByAgentIdV1: {
                        v: 1,
                        bindingsByAgentId: {
                            codex: {
                                v: 1,
                                bindingsByServiceId: {
                                    [CODEX_SERVICE_KEY]: {
                                        source: 'connected',
                                        selection: 'group',
                                        groupId: 'missing-group',
                                    },
                                },
                            },
                        },
                    },
                }}
                setDefaultAuthSettings={vi.fn()}
                onOpenConnectedServicesSettings={vi.fn()}
            />,
        );

        const trigger = findDefaultAuthTrigger(tree, 'codex');
        expect(trigger.subtitle).toBe('connectedServices.defaultAuth.warning.connected_group_unavailable');
    });
});
