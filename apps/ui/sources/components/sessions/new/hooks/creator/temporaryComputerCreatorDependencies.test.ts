import { describe, expect, it, vi } from 'vitest';
import {
    TeamCredentialProviderModelSelectionV1Schema,
    TeamCredentialResourceCatalogEntryV1Schema,
    type TeamCredentialResourceCatalogEntryV1,
} from '@happier-dev/protocol/teams';
import type { RunnerActivationClient } from '@/sync/api/ephemeralRunner/runnerActivationClient';

import { createTemporaryComputerCreatorDependencies } from './temporaryComputerCreatorDependencies';

const AGENT_TARGET_KEY = 'agent:happier.agent.codex/codex';

/** `codex` declares a managed CLI install recipe; `antigravity` deliberately does not. */
const MANAGED_INSTALL_AGENT = { pluginId: 'happier.agent.codex', localId: 'codex' } as const;
const VENDOR_GUIDE_ONLY_AGENT = { pluginId: 'happier.agent.antigravity', localId: 'antigravity' } as const;

const BROKER_BINDING = {
    v: 1,
    resourceId: 'resource-1',
    brokerMachineId: 'broker-1',
    revision: 7,
    application: {
        agentTargetKey: AGENT_TARGET_KEY,
        implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
        endpointTemplateId: 'responses',
        protocol: 'openai-responses',
    },
    sourceRevision: 'source-revision-1',
} as const;
const DISPLAY_FACTS = { v: 1, homeId: 'srv-runner', homeName: 'Acme Home', requesterId: 'account-a', requesterName: 'Alice', teamId: 'team-1', teamName: 'Platform' } as const;

function catalogEntry(overrides: Readonly<{
    mayBroker?: boolean;
    availability?: 'available' | 'policy_denied';
    resourceRevision?: number;
    deliveryMode?: 'brokered' | 'direct';
}> = {}): TeamCredentialResourceCatalogEntryV1 {
    return TeamCredentialResourceCatalogEntryV1Schema.parse({
        id: 'resource-1',
        teamId: 'team-1',
        displayName: 'Shared Codex',
        resourceRevision: overrides.resourceRevision ?? 7,
        readiness: { kind: 'available' },
        recoveryAction: null,
        mayBroker: overrides.mayBroker ?? true,
        mayReceiveDirect: false,
        directMaterialState: 'never_delivered',
        sessionUsePolicy: 'personal_allowed',
        providerModels: [{
            selection: {
                kind: 'team_credential_provider_model',
                resourceId: 'resource-1',
                teamId: 'team-1',
                expectedResourceRevision: overrides.resourceRevision ?? 7,
                agentTargetKey: AGENT_TARGET_KEY,
                modelId: 'gpt-5',
                deliveryMode: overrides.deliveryMode ?? 'brokered',
            },
            descriptor: { id: 'gpt-5', name: 'GPT-5' },
            application: {
                agentTargetKey: AGENT_TARGET_KEY,
                implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
                endpointTemplateId: 'responses',
                protocol: 'openai_responses',
            },
            sourceRevision: 'source-revision-1',
            availability: overrides.availability ?? 'available',
        }],
        sourcePresentation: {
            kind: 'provider',
            provider: { identity: { pluginId: 'happier.provider.openai', localId: 'openai' }, definitionRevision: 1 },
        },
    });
}

function selection(revision = 7, deliveryMode: 'brokered' | 'direct' = 'brokered') {
    return TeamCredentialProviderModelSelectionV1Schema.parse({
        kind: 'team_credential_provider_model',
        resourceId: 'resource-1',
        teamId: 'team-1',
        expectedResourceRevision: revision,
        agentTargetKey: AGENT_TARGET_KEY,
        modelId: 'gpt-5',
        deliveryMode,
    });
}

const EXTERNAL_AGENT = { pluginId: 'acme.reviewed-external', localId: 'assistant' } as const;
const EXTERNAL_AGENT_TARGET_KEY = 'agent:acme.reviewed-external/assistant';

/** The exact listing shape `daemon.marketplaceIndex.query` answers with. */
function marketplaceListing(overrides: Readonly<{ sourceKind?: 'curated' | 'community-npm' | 'user' }> = {}) {
    const sourceKind = overrides.sourceKind ?? 'community-npm';
    return {
        pluginId: EXTERNAL_AGENT.pluginId,
        publisher: { id: 'acme', displayName: 'Acme' },
        display: { title: 'Reviewed External', description: null },
        distribution: {
            kind: 'npm',
            registryOrigin: 'https://registry.npmjs.org',
            packageName: '@acme/reviewed-external',
            version: '1.2.3',
            integrity: `sha512-${'A'.repeat(86)}==`,
        },
        manifestDigest: `sha256:${'b'.repeat(64)}`,
        compatibility: { platforms: ['linux', 'darwin'] },
        summary: { contributions: ['agent'], requiredHostAccess: [], optionalHostAccess: [], executableRealms: ['daemon'] },
        review: { status: sourceKind === 'curated' ? 'approved' : 'unreviewed', reviewedAt: sourceKind === 'curated' ? '2026-01-02T03:04:05.000Z' : null },
        updatePolicy: 'pinned',
        source: {
            id: sourceKind === 'community-npm' ? 'marketplace:community-npm' : 'acme-catalog',
            title: 'Acme',
            kind: sourceKind,
            sourceUrl: 'https://registry.npmjs.org/',
        },
        artifactAccess: { state: 'available', registryProfileId: null },
    };
}

function compose(params: Readonly<{
    serverId?: string | null;
    resources?: readonly TeamCredentialResourceCatalogEntryV1[];
    currentKeys?: ReadonlySet<string>;
    selected?: ReturnType<typeof selection> | null;
    agentCatalogMachineId?: string | null;
    projectedAgentsById?: Readonly<Record<string, unknown>>;
    installedPluginPackagesById?: Readonly<Record<string, unknown>>;
    queryMarketplaceIndex?: (input: Readonly<{ machineId: string; pluginId: string; signal?: AbortSignal }>) => Promise<unknown>;
}> = {}) {
    return createTemporaryComputerCreatorDependencies({
        teamCredentialServerId: params.serverId === undefined ? 'srv-runner' : params.serverId,
        teamCredentialResources: params.resources ?? [catalogEntry()],
        currentTeamCredentialResourceKeys: params.currentKeys ?? new Set(['team-1:resource-1']),
        selectedTeamCredentialModel: params.selected ?? null,
        agentCatalogMachineId: params.agentCatalogMachineId === undefined ? 'machine-1' : params.agentCatalogMachineId,
        projectedAgentsById: (params.projectedAgentsById ?? {}) as never,
        installedPluginPackagesById: (params.installedPluginPackagesById ?? {}) as never,
        ...(params.queryMarketplaceIndex ? { queryMarketplaceIndex: params.queryMarketplaceIndex as never } : {}),
    });
}

/**
 * The broker resolution route is a genuine Home boundary. Everything beneath it —
 * catalog matching, currentness and the produced binding — stays real.
 */
function resolutionClient(response: unknown) {
    const resolveCredentialSelection = vi.fn(async () => response);
    return {
        client: { resolveCredentialSelection } as unknown as RunnerActivationClient,
        resolveCredentialSelection,
    };
}

const preparedAuthoring = {
    authoring: {
        primaryTeamId: 'team-1',
        access: { grants: [{ subject: { kind: 'team', teamId: 'team-1' }, accessLevel: 'edit', canApprovePermissions: false }] },
    },
    // Only the fields this producer reads are populated; the full reviewed
    // manifest is built by its own protocol owner.
} as unknown as Parameters<
    ReturnType<typeof compose>['dependencies']['resolveCredentialSelectionBinding']
>[0]['preparedAuthoring'];

const projection = { activationId: 'activation-1' } as unknown as Parameters<
    ReturnType<typeof compose>['dependencies']['resolveCredentialSelectionBinding']
>[0]['projection'];

describe('createTemporaryComputerCreatorDependencies', () => {
    it('admits an Agent only when it can be installed unattended and a current brokerable model exists', () => {
        const composed = compose();

        expect(composed.dependencies.isAuthoringCompatible({
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        })).toBe(true);
        expect(composed.readGaps()).toEqual([]);
    });

    it('separates destination eligibility from exact selected-model launch readiness', () => {
        const withoutSelection = compose({ selected: null });
        const staleSelection = compose({ resources: [catalogEntry({ resourceRevision: 8 })], selected: selection(7) });
        const exactSelection = compose({ selected: selection() });
        const authoring = {
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        } as const;

        expect(withoutSelection.dependencies.isAuthoringCompatible(authoring)).toBe(true);
        expect(withoutSelection.dependencies.isLaunchReady(authoring)).toBe(false);
        expect(withoutSelection.readGaps()).toContain('team_credential_model_unselected');

        expect(staleSelection.dependencies.isAuthoringCompatible(authoring)).toBe(true);
        expect(staleSelection.dependencies.isLaunchReady(authoring)).toBe(false);
        expect(staleSelection.readGaps()).toContain('team_credential_resource_unavailable');

        expect(exactSelection.dependencies.isLaunchReady(authoring)).toBe(true);
    });

    it('withdraws launch readiness when the selected model belongs to another Agent', () => {
        const selected = TeamCredentialProviderModelSelectionV1Schema.parse({
            ...selection(),
            agentTargetKey: 'agent:happier.agent.opencode/opencode',
        });
        const composed = compose({ selected });

        expect(composed.dependencies.isLaunchReady({
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        })).toBe(false);
        expect(composed.readGaps()).toContain('team_credential_resource_unavailable');
    });

    it('does not reinterpret a direct Provider selection as brokered Runner authority', async () => {
        const directSelection = selection(7, 'direct');
        const composed = compose({
            resources: [catalogEntry({ deliveryMode: 'direct' })],
            selected: directSelection,
        });
        const authoring = {
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        } as const;
        const { client, resolveCredentialSelection } = resolutionClient({
            status: 'resolved',
            credentialSelectionBinding: BROKER_BINDING,
            displayFacts: DISPLAY_FACTS,
        });

        expect(composed.dependencies.isAuthoringCompatible(authoring)).toBe(false);
        expect(composed.dependencies.isLaunchReady(authoring)).toBe(false);
        await expect(composed.dependencies.resolveCredentialSelectionBinding({
            projection,
            preparedAuthoring,
            client,
            signal: new AbortController().signal,
        })).resolves.toBeNull();
        expect(resolveCredentialSelection).not.toHaveBeenCalled();
        expect(composed.readGaps()).toContain('team_credential_resource_unavailable');
    });

    it('withdraws launch readiness when the selected model is no longer in the current resource', () => {
        const selected = TeamCredentialProviderModelSelectionV1Schema.parse({
            ...selection(),
            modelId: 'removed-model',
        });
        const composed = compose({ selected });

        expect(composed.dependencies.isLaunchReady({
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        })).toBe(false);
        expect(composed.readGaps()).toContain('team_credential_resource_unavailable');
    });

    it('produces no decision at all without the exact Home the catalog belongs to', async () => {
        // The entitled catalog, its currentness and the selected model are all
        // Home-scoped facts. Answering without the Home they were read for would
        // let one Home's resource/revision be frozen into another Home's
        // activation, which the endpoint could never broker.
        const composed = compose({ serverId: null, selected: selection() });
        const authoring = {
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        } as const;
        const { client, resolveCredentialSelection } = resolutionClient({
            status: 'resolved',
            credentialSelectionBinding: BROKER_BINDING,
            displayFacts: DISPLAY_FACTS,
        });

        expect(composed.dependencies.isAuthoringCompatible(authoring)).toBe(false);
        expect(composed.dependencies.isLaunchReady(authoring)).toBe(false);
        await expect(composed.dependencies.resolveCredentialSelectionBinding({
            projection,
            preparedAuthoring,
            client,
            signal: new AbortController().signal,
        })).resolves.toBeNull();
        expect(resolveCredentialSelection).not.toHaveBeenCalled();
        expect(composed.readGaps()).toContain('broker_selection_unavailable');
    });

    it('fails closed for an Agent with no managed install recipe', () => {
        const composed = compose();

        expect(composed.dependencies.isAuthoringCompatible({
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: VENDOR_GUIDE_ONLY_AGENT },
        })).toBe(false);
        expect(composed.readGaps()).toContain('agent_managed_install_undeclared');
    });

    it('fails closed when the only brokerable resource row is stale', () => {
        const composed = compose({ currentKeys: new Set() });

        expect(composed.dependencies.isAuthoringCompatible({
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        })).toBe(false);
        expect(composed.readGaps()).toContain('team_credential_resource_unavailable');
    });

    it('fails closed when the resource cannot broker for this Account', () => {
        const composed = compose({ resources: [catalogEntry({ mayBroker: false })] });

        expect(composed.dependencies.isAuthoringCompatible({
            backendTargetKey: AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
        })).toBe(false);
        expect(composed.readGaps()).toContain('team_credential_resource_unavailable');
    });

    it('resolves the credential selection binding through the Home rather than inventing a broker', async () => {
        const composed = compose({ selected: selection() });
        const { client, resolveCredentialSelection } = resolutionClient({
            status: 'resolved',
            credentialSelectionBinding: BROKER_BINDING,
            displayFacts: DISPLAY_FACTS,
        });

        await expect(composed.dependencies.resolveCredentialSelectionBinding({
            projection,
            preparedAuthoring,
            client,
            signal: new AbortController().signal,
        })).resolves.toEqual({
            binding: BROKER_BINDING,
            reviewedProviderModel: catalogEntry().providerModels[0],
            displayFacts: DISPLAY_FACTS,
        });
        expect(resolveCredentialSelection).toHaveBeenCalledTimes(1);
        expect(composed.readGaps()).not.toContain('broker_selection_unavailable');
    });

    it('reports an unresolvable broker instead of falling back to a guessed binding', async () => {
        const composed = compose({ selected: selection() });
        const { client } = resolutionClient({ status: 'unavailable', reason: 'broker_unavailable' });

        await expect(composed.dependencies.resolveCredentialSelectionBinding({
            projection,
            preparedAuthoring,
            client,
            signal: new AbortController().signal,
        })).resolves.toBeNull();
        expect(composed.readGaps()).toContain('broker_selection_unavailable');
    });

    it('reports an unselected credential model without contacting the Home', async () => {
        const composed = compose({ selected: null });
        const { client, resolveCredentialSelection } = resolutionClient({
            status: 'resolved',
            credentialSelectionBinding: BROKER_BINDING,
            displayFacts: DISPLAY_FACTS,
        });

        await expect(composed.dependencies.resolveCredentialSelectionBinding({
            projection,
            preparedAuthoring,
            client,
            signal: new AbortController().signal,
        })).resolves.toBeNull();
        expect(resolveCredentialSelection).not.toHaveBeenCalled();
        expect(composed.readGaps()).toContain('team_credential_model_unselected');
    });

    it('refuses a selection whose revision no longer matches the catalog', async () => {
        const composed = compose({ resources: [catalogEntry({ resourceRevision: 8 })], selected: selection(7) });
        const { client, resolveCredentialSelection } = resolutionClient({
            status: 'resolved',
            credentialSelectionBinding: BROKER_BINDING,
            displayFacts: DISPLAY_FACTS,
        });

        await expect(composed.dependencies.resolveCredentialSelectionBinding({
            projection,
            preparedAuthoring,
            client,
            signal: new AbortController().signal,
        })).resolves.toBeNull();
        expect(resolveCredentialSelection).not.toHaveBeenCalled();
        expect(composed.readGaps()).toContain('team_credential_resource_unavailable');
    });

    it('derives a retry-stable tag and reviewed initial access without starting runtime work', async () => {
        const composed = compose({ selected: selection() });
        const custody = {
            binding: { activationId: 'activation-1' },
            launchManifest: {
                credentialSelectionBinding: BROKER_BINDING,
                reviewedProviderModel: catalogEntry().providerModels[0],
            },
            preparedAuthoring: {
                authoring: {
                    access: {
                        grants: [{
                            subject: { kind: 'team', teamId: 'team-1' },
                            accessLevel: 'edit',
                            canApprovePermissions: false,
                        }],
                    },
                },
            },
        } as unknown as Parameters<
            ReturnType<typeof compose>['dependencies']['resolveMaterializationInput']
        >[0]['custody'];

        const first = await composed.dependencies.resolveMaterializationInput({ projection, custody });
        const second = await composed.dependencies.resolveMaterializationInput({ projection, custody });

        expect(first?.tag).toBe('temporary-computer:activation-1');
        expect(second?.tag).toBe(first?.tag);
        expect(first?.agentState).toBeNull();
        expect(first?.initialAccess).toEqual({
            grants: [{
                subject: { kind: 'team', teamId: 'team-1' },
                accessLevel: 'edit',
                canApprovePermissions: false,
            }],
        });
        expect(first?.teamCredentialBindings).toEqual([{
            v: 1,
            slot: { kind: 'provider_model' },
            resourceId: 'resource-1',
            expectedResourceRevision: 7,
            deliveryMode: 'brokered',
            teamId: 'team-1',
        }]);
    });

    it('omits initial access entirely when authoring granted nobody', async () => {
        const composed = compose();
        const custody = {
            binding: { activationId: 'activation-2' },
            launchManifest: {
                credentialSelectionBinding: BROKER_BINDING,
                reviewedProviderModel: catalogEntry().providerModels[0],
            },
            preparedAuthoring: { authoring: { access: null } },
        } as unknown as Parameters<
            ReturnType<typeof compose>['dependencies']['resolveMaterializationInput']
        >[0]['custody'];

        const input = await composed.dependencies.resolveMaterializationInput({ projection, custody });

        expect(input).not.toHaveProperty('initialAccess');
        expect(input?.teamCredentialBindings).toEqual([{
            v: 1,
            slot: { kind: 'provider_model' },
            resourceId: 'resource-1',
            expectedResourceRevision: 7,
            deliveryMode: 'brokered',
            teamId: 'team-1',
        }]);
        expect(input?.tag).toBe('temporary-computer:activation-2');
    });

    it('fails materialization closed when sealed review custody contains a direct route', async () => {
        const composed = compose();
        const custody = {
            binding: { activationId: 'activation-3' },
            launchManifest: {
                credentialSelectionBinding: BROKER_BINDING,
                reviewedProviderModel: catalogEntry({ deliveryMode: 'direct' }).providerModels[0],
            },
            preparedAuthoring: { authoring: { access: null } },
        } as unknown as Parameters<
            ReturnType<typeof compose>['dependencies']['resolveMaterializationInput']
        >[0]['custody'];

        await expect(composed.dependencies.resolveMaterializationInput({ projection, custody }))
            .resolves.toBeNull();
    });
});

describe('createTemporaryComputerCreatorDependencies external Agent acquisition', () => {
    const projectedExternalAgent = {
        id: 'assistant',
        identity: EXTERNAL_AGENT,
        providerOwnedEnvironmentKeys: [],
        cli: { install: { managed: { kind: 'managed_package' } } },
    };
    const externalCatalogEntry = () => TeamCredentialResourceCatalogEntryV1Schema.parse({
        ...catalogEntry(),
        providerModels: [{
            ...catalogEntry().providerModels[0],
            selection: { ...catalogEntry().providerModels[0]!.selection, agentTargetKey: EXTERNAL_AGENT_TARGET_KEY },
            application: { ...catalogEntry().providerModels[0]!.application, agentTargetKey: EXTERNAL_AGENT_TARGET_KEY },
        }],
    });

    it('admits an externally installed Agent that declares a managed CLI install and came from npm', () => {
        const composed = compose({
            resources: [externalCatalogEntry()],
            projectedAgentsById: { assistant: projectedExternalAgent },
            installedPluginPackagesById: {
                'acme.reviewed-external': {
                    id: 'acme.reviewed-external',
                    displayName: 'Reviewed External',
                    version: '1.2.3',
                    enabled: true,
                    source: { kind: 'package', locator: '@acme/reviewed-external' },
                },
            },
        });

        expect(composed.dependencies.isAuthoringCompatible({
            backendTargetKey: EXTERNAL_AGENT_TARGET_KEY,
            agentTarget: { kind: 'agent', identity: EXTERNAL_AGENT },
        })).toBe(true);
        expect(composed.readGaps()).toEqual([]);
    });

    it.each(['path', 'archive'] as const)(
        'refuses an externally installed Agent installed from a %s, which has no marketplace listing',
        (sourceKind) => {
            const composed = compose({
                resources: [externalCatalogEntry()],
                projectedAgentsById: { assistant: projectedExternalAgent },
                installedPluginPackagesById: {
                    'acme.reviewed-external': {
                        id: 'acme.reviewed-external',
                        displayName: 'Reviewed External',
                        version: '1.2.3',
                        enabled: true,
                        source: { kind: sourceKind, locator: '/home/alice/plugins/reviewed-external' },
                    },
                },
            });

            expect(composed.dependencies.isAuthoringCompatible({
                backendTargetKey: EXTERNAL_AGENT_TARGET_KEY,
                agentTarget: { kind: 'agent', identity: EXTERNAL_AGENT },
            })).toBe(false);
            expect(composed.readGaps()).toContain('agent_plugin_distribution_unacquirable');
        },
    );

    it('resolves the exact commitment from the focused machine marketplace index', async () => {
        const queryMarketplaceIndex = vi.fn(async () => ({ items: [marketplaceListing()], nextCursor: null, revision: 1 }));
        const composed = compose({
            resources: [externalCatalogEntry()],
            projectedAgentsById: { assistant: projectedExternalAgent },
            installedPluginPackagesById: {
                'acme.reviewed-external': {
                    id: 'acme.reviewed-external',
                    displayName: 'Reviewed External',
                    version: '1.2.3',
                    enabled: true,
                    source: { kind: 'package', locator: '@acme/reviewed-external' },
                },
            },
            queryMarketplaceIndex,
        });

        const resolved = await composed.dependencies.resolveAgentPluginDistribution({
            agentTarget: { kind: 'agent', identity: EXTERNAL_AGENT },
            signal: new AbortController().signal,
        });

        expect(queryMarketplaceIndex).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            pluginId: 'acme.reviewed-external',
        }));
        expect(resolved).toMatchObject({
            pluginId: 'acme.reviewed-external',
            packageName: '@acme/reviewed-external',
            version: '1.2.3',
            source: { kind: 'community-npm' },
        });
        expect(resolved).not.toHaveProperty('registryProfileId');
    });

    it('fails closed when the focused machine index carries no listing for the installed Agent', async () => {
        const queryMarketplaceIndex = vi.fn(async () => ({ items: [], nextCursor: null, revision: 1 }));
        const composed = compose({
            resources: [externalCatalogEntry()],
            projectedAgentsById: { assistant: projectedExternalAgent },
            installedPluginPackagesById: {
                'acme.reviewed-external': {
                    id: 'acme.reviewed-external',
                    displayName: 'Reviewed External',
                    version: '1.2.3',
                    enabled: true,
                    source: { kind: 'package', locator: '@acme/reviewed-external' },
                },
            },
            queryMarketplaceIndex,
        });

        await expect(composed.dependencies.resolveAgentPluginDistribution({
            agentTarget: { kind: 'agent', identity: EXTERNAL_AGENT },
            signal: new AbortController().signal,
        })).resolves.toBeNull();
        expect(composed.readGaps()).toContain('agent_plugin_distribution_unacquirable');
    });

    it('acquires nothing for a bundled Agent the Runner artifact already carries', async () => {
        const queryMarketplaceIndex = vi.fn();
        const composed = compose({ queryMarketplaceIndex: queryMarketplaceIndex as never });

        await expect(composed.dependencies.resolveAgentPluginDistribution({
            agentTarget: { kind: 'agent', identity: MANAGED_INSTALL_AGENT },
            signal: new AbortController().signal,
        })).resolves.toBeNull();
        expect(queryMarketplaceIndex).not.toHaveBeenCalled();
        expect(composed.readGaps()).toEqual([]);
    });
});
