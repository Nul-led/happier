import * as React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    MarketplaceIndexQueryResultV1,
    MarketplaceSourceRegistryV1,
    PluginDiagnosticRecordV1,
} from '@happier-dev/protocol';
import type { PluginInstallationReview } from '@happier-dev/protocol/marketplace/internal';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
    clearDaemonMergedProjectionCacheForTests,
    loadDaemonMergedProjectionCacheEntry,
} from '@/agents/backendCatalog/loadDaemonMergedProjectionInputs';
import { readNewSessionDraftFromRepository } from '@/components/sessions/composer/newSessionDraftRepositoryAdapter';
import { flattenTestStyle } from '@/dev/testkit';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';
import { renderSettingsView } from '@/dev/testkit/harness/settingsViewHarness';
import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { resetSessionDraftRepositoryForTests } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

type InstalledPluginDiagnostic = Readonly<{
    code: string;
    message: string;
}>;

type InstalledPluginEntry = Readonly<{
    pluginId: string;
    desiredGeneration?: string | null;
    appliedGeneration?: string | null;
    admittedIntegrity?: string | null;
    title: string;
    description: string | null;
    version: string;
    enabled: boolean;
    rollbackAvailability?: 'available' | 'unavailable';
    source: Readonly<{
        kind: string;
        locator: string;
        devWatch?: boolean;
        trustPolicy?: string;
        installPolicy?: string;
        resolvedPath?: string;
    }>;
    install: Readonly<{
        mode: string;
        manifestVersion: string;
        installedPath?: string | null;
    }>;
    compatibility: Readonly<{
        status: string;
        diagnostics: readonly InstalledPluginDiagnostic[];
    }>;
    diagnostics: readonly InstalledPluginDiagnostic[];
}>;

type MachineCapabilitiesResponse = Readonly<{
    protocolVersion: 1;
    results: Readonly<Record<string, Readonly<{
        ok: true;
        checkedAt: number;
        data?: {
            installedPlugins?: readonly InstalledPluginEntry[];
            developmentActions?: Readonly<{ create: boolean; develop?: boolean }>;
            developmentSources?: readonly Readonly<{
                pluginId: string;
                sourceRootPath: string;
                watch: Readonly<{ state: 'configured' }>;
                reload: Readonly<{
                    state: 'clear' | 'attention';
                    diagnostics: readonly InstalledPluginDiagnostic[];
                }>;
                actions: Readonly<{ test: boolean; pack: boolean }>;
            }>[];
            pendingChanges?: readonly unknown[];
        } | null;
    }>>>;
}>;

type MachineCapabilitiesSnapshot = Readonly<{
    response: MachineCapabilitiesResponse;
}>;

type MachineCapabilitiesState =
    | Readonly<{
        status: 'idle';
    }>
    | Readonly<{
        status: 'not-supported';
    }>
    | Readonly<{
        status: 'loaded';
        snapshot: MachineCapabilitiesSnapshot;
    }>
    | Readonly<{
        status: 'loading';
        snapshot?: MachineCapabilitiesSnapshot;
    }>
    | Readonly<{
        status: 'error';
        snapshot?: MachineCapabilitiesSnapshot;
    }>;
type LoadedMachineCapabilitiesState = Extract<MachineCapabilitiesState, Readonly<{ status: 'loaded' }>>;

const getActiveServerIdMock = vi.hoisted(() => vi.fn());
const useMachineCapabilitiesCacheMock = vi.hoisted(() => vi.fn());
const getMachineCapabilitiesCacheStateMock = vi.hoisted(() => vi.fn());
const useMachineCliDetectionTargetMock = vi.hoisted(() => vi.fn());
const endpointConnectivityState = vi.hoisted(() => ({
    status: 'online' as 'online' | 'offline',
}));
const invokeWithAlertsMock = vi.hoisted(() => vi.fn());
const refreshMachineCapabilitiesMock = vi.hoisted(() => vi.fn());
const machineMarketplaceSourceRegistryGetMock = vi.hoisted(() => vi.fn());
const machineMarketplaceSourceRegistryMutateMock = vi.hoisted(() => vi.fn());
const machineMarketplaceIndexQueryMock = vi.hoisted(() => vi.fn());
const machineNpmRegistryProfilesGetMock = vi.hoisted(() => vi.fn());
const machineNpmRegistryProfilesMutateMock = vi.hoisted(() => vi.fn());
const machineContributionRegistryProjectionDescribeMock = vi.hoisted(() => vi.fn());
const machinePluginStructuredMessageActionExecuteMock = vi.hoisted(() => vi.fn());
const publishMachineContributionRegistryProjectionInvalidationMock = vi.hoisted(() => vi.fn());
const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());
const routerPushSpy = vi.hoisted(() => vi.fn());
const navigationSetOptionsSpy = vi.hoisted(() => vi.fn());
const modalAlertMock = vi.hoisted(() => vi.fn());
const modalShowMock = vi.hoisted(() => vi.fn());
const modalPromptMock = vi.hoisted(() => vi.fn());
const modalConfirmMock = vi.hoisted(() => vi.fn());
const activeAccountLifetime = vi.hoisted(() => Object.freeze({
    scope: Object.freeze({ serverId: 'server-a', accountId: 'account-a' }),
    isCurrent: () => true,
    onRetire: () => Object.freeze({ dispose(): void {} }),
}) satisfies ActiveServerAccountScopeLifetime);
const activeAccountScopeState = vi.hoisted(() => ({
    current: null as Readonly<{ serverId: string; accountId: string }> | null,
}));
const machineAdministrationFixture = vi.hoisted(() => ({
    activeMachines: [] as Array<Record<string, unknown>>,
    activeServerId: 'server-a',
    machineListByServerId: {} as Record<string, Array<Record<string, unknown>>>,
    machineListStatusByServerId: {} as Record<string, 'idle' | 'loading' | 'signedOut' | 'error'>,
    profiles: [] as Array<Record<string, unknown>>,
    selections: {
        version: 1,
        targetsByKey: {},
        pluginExecutionOriginsByPluginId: {},
    } as Record<string, unknown>,
    /** Hydrated Account settings version, as the real store reports once loaded. */
    settingsVersion: 1 as number | null,
    setSelections: vi.fn(),
    storageState: {} as Record<string, unknown>,
}));
// A choice alert resolves after the pressed button's handler runs. The default
// picks the first button so the create flow exercises its real UI-mode branch.
const modalAlertAsyncMock = vi.hoisted(() => vi.fn(async (
    _title: string,
    _message?: string,
    buttons?: readonly { text: string; onPress?: () => void }[],
) => {
    buttons?.[0]?.onPress?.();
}));
const prefetchMachineCapabilitiesMock = vi.hoisted(() => vi.fn());
const screenFocusState = vi.hoisted(() => ({ value: true }));

const MARKETPLACE_CAPABILITY_ID = 'tool.plugins';

vi.mock('@react-navigation/native', async () => ({
    ...(await import('@/dev/testkit/mocks/reactNavigation')).createReactNavigationNativeMock(),
    useIsFocused: () => screenFocusState.value,
}));

function setMachineAdministrationTargetFixture(params: Readonly<{
    serverIdentityId?: string;
    serverId?: string;
    machineId?: string;
    daemonStateVersion?: number;
}> = {}): void {
    const activeAt = Date.now();
    const target = {
        serverIdentityId: params.serverIdentityId ?? 'srv_identity-a',
        machineId: params.machineId ?? 'machine-1',
    };
    const serverId = params.serverId ?? 'server-a';
    const daemonStateVersion = params.daemonStateVersion ?? 1;
    const activeMachine = {
        id: 'machine-1',
        active: true,
        activeAt,
        updatedAt: 1,
        daemonStateVersion: 1,
        metadata: { displayName: 'Active machine', host: 'active-host' },
    };
    const selectedMachine = {
        id: target.machineId,
        active: true,
        activeAt,
        updatedAt: 1,
        daemonStateVersion,
        metadata: { displayName: target.machineId, host: `${target.machineId}-host` },
    };
    machineAdministrationFixture.activeServerId = 'server-a';
    const activeProfile = {
        id: 'server-a',
        name: 'Server A',
        serverUrl: 'https://server-a.example.test',
        serverIdentityId: 'srv_identity-a',
        legacyServerIds: [],
    };
    machineAdministrationFixture.profiles = serverId === activeProfile.id
        && target.serverIdentityId === activeProfile.serverIdentityId
        ? [activeProfile]
        : [
            activeProfile,
            {
                id: serverId,
                name: 'Server B',
                serverUrl: 'https://server-b.example.test',
                serverIdentityId: target.serverIdentityId,
                legacyServerIds: [],
            },
        ];
    machineAdministrationFixture.activeMachines = [
        serverId === 'server-a' ? selectedMachine : activeMachine,
    ];
    machineAdministrationFixture.machineListByServerId = {
        'server-a': [activeMachine],
        [serverId]: [selectedMachine],
    };
    machineAdministrationFixture.machineListStatusByServerId = {
        'server-a': 'idle',
        [serverId]: 'idle',
    };
    machineAdministrationFixture.selections = {
        version: 1,
        targetsByKey: { 'plugins.home': target },
        pluginExecutionOriginsByPluginId: {},
    };
    machineAdministrationFixture.storageState = {
        isDataReady: true,
        machines: Object.fromEntries(machineAdministrationFixture.activeMachines.map((machine) => [machine.id, machine])),
        machineListByServerId: machineAdministrationFixture.machineListByServerId,
        machineListStatusByServerId: machineAdministrationFixture.machineListStatusByServerId,
        settings: {
            machineAdministrationSelectionsV1: machineAdministrationFixture.selections,
        },
    };
    machineAdministrationFixture.setSelections.mockReset();
    machineAdministrationFixture.setSelections.mockImplementation((next: Record<string, unknown>) => {
        machineAdministrationFixture.selections = next;
        machineAdministrationFixture.storageState = {
            ...machineAdministrationFixture.storageState,
            settings: { machineAdministrationSelectionsV1: next },
        };
    });
}

function clearMachineAdministrationTargetFixture(): void {
    machineAdministrationFixture.selections = {
        version: 1,
        targetsByKey: {},
        pluginExecutionOriginsByPluginId: {},
    };
    machineAdministrationFixture.storageState = {
        ...machineAdministrationFixture.storageState,
        settings: {
            machineAdministrationSelectionsV1: machineAdministrationFixture.selections,
        },
    };
}

function createInstalledPlugin(overrides: Partial<InstalledPluginEntry> & Pick<InstalledPluginEntry, 'pluginId' | 'title' | 'version'>): InstalledPluginEntry {
    return {
        description: 'Installed plugin',
        enabled: true,
        source: {
            kind: 'catalog',
            locator: 'https://marketplace.example.test/catalog.json',
            trustPolicy: 'trusted',
            installPolicy: 'allow',
            resolvedPath: '/plugins/sample',
        },
        install: {
            mode: 'catalog',
            manifestVersion: '1',
            installedPath: '/plugins/sample',
        },
        compatibility: {
            status: 'compatible',
            diagnostics: [],
        },
        diagnostics: [],
        rollbackAvailability: 'unavailable',
        ...overrides,
    };
}

function createPluginDiagnosticRecord(params: Readonly<{
    id: string;
    pluginId: string;
    code: string;
    message: string;
    severity: PluginDiagnosticRecordV1['data']['severity'];
}>): PluginDiagnosticRecordV1 {
    return {
        version: 1,
        id: params.id,
        data: {
            code: params.code,
            message: params.message,
            severity: params.severity,
        },
        plugin: {
            id: params.pluginId,
            version: '1.0.0',
            source: 'localPath',
        },
        stage: 'normalization',
        generation: '12',
        host: 'daemon',
        platform: 'test',
        occurredAtMs: 1,
        resolution: { state: 'current' },
    };
}

function createMachineCapabilitiesState(
    installedPlugins: readonly InstalledPluginEntry[],
    developmentSources: NonNullable<NonNullable<MachineCapabilitiesResponse['results'][string]>['data']>['developmentSources'] = [],
    pendingChanges: readonly unknown[] = [],
): LoadedMachineCapabilitiesState {
    return {
        status: 'loaded',
        snapshot: {
            response: {
                protocolVersion: 1,
                results: {
                    [MARKETPLACE_CAPABILITY_ID]: {
                        ok: true,
                        checkedAt: Date.now(),
                        data: {
                            installedPlugins,
                            developmentActions: { create: true, develop: true },
                            developmentSources,
                            pendingChanges,
                        },
                    },
                },
            },
        },
    };
}

function createMachineCapabilitiesErrorState(installedPlugins: readonly InstalledPluginEntry[]): MachineCapabilitiesState {
    return {
        ...createMachineCapabilitiesState(installedPlugins),
        status: 'error',
    };
}

function createMachineCapabilitiesLoadingState(installedPlugins: readonly InstalledPluginEntry[]): MachineCapabilitiesState {
    return {
        ...createMachineCapabilitiesState(installedPlugins),
        status: 'loading',
    };
}

function createMarketplaceCatalogEntry(params: Readonly<{
    pluginId: string;
    title?: string;
    description?: string;
    version?: string;
    entryId?: string;
    sourceUrl?: string;
    packageUrl?: string;
    categories?: readonly string[];
}>): Readonly<{
    id: string;
    manifestId: string;
    title: string;
    description: string;
    version: string;
    sourceUrl: string;
    packageUrl: string;
    categories: readonly string[];
}> {
    return {
        id: params.entryId ?? `marketplace.${params.pluginId}`,
        manifestId: params.pluginId,
        title: params.title ?? params.pluginId,
        description: params.description ?? 'Catalog descriptor',
        version: params.version ?? '1.0.0',
        sourceUrl: params.sourceUrl ?? `https://marketplace.example.test/entries/${params.pluginId}.json`,
        packageUrl: params.packageUrl ?? `https://marketplace.example.test/plugins/${params.pluginId}.tgz`,
        categories: params.categories ?? [],
    };
}

function createDaemonMarketplaceIndexResult(
    entries: readonly ReturnType<typeof createMarketplaceCatalogEntry>[],
    options: Readonly<{
        sourceId?: string;
        sourceTitle?: string;
        sourceUrl?: string;
        sourceKind?: 'curated' | 'user' | 'community-npm';
        freshnessState?: 'fresh' | 'stale' | 'stale-offline';
        reviewStatus?: 'approved' | 'withdrawn' | 'blocked' | 'unreviewed';
        artifactAccessState?: 'public' | 'unverified-profile';
        sourceDiagnostics?: readonly Readonly<{ code: string; message: string }>[];
        indexDiagnostics?: readonly Readonly<{ code: string; message: string }>[];
        revision?: number;
        nextCursor?: string | null;
    }> = {},
): MarketplaceIndexQueryResultV1 {
    const sourceId = options.sourceId ?? 'marketplace:curated';
    const sourceTitle = options.sourceTitle ?? 'Curated Marketplace';
    const sourceUrl = options.sourceUrl ?? 'https://marketplace.example.test/catalog.json';
    return {
        revision: options.revision ?? 1,
        items: entries.map((entry) => ({
            pluginId: entry.manifestId,
            publisher: { id: 'acme', displayName: 'Acme' },
            display: { title: entry.title, description: entry.description },
            distribution: {
                kind: 'npm',
                registryOrigin: 'https://registry.npmjs.org',
                packageName: `@acme/${entry.manifestId}`,
                version: entry.version,
                integrity: 'sha512-AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==',
            },
            manifestDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            compatibility: { happier: '>=1', platforms: ['web'] },
            summary: { contributions: ['agents'], requiredHostAccess: [], optionalHostAccess: [], executableRealms: ['daemon'] },
            review: {
                status: options.reviewStatus ?? 'approved',
                reviewedAt: (options.reviewStatus ?? 'approved') === 'approved' ? '2026-07-22T00:00:00.000Z' : null,
            },
            categories: ['agents'],
            media: [],
            updatePolicy: 'reviewEveryUpdate',
            links: {},
            source: {
                id: sourceId,
                title: sourceTitle,
                kind: options.sourceKind ?? 'curated',
                sourceUrl,
            },
            freshness: { state: options.freshnessState ?? 'fresh', fetchedAtMs: 1 },
            // The one canonical admission shape (MarketplaceIndexAdmissionV1Schema):
            // every install is full-review — curation is discovery only — and a
            // withdrawal warns without disabling installed code.
            admission: {
                install: 'full-review',
                mutatesInstalledTrust: false,
                disablesInstalledCode: false,
                directNpmRequiresFullReview: true,
            },
            artifactAccess: {
                state: options.artifactAccessState ?? 'public',
                registryProfileId: null,
            },
        })),
        nextCursor: options.nextCursor ?? null,
        sources: [{
            source: { id: sourceId, title: sourceTitle, kind: options.sourceKind ?? 'curated', sourceUrl },
            freshness: { state: options.freshnessState ?? 'fresh', fetchedAtMs: 1 },
            diagnostics: [...(options.sourceDiagnostics ?? [])],
        }],
        diagnostics: [...(options.indexDiagnostics ?? [])],
    };
}

function createCommunityInstallReviewResult(pendingChangeId: string, action: 'install' | 'update' = 'install') {
    return {
        action,
        pluginId: 'community-plugin',
        change: {
            kind: 'reviewRequired',
            pendingChangeId,
            review: {
                pluginId: 'community-plugin',
                displayName: 'Community Plugin',
                version: '2.0.0',
                packageIdentity: { name: '@acme/community-plugin', version: '2.0.0' },
                publisherIdentity: { status: 'unverified', id: 'acme', displayName: 'Acme' },
                source: {
                    kind: 'npm',
                    locator: '@acme/community-plugin@2.0.0',
                    integrity: 'sha512-exact',
                    integrityBasis: 'expected',
                },
                updateChannel: {
                    kind: 'npm',
                    packageName: '@acme/community-plugin',
                    registryOrigin: 'https://registry.npmjs.org',
                    marketplaceSource: {
                        id: 'marketplace:community-npm',
                        kind: 'community-npm',
                        sourceUrl: 'https://registry.npmjs.org/-/v1/search?text=keywords:happier-plugin&size=100',
                    },
                },
                signature: { status: 'notProvided' },
                provenance: { status: 'notProvided' },
                curation: { status: 'unreviewed', sourceId: 'marketplace:community-npm' },
                executableRealms: ['daemon'],
                contributions: [{ family: 'actions', count: 1 }],
                uiArtifacts: { status: 'none', contributionIds: [] },
                requiredHostAccess: [{
                    id: 'network',
                    capability: 'network',
                    reason: 'Connect to the review service',
                    authorizationClass: 'cooperativeDisclosure',
                    normalizedScope: { targets: [{ kind: 'fixedOrigin', origin: 'https://review.example.test' }] },
                }],
                optionalHostAccess: [{
                    id: 'sessions',
                    capability: 'sessions',
                    reason: 'Read selected sessions',
                    authorizationClass: 'hostResourceSelection',
                    normalizedScope: { access: ['read'] },
                }],
                rawCredentialAccess: [],
                requestInterceptors: [],
                compatibility: { happier: '^0.2.0', runtimeApiVersion: 1 },
                updatePolicy: 'reviewEveryUpdate',
            },
        },
    };
}

function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function createDeferred(): Readonly<{
    promise: Promise<void>;
    resolve: () => void;
}> {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

/**
 * Walks up from a rendered node to the nearest accessible/live-region
 * announcement parent. Detail rows that assistive technology can traverse
 * individually have no such ancestor; rows swallowed by an aggregate
 * accessible parent do.
 */
function closestAccessibleAnnouncementAncestor(node: ReactTestInstance | null): ReactTestInstance | null {
    let current = node?.parent ?? null;
    while (current !== null) {
        if (current.props?.accessible === true || typeof current.props?.accessibilityLiveRegion === 'string') {
            return current;
        }
        current = current.parent;
    }
    return null;
}

function findPendingChangeAction(
    screen: Awaited<ReturnType<typeof renderSettingsView>>,
    pendingChangeId: string,
    actionId: 'review' | 'reject',
): Readonly<{ id: string; title: string; subtitle?: string; disabled: boolean; onPress: () => void }> | undefined {
    return screen.findAllByType('ItemRowActions' as never)
        .flatMap((node: Readonly<{ props: Readonly<{ overflowTriggerTestID?: string; actions?: readonly Readonly<{ id: string; title: string; subtitle?: string; disabled: boolean; onPress: () => void }>[] }> }>) => (
            node.props.overflowTriggerTestID === `settings.plugins.management.pendingChanges.${pendingChangeId}.actions.overflow`
                ? node.props.actions ?? []
                : []
        ))
        .find((action: Readonly<{ id: string }>) => action.id === actionId) as
        | Readonly<{ id: string; title: string; subtitle?: string; disabled: boolean; onPress: () => void }>
        | undefined;
}

type DiscoverListingAction = Readonly<{
    id: string;
    title: string;
    accessibilityLabel?: string;
    subtitle?: string;
    disabled: boolean;
    onPress: () => void;
}>;

function discoverListingTestID(pluginId: string, sourceId = 'marketplace:curated'): string {
    return `settings.plugins.marketplace.entry.${sourceId}.${pluginId}`;
}

/**
 * The actions a Discover listing carries on its own row.
 *
 * One listing is one row, so a listing's actions are looked up through that
 * row's action cluster rather than through a row of their own.
 */
function findDiscoverListingActions(
    screen: Awaited<ReturnType<typeof renderSettingsView>>,
    pluginId: string,
    sourceId = 'marketplace:curated',
): readonly DiscoverListingAction[] {
    return screen.findAllByType('ItemRowActions' as never)
        .flatMap((node: Readonly<{ props: Readonly<{ overflowTriggerTestID?: string; actions?: readonly DiscoverListingAction[] }> }>) => (
            node.props.overflowTriggerTestID === `${discoverListingTestID(pluginId, sourceId)}.actions.overflow`
                ? node.props.actions ?? []
                : []
        ));
}

function findDiscoverInstallAction(
    screen: Awaited<ReturnType<typeof renderSettingsView>>,
    pluginId: string,
    sourceId = 'marketplace:curated',
): DiscoverListingAction | undefined {
    return findDiscoverListingActions(screen, pluginId, sourceId).find((action) => action.id === 'install');
}

/** Whether `node` renders inside `ancestor`, used to prove a fact belongs to one row. */
function isRenderedWithin(node: ReactTestInstance | null, ancestor: ReactTestInstance | null): boolean {
    if (!node || !ancestor) return false;
    let current: ReactTestInstance | null = node.parent ?? null;
    while (current !== null) {
        if (current === ancestor) return true;
        current = current.parent;
    }
    return false;
}

async function selectPluginManagementView(
    screen: Awaited<ReturnType<typeof renderSettingsView>>,
    view: 'installed' | 'discover' | 'development' | 'diagnostics',
): Promise<void> {
    await act(async () => {
        screen.pressByTestId(`settings.plugins.management.view:${view}`);
    });
}

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Pressable: 'Pressable',
            Text: 'Text',
            TextInput: 'TextInput',
            Platform: {
                OS: 'web',
                select: (options: any) => (options && 'default' in options ? options.default : undefined),
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                push: (value) => routerPushSpy(value),
                back: vi.fn(),
                replace: vi.fn(),
                setParams: vi.fn(),
            },
            navigation: {
                setOptions: (options: Readonly<Record<string, unknown>>) => navigationSetOptionsSpy(options),
            },
        }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: (...args) => modalAlertMock(...args),
                alertAsync: (...args) => modalAlertAsyncMock(...args),
                show: (...args) => modalShowMock(...args),
                confirm: (...args) => modalConfirmMock(...args),
                prompt: (...args) => modalPromptMock(...args),
            },
        }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useAllMachines: () => [],
            useMachineListByServerId: () => ({}),
            useMachineListStatusByServerId: () => ({}),
            useProfile: () => ({ id: 'prof_1', firstName: '', connectedServices: [] }),
        });
    },
    // The shared runtime's own mock convention (`key` or `key(param=value,...)`)
    // is used verbatim — no suite-local translation override, so every
    // parameterized-string assertion below describes the one shape the testkit
    // produces for any suite.
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock();
    },
});

// This suite's harness does not stand up the server-selection store the real
// feature hook subscribes to, and the plugins settings tree asks for exactly one
// feature, so the decision is supplied directly and every other id stays off.
const webhookFeature = vi.hoisted(() => ({ enabled: true }));
const observedFeatureIds = vi.hoisted(() => [] as string[]);

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => {
        observedFeatureIds.push(featureId);
        return featureId === 'plugins.webhooks' ? webhookFeature.enabled : false;
    },
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerId: () => getActiveServerIdMock(),
    getServerProfileById: (serverId: string) => (
        machineAdministrationFixture.profiles.find((profile) => profile.id === serverId) ?? null
    ),
    getActiveServerSnapshot: () => ({
        serverId: getActiveServerIdMock(),
        serverUrl: 'https://server.example.test',
        generation: 1,
    }),
    listServerProfiles: () => machineAdministrationFixture.profiles,
    resolveServerProfileForPortableIdentity: (serverIdentityId: string) => {
        const profiles = machineAdministrationFixture.profiles.filter((profile) => (
            profile.serverIdentityId === serverIdentityId
            || (Array.isArray(profile.legacyServerIds) && profile.legacyServerIds.includes(serverIdentityId))
        ));
        if (profiles.length === 1) {
            return { kind: 'resolved', serverIdentityId, profile: profiles[0] };
        }
        return profiles.length > 1
            ? { kind: 'ambiguous', serverIdentityId, profiles }
            : { kind: 'missing', serverIdentityId };
    },
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverId: machineAdministrationFixture.activeServerId,
        serverUrl: 'https://server-a.example.test',
        generation: 1,
    }),
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({
        serverId: machineAdministrationFixture.activeServerId,
        serverUrl: 'https://server-a.example.test',
        generation: 1,
    }),
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({
    useServerProfilesGeneration: () => 1,
}));

vi.mock('@/sync/domains/state/warmCachePersistence', () => ({
    loadMachineDisplayWarmCacheEntries: () => ({}),
}));

vi.mock('@/sync/domains/state/storageStore', () => ({
    storage: {
        getState: () => machineAdministrationFixture.storageState,
    },
    // The Account-scope reader was added to the canonical Settings writer;
    // expose that same safe state through this existing store boundary fixture.
    getStorage: () => (selector: (state: Readonly<{ settingsScope: Readonly<{ serverId: string; accountId: string }> | null }>) => unknown) => selector({ settingsScope: activeAccountScopeState.current }),
}));

vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({
    useMachineCapabilitiesCache: (...args: unknown[]) => useMachineCapabilitiesCacheMock(...args),
    getMachineCapabilitiesCacheState: (...args: unknown[]) => getMachineCapabilitiesCacheStateMock(...args),
    prefetchMachineCapabilities: (...args: unknown[]) => prefetchMachineCapabilitiesMock(...args),
}));

vi.mock('@/sync/store/hooks', () => ({
    useEndpointStatus: () => endpointConnectivityState.status,
    useLocalSetting: () => 'comfortable',
    useMachineCliDetectionTarget: (...args: unknown[]) => useMachineCliDetectionTargetMock(...args),
    useMachineRecordValues: () => machineAdministrationFixture.activeMachines,
    useMachineRecordListsByServerId: () => machineAdministrationFixture.machineListByServerId,
    useMachineListStatusByServerId: () => machineAdministrationFixture.machineListStatusByServerId,
    useIsDataReady: () => true,
    useActiveServerAccountScope: () => activeAccountScopeState.current,
    useProfile: () => ({ id: 'prof_1', firstName: '', connectedServices: [] }),
    useSetting: () => machineAdministrationFixture.selections,
    // The administration-target owner persists a sole-candidate initialization
    // through the versioned Account settings mutation, so a hydrated settings
    // version is part of this boundary's real contract rather than an optional
    // extra. Omitting it made every render of this screen throw.
    useSettingsVersion: () => machineAdministrationFixture.settingsVersion,
    useSettingMutable: () => [
        machineAdministrationFixture.selections,
        machineAdministrationFixture.setSelections,
    ],
}));

vi.mock('@/hooks/machine/useMachineCapabilityInvokeWithAlerts', () => ({
    useMachineCapabilityInvokeWithAlerts: () => ({
        isInvoking: false,
        invokeWithAlerts: invokeWithAlertsMock,
    }),
}));

vi.mock('@/sync/ops/machineMarketplaceSources', () => ({
    machineMarketplaceSourceRegistryGet: (...args: unknown[]) => machineMarketplaceSourceRegistryGetMock(...args),
    machineMarketplaceSourceRegistryMutate: (...args: unknown[]) => machineMarketplaceSourceRegistryMutateMock(...args),
    machineMarketplaceIndexQuery: (...args: unknown[]) => machineMarketplaceIndexQueryMock(...args),
    resolvePreferredMachineMarketplaceSource: (registry: MarketplaceSourceRegistryV1) =>
        registry.sources.find((entry) => entry.enabled && entry.origin === 'curated') ?? registry.sources.find((entry) => entry.enabled) ?? null,
}));

vi.mock('@/sync/ops/machineNpmRegistryProfiles', () => ({
    machineNpmRegistryProfilesGet: (...args: unknown[]) => machineNpmRegistryProfilesGetMock(...args),
    machineNpmRegistryProfilesMutate: (...args: unknown[]) => machineNpmRegistryProfilesMutateMock(...args),
}));

vi.mock('@/sync/ops/machineContributionRegistryProjection', async () => {
    // The real op only ever hands callers a projection the canonical projection
    // owner has already parsed, so every defaulted map — families, settings —
    // is present by the time a reader sees it. Fixtures are normalized through
    // that same owner here, so a test can never assert against a projection
    // shape the daemon boundary could not have produced.
    const { PluginProjectionV2Schema } = await import('@happier-dev/protocol');
    const normalizeDescribeResult = (result: unknown): unknown => {
        if (
            result === null
            || typeof result !== 'object'
            || (result as { supported?: unknown }).supported !== true
        ) return result;
        const projection = (result as { projection?: unknown }).projection;
        if (
            projection === null
            || typeof projection !== 'object'
            || (projection as { v?: unknown }).v !== 2
        ) return result;
        return {
            ...result,
            projection: PluginProjectionV2Schema.parse({
                // The wire schema defaults the finite family map during daemon
                // projection construction. These focused fixtures specify only
                // the families their assertion consumes, so model that parsed
                // boundary instead of making every fixture repeat an empty map.
                familiesById: {},
                ...projection,
            }),
        };
    };
    return ({
    getMachineContributionRegistryProjectionRevision: () => 0,
    subscribeMachineContributionRegistryProjectionInvalidation: () => () => {},
    machineContributionRegistryProjectionDescribe: async (...args: unknown[]) =>
        normalizeDescribeResult(await machineContributionRegistryProjectionDescribeMock(...args)),
    publishMachineContributionRegistryProjectionInvalidation: (...args: unknown[]) =>
        publishMachineContributionRegistryProjectionInvalidationMock(...args),
    machinePluginStructuredMessageActionExecute: (...args: unknown[]) =>
        machinePluginStructuredMessageActionExecuteMock(...args),
    machinePluginSettingsGet: async (
        machineId: string,
        opts: { serverId?: string | null; serverIdentityId: string; pluginId: string },
    ) => ({
        supported: true,
        snapshot: await machineRpcWithServerScopeMock({
            machineId,
            serverId: opts.serverId,
            method: 'daemon.plugins.settings.get',
            payload: {
                serverIdentityId: opts.serverIdentityId,
                machineId,
                pluginId: opts.pluginId,
                scope: { kind: 'daemon' },
            },
        }),
    }),
    machinePluginSettingsSet: async (
        machineId: string,
        opts: Readonly<{
            serverId?: string | null;
            serverIdentityId: string;
            pluginId: string;
            fieldId: string;
            mutation: Readonly<{ kind: 'set'; value: unknown }> | Readonly<{ kind: 'delete' }>;
            expectedRevision?: string;
        }>,
    ) => ({
        supported: true,
        snapshot: await machineRpcWithServerScopeMock({
            machineId,
            serverId: opts.serverId,
            method: 'daemon.plugins.settings.set',
            payload: {
                serverIdentityId: opts.serverIdentityId,
                machineId,
                pluginId: opts.pluginId,
                scope: { kind: 'daemon' },
                fieldId: opts.fieldId,
                mutation: opts.mutation,
                ...(opts.expectedRevision === undefined ? {} : { expectedRevision: opts.expectedRevision }),
            },
        }),
    }),
    machinePluginSecretStatus: async (
        machineId: string,
        opts: Readonly<{
            serverId: string;
            serverIdentityId: string;
            pluginId: string;
            secretId: string;
            canonicalOrigin?: string;
        }>,
    ) => ({
        supported: true,
        result: await machineRpcWithServerScopeMock({
            machineId,
            serverId: opts.serverId,
            method: 'daemon.plugins.secrets.status',
            payload: {
                serverIdentityId: opts.serverIdentityId,
                machineId,
                pluginId: opts.pluginId,
                secretId: opts.secretId,
                ...(opts.canonicalOrigin === undefined ? {} : { canonicalOrigin: opts.canonicalOrigin }),
            },
        }),
    }),
    machinePluginSecretSet: async (
        machineId: string,
        opts: Readonly<{
            serverId: string;
            serverIdentityId: string;
            pluginId: string;
            secretId: string;
            canonicalOrigin?: string;
            value: string;
            expectedRevision?: string;
        }>,
    ) => ({
        supported: true,
        result: await machineRpcWithServerScopeMock({
            machineId,
            serverId: opts.serverId,
            method: 'daemon.plugins.secrets.set',
            payload: {
                serverIdentityId: opts.serverIdentityId,
                machineId,
                pluginId: opts.pluginId,
                secretId: opts.secretId,
                ...(opts.canonicalOrigin === undefined ? {} : { canonicalOrigin: opts.canonicalOrigin }),
                value: opts.value,
                ...(opts.expectedRevision === undefined ? {} : { expectedRevision: opts.expectedRevision }),
            },
        }),
    }),
    machinePluginSecretDelete: async (
        machineId: string,
        opts: Readonly<{
            serverId: string;
            serverIdentityId: string;
            pluginId: string;
            secretId: string;
            canonicalOrigin?: string;
            expectedRevision?: string;
        }>,
    ) => ({
        supported: true,
        result: await machineRpcWithServerScopeMock({
            machineId,
            serverId: opts.serverId,
            method: 'daemon.plugins.secrets.delete',
            payload: {
                serverIdentityId: opts.serverIdentityId,
                machineId,
                pluginId: opts.pluginId,
                secretId: opts.secretId,
                ...(opts.canonicalOrigin === undefined ? {} : { canonicalOrigin: opts.canonicalOrigin }),
                ...(opts.expectedRevision === undefined ? {} : { expectedRevision: opts.expectedRevision }),
            },
        }),
    }),
    });
});

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (...args: readonly unknown[]) =>
        machineRpcWithServerScopeMock(...args),
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>();
    return {
        ...actual,
        captureActiveServerAccountScopeLifetime: () => activeAccountLifetime,
    };
});

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['claude', 'codex'],
    DEFAULT_AGENT_ID: 'claude',
    getAgentCore: (agentId: string) => ({
        displayNameKey: `agents.${agentId}.name`,
        uiConnectedService: { serviceId: null, labelKey: 'agentInput.agent.claude', connectRoute: null },
        ui: { agentPickerIconName: 'terminal-outline' },
    }),
    getAgentIconSource: () => null,
    getAgentIconTintColor: () => null,
    isBundledAgentId: (agentId: unknown) => agentId === 'claude' || agentId === 'codex',
    resolveBundledAgentIdFromContributionIdentity: () => null,
    resolveAgentIdFromConnectedServiceId: () => null,
}));

vi.mock('@/components/ui/lists/ItemRowActions', () => createPassThroughModule(['ItemRowActions']));

vi.mock('@happier-dev/agents', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/agents')>();
    const base = {
        AGENT_IDS: ['claude', 'codex'],
        CANONICAL_AGENT_IDS: ['claude', 'codex'],
        DEFAULT_AGENT_ID: 'claude',
        getAgentCore: (agentId: string) => ({
            connectedServices: null,
            ui: { agentPickerIconName: 'terminal-outline' },
            displayNameKey: `agents.${agentId}.name`,
        }),
        getAgentLocalCliConfig: () => ({
            detectKey: 'codex',
            machineLoginKey: 'codex',
        }),
        getAllAgentCatalogDefinitions: () => [],
        getAgentCliRuntimeSpec: () => ({ binaryName: null }),
        getProviderCliInstallGuideUrl: () => null,
        isBundledAgentId: (agentId: unknown) => agentId === 'claude' || agentId === 'codex',
        legacyCustomAcpCompat: {
            LEGACY_COMPAT_AGENT_IDS: ['customAcp'],
            getLegacyCustomAcpAgentLocalCliConfig: () => ({
                detectKey: 'customAcp',
                machineLoginKey: 'customAcp',
            }),
        },
    };

    return {
        ...actual,
        ...base,
    };
});

afterEach(() => {
    clearDaemonMergedProjectionCacheForTests();
    resetSessionDraftRepositoryForTests();
    activeAccountScopeState.current = null;
    getActiveServerIdMock.mockReset();
    useMachineCapabilitiesCacheMock.mockReset();
    getMachineCapabilitiesCacheStateMock.mockReset();
    useMachineCliDetectionTargetMock.mockReset();
    endpointConnectivityState.status = 'online';
    invokeWithAlertsMock.mockReset();
    refreshMachineCapabilitiesMock.mockReset();
    machineMarketplaceSourceRegistryGetMock.mockReset();
    machineMarketplaceSourceRegistryMutateMock.mockReset();
    machineMarketplaceIndexQueryMock.mockReset();
    machineNpmRegistryProfilesGetMock.mockReset();
    machineNpmRegistryProfilesMutateMock.mockReset();
    machineContributionRegistryProjectionDescribeMock.mockReset();
    machinePluginStructuredMessageActionExecuteMock.mockReset();
    publishMachineContributionRegistryProjectionInvalidationMock.mockReset();
    machineRpcWithServerScopeMock.mockReset();
    routerPushSpy.mockReset();
    navigationSetOptionsSpy.mockReset();
    modalAlertMock.mockReset();
    modalShowMock.mockReset();
    modalPromptMock.mockReset();
    modalConfirmMock.mockReset();
    modalAlertAsyncMock.mockClear();
    prefetchMachineCapabilitiesMock.mockReset();
    screenFocusState.value = true;
    machineAdministrationFixture.setSelections.mockReset();
    webhookFeature.enabled = true;
    observedFeatureIds.length = 0;
    vi.unstubAllGlobals();
});

beforeEach(() => {
    clearDaemonMergedProjectionCacheForTests();
    setMachineAdministrationTargetFixture();
    useMachineCliDetectionTargetMock.mockReturnValue({ daemonStateVersion: 1, isOnline: true });
    getMachineCapabilitiesCacheStateMock.mockImplementation(() => {
        const latestResult = useMachineCapabilitiesCacheMock.mock.results.at(-1)?.value as
            | Readonly<{ state?: MachineCapabilitiesState }>
            | undefined;
        return latestResult?.state ?? null;
    });
    getActiveServerIdMock.mockReturnValue('server-a');
    machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
        supported: true,
        projection: { v: 1, agentsById: {}, backendsById: {} },
    });
    machineMarketplaceIndexQueryMock.mockResolvedValue({ revision: 1, items: [], nextCursor: null, sources: [], diagnostics: [] });
    machineNpmRegistryProfilesGetMock.mockResolvedValue({
        status: 'success',
        snapshot: {
            protocolVersion: 1,
            revision: 1,
            profiles: [],
            pausedSources: [],
        },
    });
    machineNpmRegistryProfilesMutateMock.mockResolvedValue({
        status: 'success',
        snapshot: {
            protocolVersion: 1,
            revision: 1,
            profiles: [],
            pausedSources: [],
        },
    });
    machinePluginStructuredMessageActionExecuteMock.mockResolvedValue({
        supported: true,
        result: { ok: true, result: null },
    });
    modalPromptMock.mockResolvedValue(null);
    modalConfirmMock.mockResolvedValue(true);
    modalShowMock.mockImplementation((config: Readonly<{
        chrome?: Readonly<{ testID?: string }>;
        props?: Readonly<{
            review?: Readonly<{ optionalHostAccess: readonly Readonly<{ id: string }>[] }>;
            onResolve?: (result: Readonly<{
                approved: boolean;
                optionalSelections: readonly Readonly<{ accessId: string; selected: boolean }>[];
            }>) => void;
        }>;
    }>) => {
        if (config.chrome?.testID === 'settings.plugins.installReview') {
            config.props?.onResolve?.({
                approved: true,
                optionalSelections: (config.props.review?.optionalHostAccess ?? []).map((entry) => ({
                    accessId: entry.id,
                    selected: false,
                })),
            });
        }
        return 'plugin-install-review-modal';
    });
    prefetchMachineCapabilitiesMock.mockResolvedValue(undefined);
});

describe('PluginSettingsHomeScreen', () => {
    it.each(['create', 'createWithAgent'])('keeps the complete %s draft editable when creation confirmation is cancelled', async (action) => {
        useMachineCapabilitiesCacheMock.mockReturnValue({ state: createMachineCapabilitiesState([]), refresh: vi.fn() });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => { await flushAsync(); await flushAsync(); });
        await selectPluginManagementView(screen, 'development');
        await act(async () => { screen.pressByTestId(`settings.plugins.management.development.action.${action}`); });
        const form = modalShowMock.mock.calls.at(-1)?.[0]?.props?.form as import('@/components/plugins/actions/actionInputForm').ActionInputForm | undefined;
        expect(form).toBeDefined();
        if (!form) throw new Error('Expected the canonical authoring form');
        expect(form.getFields().map((field) => field.path)).toEqual(['targetDir', 'displayName', 'pluginId', 'ui']);
        const draft = { targetDir: '/workspace/plugin', displayName: 'Working Plugin', pluginId: 'com.example.working', ui: 'hostedWeb' };
        form.replaceInput(draft);
        modalConfirmMock.mockResolvedValueOnce(false);
        await act(async () => { await form.submit(); });
        expect(form.isRetired()).toBe(false);
        expect(form.getInput()).toEqual(draft);
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
        expect(modalPromptMock).not.toHaveBeenCalled();
    });

    it('does not claim an empty installation list before the first successful read', async () => {
        let capabilityState: MachineCapabilitiesState = { status: 'loading' };
        useMachineCapabilitiesCacheMock.mockImplementation(() => ({ state: capabilityState, refresh: vi.fn() }));
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const RerenderableHome = PluginSettingsHomeScreen as React.ComponentType<{ capabilityRevision?: number }>;
        const screen = await renderSettingsView(React.createElement(RerenderableHome, { capabilityRevision: 1 }));
        await act(async () => { await flushAsync(); });
        expect(screen.findRow('settings.plugins.marketplace.installed.empty')).toBeFalsy();
        expect(screen.findRow('settings.plugins.marketplace.installed.loading')).toBeTruthy();

        capabilityState = createMachineCapabilitiesState([]);
        await act(async () => {
            screen.tree.update(React.createElement(RerenderableHome, { capabilityRevision: 2 }));
            await flushAsync();
        });
        expect(screen.findRow('settings.plugins.marketplace.installed.loading')).toBeFalsy();
        expect(screen.findRow('settings.plugins.marketplace.installed.empty')).toBeTruthy();
        await act(async () => { screen.pressRow('settings.plugins.marketplace.installed.empty'); });
        expect(screen.findByTestId('settings.plugins.management.view:discover')?.props.accessibilityState).toMatchObject({ selected: true });
    });

    it.each(['home', 'detail'] as const)('offers cold capability failure recovery on %s without claiming absence', async (route) => {
        let capabilityState: MachineCapabilitiesState = { status: 'error' };
        const refresh = vi.fn(() => { capabilityState = createMachineCapabilitiesState([]); });
        useMachineCapabilitiesCacheMock.mockImplementation(() => ({ state: capabilityState, refresh }));
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const element = route === 'home'
            ? React.createElement(PluginSettingsHomeScreen)
            : React.createElement(PluginDetailScreen, { pluginId: 'unread-plugin' });
        const screen = await renderSettingsView(element);
        await act(async () => { await flushAsync(); await flushAsync(); });
        const prefix = route === 'home' ? 'settings.plugins.marketplace' : 'settings.plugins.detail';
        expect(screen.findRow(`${prefix}.readOnlySnapshot-retry`)).toBeTruthy();
        expect(screen.findRow('settings.plugins.marketplace.installed.empty')).toBeFalsy();
        await act(async () => {
            screen.pressRow(`${prefix}.readOnlySnapshot-retry`);
            await flushAsync();
        });
        expect(refresh).toHaveBeenCalledWith({ bypassCache: true });
    });

    it('routes plugin capabilities to the exact Administration target rather than active first-machine selection', async () => {
        setMachineAdministrationTargetFixture({
            serverIdentityId: 'srv_identity-b',
            serverId: 'server-b',
            machineId: 'admin-machine-b',
            daemonStateVersion: 7,
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        expect(useMachineCapabilitiesCacheMock.mock.calls.at(-1)?.[0]).toMatchObject({
            machineId: 'admin-machine-b',
            serverId: 'server-b',
            cacheKeySalt: expect.stringContaining('7'),
            enabled: true,
        });
        expect(screen.findRow('settings.plugins.administration.target.current')?.props.accessibilityLabel)
            .toContain('admin-machine-b');
    });

    it('links to plugin webhook administration from the canonical Plugins settings surface', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        expect(screen.findRow('settings.plugins.webhooks')).toBeTruthy();

        await act(async () => {
            screen.pressRow('settings.plugins.webhooks');
        });

        expect(routerPushSpy).toHaveBeenCalledWith('/settings/plugins/webhooks');
    });

    it('links to Sources & registries outside the Discover view', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        expect(screen.findRow('settings.plugins.sources')).toBeTruthy();
        await act(async () => { screen.pressRow('settings.plugins.sources'); });
        expect(routerPushSpy).toHaveBeenCalledWith('/settings/plugins/sources');
    });

    it('hides the webhook administration entry when the server webhook feature is unavailable', async () => {
        webhookFeature.enabled = false;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        expect(observedFeatureIds).toContain('plugins.webhooks');
        expect(screen.findRow('settings.plugins.webhooks')).toBeNull();
    });

    it('defaults to Installed and keeps every plugin-management view reachable through accessible selectors', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'com.acme.installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
            rollbackAvailability: 'available',
        });
        const capabilityState = createMachineCapabilitiesState([installedPlugin]);
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: capabilityState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockReturnValue(capabilityState);
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 12,
                installedPackagesById: {
                    'com.acme.installed-plugin': {
                        id: 'com.acme.installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                diagnostics: [createPluginDiagnosticRecord({
                    id: 'com.acme.installed-plugin:normalization:capability-missing:0',
                    pluginId: 'com.acme.installed-plugin',
                    severity: 'warning',
                    code: 'plugin_runtime_capability_missing',
                    message: 'Missing actions capability',
                })],
            },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        const installedSelector = screen.findByTestId('settings.plugins.management.view:installed');
        const discoverSelector = screen.findByTestId('settings.plugins.management.view:discover');
        const developmentSelector = screen.findByTestId('settings.plugins.management.view:development');
        const diagnosticsSelector = screen.findByTestId('settings.plugins.management.view:diagnostics');

        expect(installedSelector?.props.accessibilityRole).toBe('tab');
        expect(installedSelector?.props.accessibilityState).toMatchObject({ selected: true });
        expect(discoverSelector?.props.accessibilityState).toMatchObject({ selected: false });
        expect(developmentSelector?.props.accessibilityState).toMatchObject({ selected: false });
        expect(diagnosticsSelector).toBeTruthy();
        expect(diagnosticsSelector?.props.accessibilityState).toMatchObject({ selected: false });
        expect(screen.findByTestId('settings.plugins.management.viewScroller')?.props.horizontal).toBe(true);
        const taskOrder = screen.tree.root.findAll((node) => [
            'settings.plugins.management.view:installed',
            'settings.plugins.sources',
            'settings.plugins.management.view:development',
        ].includes(node.props.testID)).map((node) => node.props.testID);
        expect(taskOrder.indexOf('settings.plugins.management.view:installed')).toBeLessThan(taskOrder.indexOf('settings.plugins.sources'));
        expect(taskOrder.indexOf('settings.plugins.management.view:installed')).toBeLessThan(taskOrder.indexOf('settings.plugins.management.view:development'));
        expect(screen.findRow('settings.plugins.marketplace.installed.com.acme.installed-plugin')).toBeTruthy();
        expect(screen.findRow('settings.plugins.management.development.empty')).toBeFalsy();
        expect(screen.findRow('settings.plugins.registryDiagnostic.plugin_runtime_capability_missing.0')).toBeFalsy();

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:discover');
        });
        expect(screen.findByTestId('settings.plugins.management.view:discover')?.props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.findRow('settings.plugins.marketplace.installed.com.acme.installed-plugin')).toBeFalsy();
        // Discover owns search, an explicit refresh row, and source chips. The
        // retired catalog-URL/registries home controls no longer exist.
        const searchInput = screen.findRow('settings.plugins.marketplace.search');
        expect(searchInput).toBeTruthy();
        expect(searchInput?.props.accessibilityLabel).toBe('settingsPlugins.discoverSearchLabel');
        expect(searchInput?.props.value).toBe('');
        expect(screen.findRow('settings.plugins.marketplace.refreshDiscover')).toBeTruthy();
        expect(screen.findAllHostsByTestId('settings.plugins.marketplace.sourceFilter:all')).toHaveLength(1);
        expect(screen.findAllHostsByTestId('settings.plugins.marketplace.sourceFilter:marketplace:community-npm')).toHaveLength(1);
        // Entering Discover auto-loads the aggregate query: real (empty) search
        // text, no source filter, no client-side catalog fetch.
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            text: '',
            cursor: null,
            filters: { includeUnavailable: true },
        }), expect.any(Object));

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:development');
        });
        expect(screen.findByTestId('settings.plugins.management.view:development')?.props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.findRow('settings.plugins.management.development.empty')).toBeTruthy();

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:discover');
        });
        expect(screen.findRow('settings.plugins.marketplace.search')?.props.value).toBe('');
        // Revisiting Discover does not re-query: the aggregate page is acquired
        // once per daemon authority, then the user owns refreshes.
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:diagnostics');
        });
        expect(screen.findByTestId('settings.plugins.management.view:diagnostics')?.props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.findRow('settings.plugins.management.development.empty')).toBeFalsy();
        expect(screen.findRow('settings.plugins.registryDiagnostic.plugin_runtime_capability_missing.0')).toBeTruthy();
        expect(screen.getTextContent()).toContain('settingsPlugins.diagnosticsIssueTitle');
        expect(screen.getTextContent()).toContain('settingsPlugins.diagnosticsRecovery');
        expect(screen.getTextContent()).toContain(
            'settingsPlugins.diagnosticsTechnicalCode(code=plugin_runtime_capability_missing)',
        );
        expect(screen.findByTestId('settings.plugins.registryDiagnostic.plugin_runtime_capability_missing.0.code')?.props.selectable).toBe(true);
        expect(screen.findByTestId('settings.plugins.registryDiagnostic.plugin_runtime_capability_missing.0.message')?.props.selectable).toBe(true);
        expect(screen.findByTestId('settings.plugins.management.diagnostics.live')?.props.accessibilityLiveRegion).toBe('polite');
        expect(screen.findByTestId('settings.plugins.management.view:activity')).toBeFalsy();
    }, 120_000);

    it('announces marketplace loading and query failures through the single polite Discover status region', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [{
                id: 'marketplace:curated',
                title: 'Curated Marketplace',
                sourceUrl: 'https://marketplace.example.test/catalog.json',
                enabled: true,
                origin: 'curated',
                addedAtMs: 1,
                updatedAtMs: 1,
            }],
        });
        let rejectCatalogQuery!: (error: Error) => void;
        machineMarketplaceIndexQueryMock.mockImplementation(() => new Promise((_, reject) => {
            rejectCatalogQuery = reject;
        }));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');

        await act(async () => {
            await flushAsync();
        });

        // Entering Discover starts the aggregate query on its own; loading is
        // announced by the pane's one accessible status row, not by a separate
        // loading row.
        const loadingSummary = screen.findByTestId('settings.plugins.marketplace.discover.status.summary');
        const loadingAnnouncement = closestAccessibleAnnouncementAncestor(loadingSummary);
        expect(loadingAnnouncement?.props.accessible).toBe(true);
        expect(loadingAnnouncement?.props.accessibilityLiveRegion).toBe('polite');
        expect(loadingAnnouncement?.props.accessibilityLabel).toBe('settingsPlugins.discover.status.loading');

        rejectCatalogQuery(new Error('Marketplace query failed'));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        const errorSummary = screen.findByTestId('settings.plugins.marketplace.discover.status.summary');
        const errorAnnouncement = closestAccessibleAnnouncementAncestor(errorSummary);
        expect(errorAnnouncement?.props.accessibilityRole).toBe('alert');
        // The unified status region stays polite even for failures; the retired
        // assertive catalog.error region no longer exists.
        expect(errorAnnouncement?.props.accessibilityLiveRegion).toBe('polite');
        expect(errorAnnouncement?.props.accessibilityLabel)
            .toBe('settingsPlugins.discover.status.errorTitle settingsPlugins.discover.diagnostic.recovery');
        expect(screen.getTextContent()).not.toContain('Marketplace query failed');
    });

    it('keeps degraded-source, diagnostic, and non-installable detail rows traversable outside the single polite status announcement', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [{
                id: 'marketplace:curated',
                title: 'Curated Marketplace',
                sourceUrl: 'https://marketplace.example.test/catalog.json',
                enabled: true,
                origin: 'curated',
                addedAtMs: 1,
                updatedAtMs: 1,
            }],
        });
        // One stale source with its own diagnostic, one index-level diagnostic,
        // and one listing the stale source blocks: every detail family the
        // status summary only counts.
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult(
            [createMarketplaceCatalogEntry({ pluginId: 'locked-plugin', title: 'Locked Plugin' })],
            {
                freshnessState: 'stale',
                sourceDiagnostics: [{ code: 'source_index_stale', message: 'Source index is stale' }],
                indexDiagnostics: [{ code: 'index_partial', message: 'Index served partial results' }],
            },
        ));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');

        await act(async () => {
            // Entering Discover acquires the aggregate page on its own.
            await flushAsync();
            await flushAsync();
        });

        const sourceHealthRow = screen.findByTestId('settings.plugins.marketplace.discover.sourceHealth.marketplace:curated');
        const sourceDiagnosticRow = screen.findByTestId(
            'settings.plugins.marketplace.discover.diagnostic.source:marketplace%3Acurated:source_index_stale:0',
        );
        const diagnosticRow = screen.findByTestId(
            'settings.plugins.marketplace.discover.diagnostic.index:index_partial:0',
        );
        const nonInstallableRow = screen.findByTestId('settings.plugins.marketplace.discover.nonInstallable.marketplace:curated.locked-plugin');
        expect(sourceHealthRow).toBeTruthy();
        expect(sourceDiagnosticRow).toBeTruthy();
        expect(screen.getTextContent()).toContain('Curated Marketplace · settingsPlugins.discover.diagnostic.title');
        expect(screen.getTextContent()).toContain('Source index is stale');
        expect(screen.getTextContent()).toContain('settingsPlugins.diagnosticsTechnicalCode(code=source_index_stale)');
        expect(diagnosticRow).toBeTruthy();
        expect(screen.getTextContent()).toContain('settingsPlugins.discover.diagnostic.title');
        expect(screen.getTextContent()).toContain('settingsPlugins.discover.diagnostic.recovery');
        expect(screen.getTextContent()).toContain('settingsPlugins.diagnosticsTechnicalCode(code=index_partial)');
        expect(nonInstallableRow).toBeTruthy();

        // Exactly one polite announcement remains, scoped to the compact
        // summary row, still carrying the aggregate counts.
        const summaryRow = screen.findByTestId('settings.plugins.marketplace.discover.status.summary');
        const announcement = closestAccessibleAnnouncementAncestor(summaryRow);
        expect(announcement?.props.accessible).toBe(true);
        expect(announcement?.props.accessibilityLiveRegion).toBe('polite');
        expect(announcement?.props.accessibilityLabel).not.toContain('settingsPlugins.discover.status.empty');
        expect(announcement?.props.accessibilityLabel).toContain('settingsPlugins.discover.status.nonInstallable');
        expect(announcement?.props.accessibilityLabel).toContain('settingsPlugins.discover.status.partial');

        // Each detail row sits outside the accessible announcement parent, so
        // VoiceOver and TalkBack can traverse the exact failures one by one.
        expect(closestAccessibleAnnouncementAncestor(sourceHealthRow)).toBeNull();
        expect(closestAccessibleAnnouncementAncestor(sourceDiagnosticRow)).toBeNull();
        expect(closestAccessibleAnnouncementAncestor(diagnosticRow)).toBeNull();
        expect(closestAccessibleAnnouncementAncestor(nonInstallableRow)).toBeNull();
    });

    it('uses daemon-projected development diagnostics and exposes only source-scoped safe author actions', async () => {
        const ordinaryPathPlugin = createInstalledPlugin({
            pluginId: 'ordinary-path-plugin',
            title: 'Ordinary Path Plugin',
            version: '1.0.0',
            source: {
                kind: 'path',
                locator: '/plugins/ordinary-path-plugin',
            },
        });
        const archivePlugin = createInstalledPlugin({
            pluginId: 'archive-plugin',
            title: 'Archive Plugin',
            version: '2.0.0',
            source: {
                kind: 'archive',
                locator: '/plugins/archive-plugin.tgz',
                devWatch: true,
            },
        });
        const developmentPlugin = createInstalledPlugin({
            pluginId: 'development-plugin',
            title: 'Development Plugin',
            version: '3.0.0-dev',
            source: {
                kind: 'path',
                locator: '/plugins/development-plugin',
                devWatch: true,
            },
            compatibility: {
                status: 'incompatible',
                diagnostics: [],
            },
            diagnostics: [],
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([
                ordinaryPathPlugin,
                archivePlugin,
                developmentPlugin,
            ], [{
                pluginId: 'development-plugin',
                sourceRootPath: '/plugins/development-plugin',
                watch: { state: 'configured' },
                reload: {
                    state: 'attention',
                    diagnostics: [{
                        code: 'plugin_development_watch_warning',
                        message: 'Development watch diagnostic',
                    }],
                },
                actions: { test: true, pack: true },
            }]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: { ok: true, result: { action: 'test', pluginId: 'development-plugin' } },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'development');

        const developmentRow = screen.findRow('settings.plugins.management.development.development-plugin');
        expect(developmentRow).toBeTruthy();
        expect(screen.findByTestId('settings.plugins.management.development.development-plugin.details')?.props.selectable).toBe(true);
        expect(screen.getTextContent()).toContain('Development Plugin');
        expect(screen.getTextContent()).toContain('3.0.0-dev');
        expect(screen.getTextContent()).toContain('development-plugin');
        expect(screen.getTextContent()).toContain('/plugins/development-plugin');
        expect(screen.getTextContent()).toContain('incompatible');
        expect(screen.getTextContent()).toContain('Development watch diagnostic');
        expect(developmentRow?.props.onPress).toBeUndefined();
        expect(screen.getTextContent()).toContain('settingsPlugins.developmentWatchConfigured');
        expect(screen.getTextContent()).toContain('settingsPlugins.developmentReloadAttention');

        expect(screen.findRow('settings.plugins.management.development.ordinary-path-plugin')).toBeFalsy();
        expect(screen.findRow('settings.plugins.management.development.archive-plugin')).toBeFalsy();
        expect(screen.findRow('settings.plugins.management.development.empty')).toBeFalsy();
        expect(screen.findRow('settings.plugins.management.development.development-plugin.action.reload')).toBeFalsy();
        expect(screen.findRow('settings.plugins.management.development.action.create')?.props.disabled).toBeFalsy();
        expect(screen.findRow('settings.plugins.management.development.development-plugin.action.test')?.props.disabled).toBeFalsy();
        expect(screen.findRow('settings.plugins.management.development.development-plugin.action.pack')?.props.disabled).toBeFalsy();

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.action.create');
            await flushAsync();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });

        const createForm = modalShowMock.mock.calls.at(-1)?.[0]?.props?.form as import('@/components/plugins/actions/actionInputForm').ActionInputForm;
        createForm.replaceInput({ targetDir: '/workspace/plugins/new-plugin', displayName: 'New Plugin', pluginId: 'acme.new-plugin', ui: 'reactNative' });
        await act(async () => { await createForm.submit(); await flushAsync(); });

        expect(modalConfirmMock).toHaveBeenCalled();
        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'create',
                params: {
                    targetDir: '/workspace/plugins/new-plugin',
                    displayName: 'New Plugin',
                    pluginId: 'acme.new-plugin',
                    ui: 'reactNative',
                },
            },
        }));

        // The author is asked which UI surface the new plugin starts with, and
        // declining a surface must still create the plugin without one — the
        // mode is never inferred or silently defaulted.
        expect(createForm.getFields().find((field) => field.path === 'ui')?.options?.map((option) => option.value)).toEqual(['reactNative', 'hostedWeb', 'none']);

        invokeWithAlertsMock.mockClear();
        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.action.create');
            await flushAsync();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });
        const plainForm = modalShowMock.mock.calls.at(-1)?.[0]?.props?.form as import('@/components/plugins/actions/actionInputForm').ActionInputForm;
        plainForm.replaceInput({ targetDir: '/workspace/plugins/plain-plugin', displayName: 'Plain Plugin', pluginId: 'acme.plain-plugin', ui: 'none' });
        await act(async () => { await plainForm.submit(); await flushAsync(); });
        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'create',
                params: {
                    targetDir: '/workspace/plugins/plain-plugin',
                    displayName: 'Plain Plugin',
                    pluginId: 'acme.plain-plugin',
                },
            },
        }));
        invokeWithAlertsMock.mockClear();

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.development-plugin.action.test');
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'test',
                params: { pluginId: 'development-plugin' },
            },
        }));
    });

    it('opens Edit with Agent as an ordinary New Session on the exact development target and source root', async () => {
        const accountScope = { serverId: 'server-a', accountId: 'account-a' } as const;
        activeAccountScopeState.current = accountScope;
        const developmentPlugin = createInstalledPlugin({
            pluginId: 'development-plugin',
            title: 'Development Plugin',
            version: '3.0.0-dev',
            source: {
                kind: 'path',
                locator: '/plugins/development-plugin',
                devWatch: true,
            },
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([developmentPlugin], [{
                pluginId: 'development-plugin',
                sourceRootPath: '/plugins/development-plugin',
                watch: { state: 'configured' },
                reload: { state: 'clear', diagnostics: [] },
                actions: { test: true, pack: true },
            }]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => { await flushAsync(); await flushAsync(); });
        await selectPluginManagementView(screen, 'development');

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.development-plugin.action.editWithAgent');
            await flushAsync();
        });

        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
        const route = routerPushSpy.mock.calls.at(-1)?.[0] as Readonly<{
            pathname: string;
            params: Readonly<{ draftId: string }>;
        }>;
        expect(route).toEqual({
            pathname: '/new',
            params: { draftId: expect.any(String) },
        });
        expect(readNewSessionDraftFromRepository({ scope: accountScope, draftId: route.params.draftId })).toMatchObject({
            input: 'settingsPlugins.developmentEditWithAgentPrompt(pluginId=development-plugin)',
            selectedMachineId: 'machine-1',
            targetServerId: 'server-a',
            selectedPath: '/plugins/development-plugin',
            executionTarget: { serverId: 'server-a', machineId: 'machine-1' },
            entryIntent: 'session',
        });
    });

    it('creates through the deterministic scaffold owner before opening Create with Agent in that plugin root', async () => {
        const accountScope = { serverId: 'server-a', accountId: 'account-a' } as const;
        activeAccountScopeState.current = accountScope;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'create',
                    pluginId: 'acme.agent-plugin',
                    sourceRootPath: '/workspace/plugins/agent-plugin',
                },
            },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => { await flushAsync(); await flushAsync(); });
        await selectPluginManagementView(screen, 'development');

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.action.createWithAgent');
            await flushAsync();
            await flushAsync();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });
        const agentForm = modalShowMock.mock.calls.at(-1)?.[0]?.props?.form as import('@/components/plugins/actions/actionInputForm').ActionInputForm;
        agentForm.replaceInput({ targetDir: '/workspace/plugins/agent-plugin', displayName: 'Agent Plugin', pluginId: 'acme.agent-plugin', ui: 'reactNative' });
        await act(async () => { await agentForm.submit(); await flushAsync(); });

        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'create',
                params: {
                    targetDir: '/workspace/plugins/agent-plugin',
                    displayName: 'Agent Plugin',
                    pluginId: 'acme.agent-plugin',
                    ui: 'reactNative',
                },
            },
        }));
        const route = routerPushSpy.mock.calls.at(-1)?.[0] as Readonly<{
            pathname: string;
            params: Readonly<{ draftId: string }>;
        }>;
        expect(route.pathname).toBe('/new');
        expect(readNewSessionDraftFromRepository({ scope: accountScope, draftId: route.params.draftId })).toMatchObject({
            input: 'settingsPlugins.developmentCreateWithAgentPrompt(pluginId=acme.agent-plugin)',
            selectedMachineId: 'machine-1',
            targetServerId: 'server-a',
            selectedPath: '/workspace/plugins/agent-plugin',
            executionTarget: { serverId: 'server-a', machineId: 'machine-1' },
            entryIntent: 'session',
        });
    });

    it('lists a pending change this app never started and lets the present user decide it', async () => {
        // The flagship agent-authored loop: an Agent prepares a plugin change
        // through its Action, the daemon issues a pending id, and nothing in
        // this app ever saw that id. Without this section the change is
        // invisible and expires unanswered, because approving source-root and
        // package trust is not delegable to an Agent.
        const refresh = vi.fn();
        const sourceRootPath = '/workspace/plugins/agent-authored';
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([], [], [{
                kind: 'sourceRootReviewRequired',
                pendingChangeId: 'pending-agent-1',
                review: { source: { kind: 'path', locator: sourceRootPath } },
            }]),
            refresh,
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'changeStatus',
                    pendingChangeId: 'pending-agent-1',
                    status: {
                        kind: 'sourceRootReviewRequired',
                        pendingChangeId: 'pending-agent-1',
                        review: { source: { kind: 'path', locator: sourceRootPath } },
                    },
                },
            },
        });
        machineRpcWithServerScopeMock
            .mockResolvedValueOnce(createCommunityInstallReviewResult('pending-agent-1').change)
            .mockResolvedValueOnce({
                kind: 'committed',
                pluginId: 'community-plugin',
                desiredGeneration: 'generation-1',
                appliedGeneration: 'generation-1',
                pendingSurfaces: [],
            });
        modalConfirmMock.mockResolvedValueOnce(true);
        modalShowMock.mockImplementationOnce((config: Readonly<{
            props?: Readonly<{
                onResolve?: (result: Readonly<{
                    approved: boolean;
                    optionalSelections: readonly Readonly<{ accessId: string; selected: boolean }>[];
                }>) => void;
            }>;
        }>) => {
            config.props?.onResolve?.({ approved: true, optionalSelections: [{ accessId: 'sessions', selected: true }] });
            return 'plugin-install-review-modal';
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        // Listed on the plugin settings surface itself, not behind a tab: a
        // decision waiting on this user is attention, not one view's content.
        expect(screen.findRow('settings.plugins.management.pendingChanges.pending-agent-1')).toBeTruthy();

        const approve = findPendingChangeAction(screen, 'pending-agent-1', 'review');
        expect(approve?.disabled).toBe(false);
        await act(async () => {
            approve?.onPress();
            await flushAsync();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });

        // The listed row is a projection that can be minutes old, so the change
        // is re-read at its owner before the user is asked anything.
        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'changeStatus',
                params: { pendingChangeId: 'pending-agent-1' },
            },
        }));
        expect(modalConfirmMock).toHaveBeenCalledWith(
            'settingsPlugins.developmentTrustSourceRootTitle',
            expect.stringContaining(sourceRootPath),
            expect.objectContaining({ confirmText: 'settingsPlugins.developmentTrustSourceRootConfirm' }),
        );
        // Same canonical decision seam the CLI and this screen's own flows use:
        // source-root trust first, then the package review the daemon answers
        // with. The Agent's id is carried through both, never re-created.
        expect(machineRpcWithServerScopeMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: {
                v: 1,
                pendingChangeId: 'pending-agent-1',
                decision: 'trustSourceRoot',
            },
        }));
        expect(machineRpcWithServerScopeMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: expect.objectContaining({
                pendingChangeId: 'pending-agent-1',
                decision: 'installAndTrust',
                optionalSelections: [{ accessId: 'sessions', selected: true }],
            }),
        }));
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('labels pending decision actions truthfully before any review has been seen', async () => {
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([], [], [
                createCommunityInstallReviewResult('pending-agent-8').change,
            ]),
            refresh,
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.management.pendingChanges.pending-agent-8')).toBeTruthy();
        // The row action opens the full install-and-trust review; nothing has
        // been approved yet, so it must not be labeled as an approval.
        const review = findPendingChangeAction(screen, 'pending-agent-8', 'review');
        expect(review?.title).toBe('settingsPlugins.pendingChangeReviewAction');
        expect(review?.subtitle).toBe('settingsPlugins.pendingChangesReviewHint');
        // Reject discards the change without ever opening the review, so its
        // copy must not claim that it shows one.
        const reject = findPendingChangeAction(screen, 'pending-agent-8', 'reject');
        expect(reject?.title).toBe('approvals.reject');
        expect(reject?.subtitle).toBe('settingsPlugins.pendingChangeRejectHint');
    });

    it('rejects a pending change through the same daemon change owner', async () => {
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([], [], [
                createCommunityInstallReviewResult('pending-agent-2').change,
            ]),
            refresh,
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'changeStatus',
                    pendingChangeId: 'pending-agent-2',
                    status: createCommunityInstallReviewResult('pending-agent-2').change,
                },
            },
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ kind: 'cancelled' });
        modalConfirmMock.mockResolvedValueOnce(true);

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.management.pendingChanges.pending-agent-2')).toBeTruthy();
        await act(async () => {
            findPendingChangeAction(screen, 'pending-agent-2', 'reject')?.onPress();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });

        // A rejection is a consequential machine-scoped operation: the exact
        // server and machine it discards the change on are named before the
        // user confirms, the same facts every other confirmation on this
        // screen carries.
        expect(modalConfirmMock).toHaveBeenCalledWith(
            'approvals.reject',
            'settingsPlugins.pendingChangeConfirmRejectBody(machine=machine-1,server=Server A)',
            expect.objectContaining({ confirmText: 'approvals.reject', cancelText: 'common.cancel', destructive: true }),
        );
        // A rejection never fabricates approval evidence: it is the daemon's
        // own cancel decision, carrying no actor evidence at all.
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: { v: 1, pendingChangeId: 'pending-agent-2', decision: 'cancel' },
        }));
        expect(modalShowMock).not.toHaveBeenCalled();
        expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'settingsPlugins.pendingChangeRejected');
    });

    it('renders the change owner\'s own answer when a listed change is no longer decidable', async () => {
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([], [], [
                createCommunityInstallReviewResult('pending-agent-3').change,
            ]),
            refresh,
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'changeStatus',
                    pendingChangeId: 'pending-agent-3',
                    status: { kind: 'expired' },
                },
            },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await act(async () => {
            findPendingChangeAction(screen, 'pending-agent-3', 'review')?.onPress();
            await flushAsync();
            await flushAsync();
        });

        // A stale row must never become an approval. The owner said the change
        // is gone, so nothing is decided and the user is told the truth.
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(modalAlertMock).toHaveBeenCalledWith('common.error', 'settingsPlugins.pendingChangeExpired');
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('presents a rejoin whose change the owner already committed as applied, not as a failure', async () => {
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([], [], [
                createCommunityInstallReviewResult('pending-agent-4').change,
            ]),
            refresh,
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'changeStatus',
                    pendingChangeId: 'pending-agent-4',
                    status: {
                        kind: 'terminal',
                        pendingChangeId: 'pending-agent-4',
                        result: { kind: 'committed', pluginId: 'community-plugin' },
                    },
                },
            },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await act(async () => {
            findPendingChangeAction(screen, 'pending-agent-4', 'review')?.onPress();
            await flushAsync();
            await flushAsync();
        });

        // The change owner answered `committed` — possibly decided by another
        // client while this rejoin was in flight. The applied state is the
        // success answer; re-presenting it as a failure would be untrue.
        expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'settingsPlugins.pendingChangeCommitted');
        expect(modalAlertMock).not.toHaveBeenCalledWith('common.error', expect.anything());
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(refresh).toHaveBeenCalledWith({ bypassCache: true });
    });

    it('reconciles an ambiguous approve decision against the exact original target instead of reporting failure', async () => {
        const initialState = createMachineCapabilitiesState([], [], [
            createCommunityInstallReviewResult('pending-agent-5').change,
        ]);
        let authoritativeState: MachineCapabilitiesState = initialState;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: initialState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockImplementation(() => authoritativeState);
        prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
            authoritativeState = createMachineCapabilitiesState([
                createInstalledPlugin({
                    pluginId: 'community-plugin',
                    title: 'Community Plugin',
                    version: '2.0.0',
                }),
            ]);
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'changeStatus',
                    pendingChangeId: 'pending-agent-5',
                    status: createCommunityInstallReviewResult('pending-agent-5').change,
                },
            },
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ kind: 'outcomeUnknown', pluginId: 'community-plugin' });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await act(async () => {
            findPendingChangeAction(screen, 'pending-agent-5', 'review')?.onPress();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });

        // Approving is commit-intended: the daemon may have applied the change
        // after the decision left this device. The answer is reconciled on the
        // exact original target only — the same path an ordinary install or
        // update already uses — and a proven landing is a success, never the
        // old false "was not applied" failure.
        expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: expect.objectContaining({ bypassCache: true }),
        }));
        expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'common.done');
        expect(modalAlertMock).not.toHaveBeenCalledWith('common.error', 'settingsPlugins.pendingChangeFailed');
    });

    it('presents the truthful unresolved copy when an ambiguous approve cannot be proven on the exact target', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'community-plugin',
            title: 'Community Plugin',
            version: '1.0.0',
        });
        const capabilityState = createMachineCapabilitiesState([installedPlugin], [], [
            createCommunityInstallReviewResult('pending-agent-6').change,
        ]);
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: capabilityState,
            refresh: vi.fn(),
        });
        // The authoritative re-read answers with the unchanged 1.0.0 record, so
        // the reviewed 2.0.0 commit cannot be proven.
        getMachineCapabilitiesCacheStateMock.mockReturnValue(capabilityState);
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'changeStatus',
                    pendingChangeId: 'pending-agent-6',
                    status: createCommunityInstallReviewResult('pending-agent-6').change,
                },
            },
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ kind: 'outcomeUnknown', pluginId: 'community-plugin' });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await act(async () => {
            findPendingChangeAction(screen, 'pending-agent-6', 'review')?.onPress();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });

        // Unprovable is not failed: the change may have committed, so the user
        // gets the truthful unresolved answer naming the exact target instead
        // of a failure that invites deciding the same change again.
        expect(modalAlertMock).toHaveBeenCalledWith(
            'settingsPlugins.pluginChangeOutcomeUnknownTitle',
            'settingsPlugins.pluginChangeOutcomeUnknownBody(action=settingsPlugins.installAndTrust,name=Community Plugin,machine=machine-1,server=Server A)',
        );
        expect(modalAlertMock).not.toHaveBeenCalledWith('common.error', 'settingsPlugins.pendingChangeFailed');
    });

    it('reconciles a terminal outcome-unknown rejoin against the exact target before the unresolved copy', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'community-plugin',
            title: 'Community Plugin',
            version: '1.0.0',
        });
        const capabilityState = createMachineCapabilitiesState([installedPlugin], [], [
            createCommunityInstallReviewResult('pending-agent-7').change,
        ]);
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: capabilityState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockReturnValue(capabilityState);
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'changeStatus',
                    pendingChangeId: 'pending-agent-7',
                    status: {
                        kind: 'terminal',
                        pendingChangeId: 'pending-agent-7',
                        result: { kind: 'outcomeUnknown', pluginId: 'community-plugin' },
                    },
                },
            },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await act(async () => {
            findPendingChangeAction(screen, 'pending-agent-7', 'review')?.onPress();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });

        // A terminal outcome-unknown answer is not "was not applied": the exact
        // original target is re-read first, and the unresolved copy is the
        // truthful presentation when the landing still cannot be proven.
        expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: expect.objectContaining({ bypassCache: true }),
        }));
        expect(modalAlertMock).toHaveBeenCalledWith(
            'settingsPlugins.pluginChangeOutcomeUnknownTitle',
            'settingsPlugins.pluginChangeOutcomeUnknownBody(action=settingsPlugins.installAndTrust,name=community-plugin,machine=machine-1,server=Server A)',
        );
        expect(modalAlertMock).not.toHaveBeenCalledWith(
            'common.error',
            'settingsPlugins.pendingChangeFailed',
        );
    });

    it('names the exact source root in a separate trust decision before the plugin install review', async () => {
        const refresh = vi.fn();
        const sourceRootPath = '/workspace/plugins/local-authoring';
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh,
        });
        const developResult = {
            action: 'develop',
            sourceRootPath,
            change: {
                kind: 'sourceRootReviewRequired',
                pendingChangeId: 'pending-source-root-1',
                review: { source: { kind: 'path', locator: sourceRootPath } },
            },
        };
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: { ok: true, result: developResult },
        });
        machineRpcWithServerScopeMock
            .mockResolvedValueOnce(createCommunityInstallReviewResult('pending-source-root-1').change)
            .mockResolvedValueOnce({
                kind: 'committed',
                pluginId: 'community-plugin',
                desiredGeneration: 'generation-1',
                appliedGeneration: 'generation-1',
                pendingSurfaces: [],
            });
        modalPromptMock.mockResolvedValueOnce(sourceRootPath);
        modalConfirmMock.mockResolvedValueOnce(true);
        modalShowMock.mockImplementationOnce((config: Readonly<{
            props?: Readonly<{
                onResolve?: (result: Readonly<{
                    approved: boolean;
                    optionalSelections: readonly Readonly<{ accessId: string; selected: boolean }>[];
                }>) => void;
            }>;
        }>) => {
            config.props?.onResolve?.({ approved: true, optionalSelections: [{ accessId: 'sessions', selected: false }] });
            return 'plugin-install-review-modal';
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'development');

        expect(screen.findRow('settings.plugins.management.development.action.develop')?.props.disabled).toBeFalsy();
        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.action.develop');
            await flushAsync();
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'develop',
                params: { sourceRootPath },
            },
        }));
        // The security payload is the path itself, and a path is a location on
        // ONE machine reached through ONE server: `/Users/me/project` exists on
        // several of them, so a trust decision naming only the path cannot tell
        // the user whose filesystem the daemon will build and run code from.
        expect(modalConfirmMock).toHaveBeenCalledWith(
            'settingsPlugins.developmentTrustSourceRootTitle',
            'settingsPlugins.developmentTrustSourceRootBody(path=/workspace/plugins/local-authoring,machine=machine-1,server=Server A)',
            expect.objectContaining({ confirmText: 'settingsPlugins.developmentTrustSourceRootConfirm' }),
        );
        // Trusting a source root is NOT an install commit: the first decision
        // carries `trustSourceRoot`, and only the separate package review that
        // the daemon answers with may carry `installAndTrust`.
        expect(machineRpcWithServerScopeMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: {
                v: 1,
                pendingChangeId: 'pending-source-root-1',
                decision: 'trustSourceRoot',
            },
        }));
        expect(machineRpcWithServerScopeMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: expect.objectContaining({
                pendingChangeId: 'pending-source-root-1',
                decision: 'installAndTrust',
                optionalSelections: [{ accessId: 'sessions', selected: false }],
            }),
        }));
        expect(refresh).toHaveBeenCalledTimes(1);

        // Declining the source root cancels the pending change and never reaches
        // a package review.
        machineRpcWithServerScopeMock.mockClear();
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ kind: 'cancelled' });
        modalPromptMock.mockResolvedValueOnce(sourceRootPath);
        modalConfirmMock.mockResolvedValueOnce(false);
        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.action.develop');
            await flushAsync();
            await flushAsync();
            await flushAsync();
        });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            payload: { v: 1, pendingChangeId: 'pending-source-root-1', decision: 'cancel' },
        }));
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('fails the local development affordance closed when the daemon does not advertise the develop action', async () => {
        const staleState: LoadedMachineCapabilitiesState = {
            status: 'loaded',
            snapshot: {
                response: {
                    protocolVersion: 1,
                    results: {
                        [MARKETPLACE_CAPABILITY_ID]: {
                            ok: true,
                            checkedAt: Date.now(),
                            data: { installedPlugins: [], developmentSources: [] },
                        },
                    },
                },
            },
        };
        useMachineCapabilitiesCacheMock.mockReturnValue({ state: staleState, refresh: vi.fn() });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'development');

        expect(screen.findRow('settings.plugins.management.development.action.develop')?.props.disabled).toBe(true);
        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.action.develop');
            await flushAsync();
        });
        expect(modalPromptMock).not.toHaveBeenCalled();
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
    });

    it('keeps cached development actions visible but disabled and non-mutating while daemon truth is stale', async () => {
        const developmentPlugin = createInstalledPlugin({
            pluginId: 'development-plugin',
            title: 'Development Plugin',
            version: '1.0.0-dev',
            source: { kind: 'path', locator: '/plugins/development-plugin', devWatch: true },
        });
        const errorState = createMachineCapabilitiesState([developmentPlugin], [{
            pluginId: 'development-plugin',
            sourceRootPath: '/plugins/development-plugin',
            watch: { state: 'configured' },
            reload: { state: 'clear', diagnostics: [] },
            actions: { test: true, pack: true },
        }]);
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: { ...errorState, status: 'error' },
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'development');

        expect(screen.findRow('settings.plugins.management.development.development-plugin')).toBeTruthy();
        expect(screen.findRow('settings.plugins.management.development.action.create')?.props.disabled).toBe(true);
        expect(screen.findRow('settings.plugins.management.development.development-plugin.action.test')?.props.disabled).toBe(true);
        expect(screen.findRow('settings.plugins.management.development.development-plugin.action.pack')?.props.disabled).toBe(true);

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.development.development-plugin.action.pack');
            await flushAsync();
        });
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
    });

    it('keeps the last approved development-source snapshot visible when disconnect removes the active capability snapshot', async () => {
        const developmentPlugin = createInstalledPlugin({
            pluginId: 'development-plugin',
            title: 'Development Plugin',
            version: '1.0.0-dev',
            source: { kind: 'path', locator: '/plugins/development-plugin', devWatch: true },
        });
        let machineTarget = { daemonStateVersion: 7, isOnline: true };
        let capabilityState: MachineCapabilitiesState = createMachineCapabilitiesState([developmentPlugin], [{
            pluginId: 'development-plugin',
            sourceRootPath: '/plugins/development-plugin',
            watch: { state: 'configured' },
            reload: { state: 'clear', diagnostics: [] },
            actions: { test: true, pack: true },
        }]);
        useMachineCliDetectionTargetMock.mockImplementation(() => machineTarget);
        useMachineCapabilitiesCacheMock.mockImplementation(() => ({
            state: capabilityState,
            refresh: vi.fn(),
        }));
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const RerenderablePluginSettingsHomeScreen = PluginSettingsHomeScreen as unknown as React.ComponentType<{
            capabilityRevision: number;
        }>;
        const screen = await renderSettingsView(React.createElement(RerenderablePluginSettingsHomeScreen, {
            capabilityRevision: 1,
        }));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'development');

        expect(screen.findRow('settings.plugins.management.development.development-plugin')).toBeTruthy();

        endpointConnectivityState.status = 'offline';
        capabilityState = { status: 'idle' };
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginSettingsHomeScreen, {
                capabilityRevision: 2,
            }));
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot')).toBeTruthy();
        expect(screen.findRow('settings.plugins.management.development.development-plugin')).toBeTruthy();
        expect(screen.findRow('settings.plugins.management.development.action.create')?.props.disabled).toBe(true);
        expect(screen.findRow('settings.plugins.management.development.development-plugin.action.test')?.props.disabled).toBe(true);
        expect(screen.findRow('settings.plugins.management.development.development-plugin.action.pack')?.props.disabled).toBe(true);
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
    });

    it('reports a projection failure instead of a disconnect and retries the projection from the notice', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: false,
            reason: 'error',
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        const notice = screen.findRow('settings.plugins.marketplace.readOnlySnapshot');
        expect(notice).toBeTruthy();
        expect(notice?.props.accessibilityLabel).not.toBe('settingsPlugins.readOnlySnapshot');
        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot-retry')).toBeTruthy();
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(1);

        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: { v: 1, agentsById: {}, backendsById: {} },
        });
        await act(async () => {
            screen.pressRow('settings.plugins.marketplace.readOnlySnapshot-retry');
            await flushAsync();
            await flushAsync();
        });

        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(2);
        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot')).toBeFalsy();
    });

    it('keeps direct marketplace administration RPCs available when only the merged projection fails', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [],
        });
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: false,
            reason: 'error',
        });

        const { PluginMarketplaceSourcesScreen } = await import('./PluginMarketplaceSourcesScreen');
        await renderSettingsView(React.createElement(PluginMarketplaceSourcesScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(machineMarketplaceSourceRegistryGetMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            serverId: 'server-a',
        }));
        expect(machineNpmRegistryProfilesGetMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            serverId: 'server-a',
        }));
    });

    it.each([
        ['Home', async () => (await import('./PluginSettingsHomeScreen')).PluginSettingsHomeScreen],
        ['Detail', async () => (await import('./detail/PluginDetailScreen')).PluginDetailScreen],
    ])('refreshes daemon-owned marketplace sources when the %s screen regains focus', async (_name, loadScreen) => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [],
        });
        screenFocusState.value = true;
        const Screen = await loadScreen() as unknown as React.ComponentType<{
            pluginId?: string;
            revision?: number;
        }>;
        const props = _name === 'Detail' ? { pluginId: 'missing-plugin', revision: 1 } : { revision: 1 };
        const screen = await renderSettingsView(React.createElement(Screen, props));
        await act(async () => { await flushAsync(); await flushAsync(); });
        expect(machineMarketplaceSourceRegistryGetMock).toHaveBeenCalledTimes(1);

        screenFocusState.value = false;
        screen.tree.update(React.createElement(Screen, { ...props, revision: 2 }));
        await act(async () => { await flushAsync(); });
        machineMarketplaceSourceRegistryGetMock.mockClear();

        screenFocusState.value = true;
        screen.tree.update(React.createElement(Screen, { ...props, revision: 3 }));
        await act(async () => { await flushAsync(); await flushAsync(); });

        expect(machineMarketplaceSourceRegistryGetMock).toHaveBeenCalledTimes(1);
        expect(machineMarketplaceSourceRegistryGetMock).toHaveBeenCalledWith('machine-1', { serverId: 'server-a' });
    });

    it('keeps direct marketplace administration disabled when the exact daemon target is unreachable', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        // Exact daemon reachability belongs to the machine-inventory owner,
        // not to the active server endpoint. Make the selected machine itself
        // offline so this exercises the same authority production dispatch
        // re-resolves immediately before issuing an administration RPC.
        machineAdministrationFixture.activeMachines[0]!.active = false;
        machineAdministrationFixture.activeMachines[0]!.activeAt = 0;

        const { PluginMarketplaceSourcesScreen } = await import('./PluginMarketplaceSourcesScreen');
        const screen = await renderSettingsView(React.createElement(PluginMarketplaceSourcesScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(machineMarketplaceSourceRegistryGetMock).not.toHaveBeenCalled();
        expect(machineNpmRegistryProfilesGetMock).not.toHaveBeenCalled();
        expect(screen.findRow('settings.plugins.sources.add')?.props.disabled).toBe(true);
    });

    it('keeps a loaded cached plugin snapshot read-only until same-version reconnect refreshes capabilities and projection', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
            rollbackAvailability: 'available',
        });
        const curatedMarketplaceRegistry: MarketplaceSourceRegistryV1 = {
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [{
                id: 'marketplace:curated',
                title: 'Curated Marketplace',
                sourceUrl: 'https://marketplace.example.test/catalog.json',
                enabled: true,
                origin: 'curated',
                addedAtMs: 1,
                updatedAtMs: 1,
            }],
        };
        const loadedCapabilitiesState = createMachineCapabilitiesState([installedPlugin]);
        const loadingCapabilitiesState = createMachineCapabilitiesLoadingState([installedPlugin]);
        const refresh = vi.fn();
        let initialCapabilityCacheKeySalt: unknown;
        let hasInitialCapabilityCacheKeySalt = false;
        let freshCapabilitiesReady = false;
        useMachineCapabilitiesCacheMock.mockImplementation((params: Readonly<{ cacheKeySalt?: unknown }>) => {
            if (!hasInitialCapabilityCacheKeySalt) {
                initialCapabilityCacheKeySalt = params.cacheKeySalt;
                hasInitialCapabilityCacheKeySalt = true;
            }
            const usesInitialCache = Object.is(params.cacheKeySalt, initialCapabilityCacheKeySalt);
            return {
                state: usesInitialCache || freshCapabilitiesReady
                    ? loadedCapabilitiesState
                    : loadingCapabilitiesState,
                refresh,
            };
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(curatedMarketplaceRegistry);
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([
            createMarketplaceCatalogEntry({
                pluginId: installedPlugin.pluginId,
                title: installedPlugin.title,
                version: '2.0.0',
            }),
        ]));
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: { ok: true, result: { ok: true } },
        });
        let projectionRequestCount = 0;
        let resolveReconnectProjection: (() => void) | null = null;
        machineContributionRegistryProjectionDescribeMock.mockImplementation(async () => {
            projectionRequestCount += 1;
            if (projectionRequestCount === 2) {
                await new Promise<void>((resolve) => {
                    resolveReconnectProjection = resolve;
                });
            }
            return {
                supported: true,
                projection: { v: 1, agentsById: {}, backendsById: {} },
            };
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const RerenderablePluginSettingsHomeScreen = PluginSettingsHomeScreen as unknown as React.ComponentType<{
            capabilityRevision: number;
        }>;
        const screen = await renderSettingsView(React.createElement(RerenderablePluginSettingsHomeScreen, {
            capabilityRevision: 1,
        }));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot')).toBeFalsy();
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(1);
        const staleOnlineDisable = screen.findAllByType('ItemRowActions' as any)
            .find((node) => node.props.title === 'Installed Plugin')
            ?.props.actions
            ?.find((action: Readonly<{ id: string }>) => action.id === 'disable')
            ?.onPress as (() => void);

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:discover');
            await flushAsync();
            await flushAsync();
        });
        expect(screen.findByTestId('settings.plugins.management.view:discover')?.props.accessibilityState).toMatchObject({ selected: true });
        // Entering Discover auto-loads the aggregate page; a listing for
        // something already installed gets NO lifecycle action row here.
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
        expect(screen.findRow(discoverListingTestID('installed-plugin'))).toBeTruthy();
        expect(findDiscoverListingActions(screen, 'installed-plugin').map((action) => action.id)).toEqual(['manage']);
        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:installed');
        });

        machineMarketplaceSourceRegistryGetMock.mockClear();
        machineMarketplaceIndexQueryMock.mockClear();
        const selectedMachine = machineAdministrationFixture.activeMachines[0];
        if (!selectedMachine) throw new Error('Expected the selected machine fixture.');
        // Execution authority comes from the selected machine's live presence,
        // not the active endpoint status. Retire this exact target while
        // retaining its selected scope, then restore it below to exercise the
        // reconnect freshness transition.
        selectedMachine.active = false;
        selectedMachine.activeAt = 0;
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginSettingsHomeScreen, {
                capabilityRevision: 2,
            }));
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.marketplace.installed.installed-plugin')).toBeTruthy();
        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot')).toBeTruthy();
        expect(screen.findByTestId('settings.plugins.management.view:installed')?.props.accessibilityState).toMatchObject({ selected: true });

        const disconnectedActions = screen.findAllByType('ItemRowActions' as any)
            .find((node) => node.props.title === 'Installed Plugin')
            ?.props.actions as readonly Readonly<{ id: string; disabled: boolean; onPress: () => void }>[] | undefined;
        expect(disconnectedActions?.find((action) => action.id === 'reload')).toBeUndefined();
        expect(disconnectedActions?.find((action) => action.id === 'disable')?.disabled).toBe(true);

        await act(async () => {
            disconnectedActions?.find((action) => action.id === 'disable')?.onPress();
            staleOnlineDisable();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
        expect(machineMarketplaceIndexQueryMock).not.toHaveBeenCalled();
        expect(machineMarketplaceSourceRegistryGetMock).not.toHaveBeenCalled();
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(1);

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const detailScreen = await renderSettingsView(React.createElement(PluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
        }));
        await act(async () => {
            await flushAsync();
        });

        expect(detailScreen.findRow('settings.plugins.detail.readOnlySnapshot')).toBeTruthy();
        expect(detailScreen.findRow('settings.plugins.detail.installed-plugin.action.reload')).toBeFalsy();
        expect(detailScreen.findRow('settings.plugins.detail.installed-plugin.action.disable')?.props.disabled).toBe(true);
        expect(detailScreen.findRow('settings.plugins.detail.installed-plugin.action.rollback')?.props.disabled).toBe(true);
        expect(detailScreen.findRow('settings.plugins.detail.installed-plugin.action.uninstall')?.props.disabled).toBe(true);
        expect(detailScreen.findRow('settings.plugins.detail.installed-plugin.action.forgetTrust')?.props.disabled).toBe(true);
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();

        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:discover');
        });
        // While the snapshot is read-only, Discover makes no query of its own:
        // search stays non-editable, refresh is disabled, and the aggregate
        // query is neither issued nor repeated.
        expect(screen.findRow('settings.plugins.marketplace.search')?.props.editable).toBe(false);
        expect(screen.findRow('settings.plugins.marketplace.refreshDiscover')?.props.disabled).toBe(true);
        expect(machineMarketplaceIndexQueryMock).not.toHaveBeenCalled();

        selectedMachine.active = true;
        selectedMachine.activeAt = Date.now();
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginSettingsHomeScreen, {
                capabilityRevision: 3,
            }));
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.marketplace.installed.installed-plugin')).toBeFalsy();
        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot')).toBeTruthy();
        expect(screen.findByTestId('settings.plugins.management.view:discover')?.props.accessibilityState).toMatchObject({ selected: true });
        const reconnectCapabilityCacheKeySalt = useMachineCapabilitiesCacheMock.mock.calls.at(-1)?.[0]?.cacheKeySalt;
        expect(reconnectCapabilityCacheKeySalt).not.toBe(initialCapabilityCacheKeySalt);
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(2);

        freshCapabilitiesReady = true;
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginSettingsHomeScreen, {
                capabilityRevision: 4,
            }));
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot')).toBeTruthy();
        expect(screen.findRow('settings.plugins.marketplace.refreshDiscover')?.props.disabled).toBe(true);
        expect(machineMarketplaceIndexQueryMock).not.toHaveBeenCalled();

        await act(async () => {
            resolveReconnectProjection?.();
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.marketplace.readOnlySnapshot')).toBeFalsy();
        expect(screen.findByTestId('settings.plugins.management.view:discover')?.props.accessibilityState).toMatchObject({ selected: true });
        expect(screen.findRow('settings.plugins.marketplace.search')?.props.editable).toBe(true);
        // With daemon truth current again, Discover acquires the aggregate page
        // by itself — once — and the installed listing still gets no lifecycle
        // row; update belongs to the installed record.
        expect(screen.findRow('settings.plugins.marketplace.refreshDiscover')?.props.disabled).toBe(false);
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            text: '',
            cursor: null,
            filters: { includeUnavailable: true },
        }), expect.any(Object));
        expect(findDiscoverListingActions(screen, 'installed-plugin').map((action) => action.id)).toEqual(['manage']);
        await act(async () => {
            screen.pressByTestId('settings.plugins.management.view:installed');
        });
        const reconnectedActions = screen.findAllByType('ItemRowActions' as any)
            .find((node) => node.props.title === 'Installed Plugin')
            ?.props.actions as readonly Readonly<{ id: string; disabled: boolean }>[] | undefined;
        expect(reconnectedActions?.find((action) => action.id === 'reload')).toBeUndefined();
        expect(reconnectedActions?.find((action) => action.id === 'disable')?.disabled).toBe(false);
        // Update is offered from the installed record itself once the daemon is
        // current again — never re-created as a Discover-row action.
        expect(reconnectedActions?.find((action) => action.id === 'update')?.disabled).toBe(false);
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(2);
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledWith('machine-1', {
            serverId: 'server-a',
            timeoutMs: 10_000,
        });
    });

    it('navigates installed plugin rows to a detail route instead of inlining plugin details on the home screen', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 12,
                installedPackagesById: {
                    'installed-plugin': {
                        id: 'installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                diagnostics: [],
            },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.marketplace.installed.installed-plugin')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.installed-plugin.status')).toBeFalsy();

        await act(async () => {
            screen.pressRow('settings.plugins.marketplace.installed.installed-plugin');
        });

        expect(routerPushSpy).toHaveBeenCalledWith({
            pathname: '/(app)/settings/plugins/[pluginId]',
            params: { pluginId: 'installed-plugin' },
        });
    });

    it('renders host-projected plugin details, diagnostics, and only supported mutation actions', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'com.acme.installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
            rollbackAvailability: 'available',
            diagnostics: [{ code: 'install.note', message: 'Installed via host-owned flow' }],
        });
        const refresh = vi.fn();
        const capabilityState = createMachineCapabilitiesState([installedPlugin]);
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: capabilityState,
            refresh,
        });
        getMachineCapabilitiesCacheStateMock.mockReturnValue(capabilityState);
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 12,
                installedPackagesById: {
                    'com.acme.installed-plugin': {
                        id: 'com.acme.installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {
                    'com.acme.installed-plugin.refresh': {
                        id: 'com.acme.installed-plugin.refresh',
                        pluginId: 'com.acme.installed-plugin',
                        title: 'Refresh installed plugin',
                        description: 'Refresh plugin-owned resources',
                        scopes: ['settings'],
                        surfaces: ['ui'],
                        execution: { target: 'daemon' },
                        placementBindings: ['detailsPanel'],
                        dangerLevel: 'safe',
                        available: true,
                    },
                    'com.acme.installed-plugin.runSetup': {
                        id: 'com.acme.installed-plugin.runSetup',
                        pluginId: 'com.acme.installed-plugin',
                        title: 'Run setup',
                        description: 'Run plugin setup',
                        scopes: ['settings'],
                        surfaces: ['ui'],
                        execution: { target: 'daemon' },
                        placementBindings: ['detailsPanel'],
                        dangerLevel: 'safe',
                        available: true,
                    },
                },
                toolsById: {},
                commandsById: {},
                resourcesById: {
                    'com.acme.installed-plugin.prompt': {
                        id: 'com.acme.installed-plugin.prompt',
                        pluginId: 'com.acme.installed-plugin',
                        resourceKind: 'prompt',
                        path: 'resources/review.md',
                        digest: 'sha256:prompt',
                        contentType: 'text/markdown',
                    },
                },
                diagnostics: [
                    createPluginDiagnosticRecord({
                        id: 'com.acme.installed-plugin:normalization:warning:0',
                        pluginId: 'com.acme.installed-plugin',
                        severity: 'warning',
                        code: 'registry.warning',
                        message: 'Registry rebuilt with warnings',
                    }),
                    createPluginDiagnosticRecord({
                        id: 'com.acme.installed-plugin:activation:info:0',
                        pluginId: 'com.acme.installed-plugin',
                        severity: 'info',
                        code: 'plugin.activated',
                        message: 'Plugin activated',
                    }),
                ],
            },
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: { ok: true, result: { ok: true } },
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, { pluginId: 'com.acme.installed-plugin' }));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            serverId: 'server-a',
        }));
        expect(navigationSetOptionsSpy).toHaveBeenCalledWith(expect.objectContaining({
            headerTitle: 'Installed Plugin',
        }));
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.header')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.summary')).toBeTruthy();
        expect(screen.getTextContent()).toContain('trusted');
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.contribution.action.com.acme.installed-plugin.refresh')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.contribution.resource.com.acme.installed-plugin.prompt')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.action.reload')).toBeFalsy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.action.disable')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.action.rollback')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.action.uninstall')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.action.forgetTrust')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Plugin activated');
        expect(screen.getTextContent()).toContain('Registry rebuilt with warnings');
        await act(async () => {
            screen.pressRow('settings.plugins.detail.com.acme.installed-plugin.action.disable');
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: expect.objectContaining({
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'disable',
                params: expect.objectContaining({ pluginId: 'com.acme.installed-plugin' }),
            }),
        }));
        expect(refresh).toHaveBeenCalledWith({ bypassCache: true });
        expect(publishMachineContributionRegistryProjectionInvalidationMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-a',
        });
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['missing', undefined],
        ['unavailable', 'unavailable' as const],
    ])('does not advertise rollback when host-private byte verification is %s', async (_label, rollbackAvailability) => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            rollbackAvailability,
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
        }));
        await act(async () => {
            await flushAsync();
        });

        expect(screen.findRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.rollback`)).toBeFalsy();
        expect(screen.findRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.uninstall`)).toBeTruthy();
        expect(screen.findRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.forgetTrust`)).toBeTruthy();
    });

    it('rejects a stale rollback control after the daemon withdraws byte-verified availability', async () => {
        let rollbackAvailability: InstalledPluginEntry['rollbackAvailability'] = 'available';
        useMachineCapabilitiesCacheMock.mockImplementation(() => ({
            state: createMachineCapabilitiesState([
                createInstalledPlugin({
                    pluginId: 'installed-plugin',
                    title: 'Installed Plugin',
                    version: '1.0.0',
                    rollbackAvailability,
                }),
            ]),
            refresh: vi.fn(),
        }));

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const RerenderablePluginDetailScreen = PluginDetailScreen as unknown as React.ComponentType<{
            pluginId: string;
            capabilityRevision: number;
        }>;
        const screen = await renderSettingsView(React.createElement(RerenderablePluginDetailScreen, {
            pluginId: 'installed-plugin',
            capabilityRevision: 1,
        }));
        await act(async () => {
            await flushAsync();
        });
        const staleRollbackPress = screen.findRow(
            'settings.plugins.detail.installed-plugin.action.rollback',
        )?.props.onPress as (() => void) | undefined;
        expect(staleRollbackPress).toBeTypeOf('function');

        rollbackAvailability = 'unavailable';
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginDetailScreen, {
                pluginId: 'installed-plugin',
                capabilityRevision: 2,
            }));
            await flushAsync();
        });
        expect(screen.findRow('settings.plugins.detail.installed-plugin.action.rollback')).toBeFalsy();

        await act(async () => {
            staleRollbackPress?.();
            await flushAsync();
        });
        expect(modalConfirmMock).not.toHaveBeenCalled();
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
    });

    it.each([
        ['rollback', 'settingsPlugins.rollback'],
        ['uninstall', 'settingsPlugins.uninstall'],
        ['forgetTrust', 'settingsPlugins.forgetTrust'],
    ] as const)('confirms the destructive %s action and invokes only the private plugin capability', async (method, confirmationTitle) => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            rollbackAvailability: method === 'rollback' ? 'available' : 'unavailable',
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: method,
                    pluginId: installedPlugin.pluginId,
                    change: { kind: 'committed' },
                },
            },
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
        }));
        await act(async () => {
            await flushAsync();
        });

        modalConfirmMock.mockResolvedValueOnce(false);
        await act(async () => {
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.${method}`);
            await flushAsync();
        });
        // A plugin change lands on ONE machine reached through ONE server. The
        // confirmation must name that target: the same wording on a different
        // selected machine is a different, irreversible action.
        expect(modalConfirmMock).toHaveBeenCalledWith(
            confirmationTitle,
            `settingsPlugins.pluginChangeConfirmBody(action=${confirmationTitle},name=Installed Plugin,machine=machine-1,server=Server A)`,
            expect.objectContaining({
                confirmText: confirmationTitle,
                cancelText: 'common.cancel',
            }),
        );
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();

        modalConfirmMock.mockResolvedValueOnce(true);
        await act(async () => {
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.${method}`);
            await flushAsync();
        });
        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method,
                params: { pluginId: installedPlugin.pluginId },
            },
        }));
    });

    it('does not refresh plugin truth after a destructive lifecycle capability failure', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
        });
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh,
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: false,
                error: {
                    code: 'plugin-not-found',
                    message: 'Installed plugin was not found',
                },
            },
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
        }));
        await act(async () => {
            await flushAsync();
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.uninstall`);
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'uninstall',
                params: { pluginId: installedPlugin.pluginId },
            },
        }));
        expect(refresh).not.toHaveBeenCalled();
        expect(publishMachineContributionRegistryProjectionInvalidationMock).not.toHaveBeenCalled();
    });

    it.each([
        ['rollback', (entry: InstalledPluginEntry) => [{ ...entry, version: '0.9.0' }]],
        ['uninstall', () => []],
        ['forgetTrust', (entry: InstalledPluginEntry) => [{
            ...entry,
            enabled: false,
            source: { ...entry.source, trustPolicy: 'untrusted' },
        }]],
    ] as const)(
        'reconciles an outcome-unknown %s from authoritative installed truth without replaying the mutation',
        async (method, createInstalledAfter) => {
            const installedPlugin = createInstalledPlugin({
                pluginId: 'installed-plugin',
                title: 'Installed Plugin',
                version: '1.0.0',
                rollbackAvailability: method === 'rollback' ? 'available' : 'unavailable',
            });
            const initialState = createMachineCapabilitiesState([installedPlugin]);
            let authoritativeState: MachineCapabilitiesState = initialState;
            useMachineCapabilitiesCacheMock.mockReturnValue({
                state: initialState,
                refresh: vi.fn(),
            });
            getMachineCapabilitiesCacheStateMock.mockImplementation(() => authoritativeState);
            prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
                authoritativeState = createMachineCapabilitiesState(createInstalledAfter(installedPlugin));
            });
            invokeWithAlertsMock.mockResolvedValueOnce({
                supported: true,
                response: {
                    ok: false,
                    error: {
                        code: 'outcomeUnknown',
                        message: 'The daemon may have committed the requested mutation',
                    },
                },
            });

            const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
            const screen = await renderSettingsView(React.createElement(PluginDetailScreen, {
                pluginId: installedPlugin.pluginId,
            }));
            await act(async () => {
                await flushAsync();
                screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.${method}`);
                await flushAsync();
                await flushAsync();
            });

            expect(invokeWithAlertsMock).toHaveBeenCalledTimes(1);
            expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledWith(expect.objectContaining({
                machineId: 'machine-1',
                serverId: 'server-a',
                request: expect.objectContaining({
                    bypassCache: true,
                    requests: [{ id: MARKETPLACE_CAPABILITY_ID }],
                }),
            }));
            expect(publishMachineContributionRegistryProjectionInvalidationMock).toHaveBeenCalledWith({
                machineId: 'machine-1',
                serverId: 'server-a',
            });
            expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'common.done');
        },
    );

    it('reconciles commit-intended transport loss from authoritative truth without retrying uninstall', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
        });
        const initialState = createMachineCapabilitiesState([installedPlugin]);
        let authoritativeState: MachineCapabilitiesState = initialState;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: initialState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockImplementation(() => authoritativeState);
        prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
            authoritativeState = createMachineCapabilitiesState([]);
        });
        invokeWithAlertsMock.mockResolvedValueOnce({ supported: false, reason: 'error' });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
        }));
        await act(async () => {
            await flushAsync();
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.uninstall`);
            await flushAsync();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledTimes(1);
        expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledTimes(1);
        expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'common.done');
    });

    it('does not interpret a missing authoritative snapshot as a committed uninstall', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
        });
        const initialState = createMachineCapabilitiesState([installedPlugin]);
        let authoritativeState: MachineCapabilitiesState = initialState;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: initialState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockImplementation(() => authoritativeState);
        prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
            authoritativeState = { status: 'not-supported' };
        });
        invokeWithAlertsMock.mockResolvedValueOnce({
            supported: true,
            response: {
                ok: false,
                error: {
                    code: 'outcomeUnknown',
                    message: 'The daemon may have committed the requested mutation',
                },
            },
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
        }));
        await act(async () => {
            await flushAsync();
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.uninstall`);
            await flushAsync();
            await flushAsync();
        });

        expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledTimes(1);
        expect(modalAlertMock).not.toHaveBeenCalledWith('common.success', 'common.done');
        // Reconciliation could not read authoritative truth, so the uninstall
        // may already have landed. Reporting a definite failure here invites a
        // retry of a change that is not necessarily outstanding.
        expect(modalAlertMock).not.toHaveBeenCalledWith(
            'common.error',
            'settingsPlugins.marketplaceChangeDecisionFailed',
        );
        expect(modalAlertMock).toHaveBeenCalledWith(
            'settingsPlugins.pluginChangeOutcomeUnknownTitle',
            'settingsPlugins.pluginChangeOutcomeUnknownBody(action=settingsPlugins.uninstall,name=Installed Plugin,machine=machine-1,server=Server A)',
        );
        expect(publishMachineContributionRegistryProjectionInvalidationMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-a',
        });
    });

    it('does not apply an ambiguous mutation reconciliation after the machine authority changes', async () => {
        const refreshStarted = createDeferred();
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
        });
        let machineOneState: MachineCapabilitiesState = createMachineCapabilitiesState([installedPlugin]);
        const machineTwoState = createMachineCapabilitiesState([installedPlugin]);
        useMachineCapabilitiesCacheMock.mockImplementation(({ machineId }: Readonly<{ machineId: string | null }>) => ({
            state: machineId === 'machine-1' ? machineOneState : machineTwoState,
            refresh: vi.fn(),
        }));
        getMachineCapabilitiesCacheStateMock.mockImplementation((machineId: string) => (
            machineId === 'machine-1' ? machineOneState : machineTwoState
        ));
        prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
            await refreshStarted.promise;
            machineOneState = createMachineCapabilitiesState([]);
        });
        invokeWithAlertsMock.mockResolvedValueOnce({
            supported: true,
            response: {
                ok: false,
                error: {
                    code: 'outcomeUnknown',
                    message: 'The daemon may have committed the requested mutation',
                },
            },
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const RerenderablePluginDetailScreen = PluginDetailScreen as unknown as React.ComponentType<{
            pluginId: string;
            scopeToken: string;
        }>;
        const screen = await renderSettingsView(React.createElement(RerenderablePluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
            scopeToken: 'machine-1',
        }));
        await act(async () => {
            await flushAsync();
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.uninstall`);
            await flushAsync();
        });
        expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledTimes(1);

        setMachineAdministrationTargetFixture({
            serverIdentityId: 'srv_identity-b',
            serverId: 'server-b',
            machineId: 'machine-2',
        });
        getActiveServerIdMock.mockReturnValue('server-b');
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginDetailScreen, {
                pluginId: installedPlugin.pluginId,
                scopeToken: 'machine-2',
            }));
            await flushAsync();
        });

        refreshStarted.resolve();
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledTimes(1);
        expect(modalAlertMock).not.toHaveBeenCalledWith('common.success', 'common.done');
        expect(publishMachineContributionRegistryProjectionInvalidationMock).not.toHaveBeenCalled();
    });

    it('renders and edits hooks-only generic plugin settings from settingsById without leaking redacted values', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'acme.hooks',
            title: 'Acme hooks',
            version: '1.0.0',
            enabled: true,
        });
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh,
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 21,
                installedPackagesById: {
                    'acme.hooks': {
                        id: 'acme.hooks',
                        displayName: 'Acme hooks',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/acme.hooks',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                settingsById: {
                    'acme.hooks.settings': {
                        id: 'acme.hooks.settings',
                        pluginId: 'acme.hooks',
                        version: 1,
                        title: 'Hooks settings',
                        scope: { kind: 'daemon' },
                        target: { kind: 'plugin' },
                        presentation: { sections: [], subagentSections: [] },
                        fields: [
                            {
                                id: 'endpoint',
                                kind: 'settings.field',
                                version: '1.0.0',
                                valueSchema: { type: 'string' },
                                valueType: 'string',
                                control: 'text',
                                displayKey: 'Endpoint URL',
                                descriptionKey: 'Used when hook handlers call the remote API.',
                                capabilityGates: [],
                                permissionGates: [],
                                secretCustody: null,
                                redaction: 'none',
                                clearWhenEmpty: 'persist',
                                order: 1,
                            },
                            {
                                id: 'apiToken',
                                kind: 'settings.field',
                                version: '1.0.0',
                                valueSchema: { type: 'string' },
                                valueType: 'string',
                                control: 'password',
                                displayKey: 'API token',
                                descriptionKey: 'Stored locally for this plugin.',
                                capabilityGates: [],
                                permissionGates: [],
                                secretCustody: 'daemon',
                                redaction: 'secret',
                                clearWhenEmpty: 'omit',
                                order: 2,
                            },
                            {
                                id: 'enabled',
                                kind: 'settings.field',
                                version: '1.0.0',
                                valueSchema: { type: 'boolean' },
                                valueType: 'boolean',
                                control: 'switch',
                                displayKey: 'Enable hooks',
                                capabilityGates: [],
                                permissionGates: [],
                                secretCustody: null,
                                redaction: 'none',
                                clearWhenEmpty: 'persist',
                                defaultBooleanValue: true,
                                order: 3,
                            },
                            {
                                id: 'notes',
                                kind: 'settings.field',
                                version: '1.0.0',
                                valueSchema: { type: 'string' },
                                valueType: 'string',
                                control: 'textarea',
                                displayKey: 'Notes',
                                capabilityGates: [],
                                permissionGates: [],
                                secretCustody: null,
                                redaction: 'none',
                                clearWhenEmpty: 'persist',
                                order: 4,
                            },
                        ],
                    },
                },
                diagnostics: [
                    createPluginDiagnosticRecord({
                        id: 'acme.hooks:normalization:settings-field-duplicate:0',
                        pluginId: 'acme.hooks',
                        severity: 'error',
                        code: 'settings_field_duplicate',
                        message: 'Duplicate settings field rejected for acme.hooks.',
                    }),
                ],
            },
        });

        let currentValues: Record<string, unknown> = {
            endpoint: 'https://api.example.test',
            apiToken: 'raw-secret-token',
            enabled: true,
            notes: 'Persisted note',
        };
        let currentRevision = 0;
        machineRpcWithServerScopeMock.mockImplementation(async (input: Readonly<{
            method?: string;
            payload?: Readonly<{
                fieldId?: string;
                mutation?: Readonly<{ kind: 'set'; value: unknown }> | Readonly<{ kind: 'delete' }>;
                pluginId?: string;
                secretId?: string;
            }>;
        }>) => {
            if (input.method === 'daemon.plugins.settings.get') {
                return {
                    protocolVersion: 1,
                    pluginId: 'acme.hooks',
                    scope: { kind: 'daemon' },
                    revision: String(currentRevision),
                    values: currentValues,
                    redactedKeys: ['apiToken'],
                };
            }
            if (input.method === 'daemon.plugins.settings.set') {
                const mutation = input.payload?.mutation;
                if (!mutation || mutation.kind !== 'set') {
                    throw new Error('Expected a canonical Settings set mutation.');
                }
                currentValues = {
                    ...currentValues,
                    [String(input.payload?.fieldId)]: mutation.value,
                };
                currentRevision += 1;
                return {
                    protocolVersion: 1,
                    pluginId: 'acme.hooks',
                    scope: { kind: 'daemon' },
                    revision: String(currentRevision),
                    values: currentValues,
                    redactedKeys: ['apiToken'],
                };
            }
            if (input.method === 'daemon.plugins.secrets.status') {
                return {
                    protocolVersion: 1,
                    pluginId: input.payload?.pluginId ?? 'acme.hooks',
                    secretId: input.payload?.secretId ?? 'apiToken',
                    state: 'configured',
                    revision: 'secret-0',
                };
            }
            if (input.method === 'daemon.plugins.secrets.set') {
                return {
                    protocolVersion: 1,
                    pluginId: input.payload?.pluginId ?? 'acme.hooks',
                    secretId: input.payload?.secretId ?? 'apiToken',
                    state: 'configured',
                    revision: 'secret-1',
                };
            }
            throw new Error(`Unexpected RPC method: ${input.method ?? '<missing>'}`);
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, { pluginId: 'acme.hooks' }));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.endpoint.input')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.apiToken.input')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.enabled')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.notes.input')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Duplicate settings field rejected for acme.hooks.');
        expect(screen.getTextContent()).not.toContain('raw-secret-token');

        const endpointInput = screen.findRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.endpoint.input');
        const tokenInput = screen.findRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.apiToken.input');
        const notesInput = screen.findRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.notes.input');
        expect(endpointInput?.props.value).toBe('https://api.example.test');
        expect(tokenInput?.props.value).toBe('');
        expect(tokenInput?.props.secureTextEntry).toBe(true);
        expect(notesInput?.props.multiline).toBe(true);
        expect(notesInput?.props.value).toBe('Persisted note');

        await act(async () => {
            endpointInput?.props.onChangeText('https://api.changed.test');
            await flushAsync();
        });
        expect(machineRpcWithServerScopeMock.mock.calls
            .map(([input]) => input as { method?: string })
            .filter((input) => input.method === 'daemon.plugins.settings.set')).toHaveLength(0);
        await act(async () => {
            screen.pressRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.endpoint.save');
            await flushAsync();
        });
        await act(async () => {
            screen.pressRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.enabled');
            await flushAsync();
        });
        await act(async () => {
            tokenInput?.props.onChangeText('new-secret-token');
            await flushAsync();
        });
        expect(machineRpcWithServerScopeMock.mock.calls
            .map(([input]) => input as { method?: string })
            .filter((input) => input.method === 'daemon.plugins.settings.set')).toHaveLength(2);
        await act(async () => {
            screen.pressRow('settings.plugins.detail.acme.hooks.settings.acme.hooks.settings.apiToken.save');
            await flushAsync();
        });

        const setCalls = machineRpcWithServerScopeMock.mock.calls
            .map(([input]) => input as { method?: string; payload?: Record<string, unknown> })
            .filter((input) => input.method === 'daemon.plugins.settings.set');
        expect(setCalls.map((call) => call.payload)).toEqual([
            {
                serverIdentityId: 'srv_identity-a',
                machineId: 'machine-1',
                pluginId: 'acme.hooks',
                scope: { kind: 'daemon' },
                fieldId: 'endpoint',
                mutation: { kind: 'set', value: 'https://api.changed.test' },
                expectedRevision: '0',
            },
            {
                serverIdentityId: 'srv_identity-a',
                machineId: 'machine-1',
                pluginId: 'acme.hooks',
                scope: { kind: 'daemon' },
                fieldId: 'enabled',
                mutation: { kind: 'set', value: false },
                expectedRevision: '1',
            },
        ]);
        expect(machineRpcWithServerScopeMock.mock.calls
            .map(([input]) => input as { method?: string; payload?: Record<string, unknown> })
            .filter((input) => input.method === 'daemon.plugins.secrets.set')
            .map((call) => call.payload)).toEqual([{
                serverIdentityId: 'srv_identity-a',
                machineId: 'machine-1',
                pluginId: 'acme.hooks',
                secretId: 'apiToken',
                value: 'new-secret-token',
                expectedRevision: 'secret-0',
            }]);
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain('raw-secret-token');
        expect(JSON.stringify(screen.tree.toJSON())).not.toContain('new-secret-token');
    });

    it('keeps projected plugin details visible on the detail screen while installed inventory refreshes', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: {
                status: 'loading',
                snapshot: createMachineCapabilitiesState([installedPlugin]).snapshot,
            },
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 12,
                installedPackagesById: {
                    'installed-plugin': {
                        id: 'installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                diagnostics: [],
            },
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, { pluginId: 'installed-plugin' }));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.detail.installed-plugin.header')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.installed-plugin.summary')).toBeTruthy();
    });

    it('reuses the shared daemon projection cache on the detail screen when the scoped projection is already warm', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([
                createInstalledPlugin({
                    pluginId: 'installed-plugin',
                    title: 'Installed Plugin',
                    version: '1.0.0',
                }),
            ]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 7,
                installedPackagesById: {
                    'installed-plugin': {
                        id: 'installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                diagnostics: [],
            },
        });

        await loadDaemonMergedProjectionCacheEntry({
            machineId: 'machine-1',
            serverId: 'server-a',
        });

        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(1);

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, { pluginId: 'installed-plugin' }));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.detail.installed-plugin.summary')).toBeTruthy();
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledTimes(1);
    });

    it('clears machine-scoped projection and Discover query state when the selected machine changes', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
        });
        const curatedMarketplaceRegistry = {
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [
                {
                    id: 'marketplace:curated-default',
                    title: 'Happier curated marketplace',
                    sourceUrl: 'https://marketplace.example.test/catalog.json',
                    enabled: true,
                    origin: 'curated' as const,
                    description: 'Official curated source',
                    addedAtMs: 1,
                    updatedAtMs: 1,
                },
            ],
        };

        getActiveServerIdMock.mockReturnValue('server-a');
        const machineOneCapabilityState = createMachineCapabilitiesState([installedPlugin]);
        const machineTwoCapabilityState = createMachineCapabilitiesState([installedPlugin]);
        useMachineCapabilitiesCacheMock.mockImplementation(({ machineId }: { machineId: string | null }) => ({
            state: machineId === 'machine-1' ? machineOneCapabilityState : machineTwoCapabilityState,
            refresh: vi.fn(),
        }));
        getMachineCapabilitiesCacheStateMock.mockImplementation((machineId: string) => (
            machineId === 'machine-1' ? machineOneCapabilityState : machineTwoCapabilityState
        ));
        machineMarketplaceSourceRegistryGetMock.mockImplementation(async (machineId: string) => (
            machineId === 'machine-1' ? curatedMarketplaceRegistry : null
        ));
        machineMarketplaceIndexQueryMock.mockImplementation(async (machineId: string) => (
            machineId === 'machine-1'
                ? createDaemonMarketplaceIndexResult([
                    createMarketplaceCatalogEntry({ pluginId: 'sample-plugin', title: 'Sample Plugin', description: 'Descriptor served for machine-1', version: '1.0.0' }),
                ])
                : createDaemonMarketplaceIndexResult([])
        ));
        machineContributionRegistryProjectionDescribeMock.mockImplementation(async (machineId: string) => (
            machineId === 'machine-1'
                ? {
                    supported: true,
                    projection: {
                        v: 2,
                        generation: 12,
                        installedPackagesById: {
                            'installed-plugin': {
                                id: 'installed-plugin',
                                displayName: 'Installed Plugin',
                                version: '1.0.0',
                                enabled: true,
                                source: {
                                    kind: 'path',
                                    locator: '/plugins/installed-plugin',
                                },
                            },
                        },
                        agentsById: {},
                        backendsById: {},
                        actionsById: {},
                        toolsById: {},
                        commandsById: {},
                        resourcesById: {},
                        diagnostics: [],
                    },
                }
                : {
                    supported: false,
                }
        ));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const RerenderablePluginSettingsHomeScreen = PluginSettingsHomeScreen as unknown as React.ComponentType<{
            scopeToken: string;
        }>;
        const screen = await renderSettingsView(React.createElement(RerenderablePluginSettingsHomeScreen, {
            scopeToken: 'machine-1',
        }));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        await selectPluginManagementView(screen, 'discover');

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        // Discover acquired the aggregate page for machine-1 and shows it.
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledWith('machine-1', expect.anything(), expect.any(Object));
        expect(screen.findRow(discoverListingTestID('sample-plugin'))).toBeTruthy();
        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledWith('machine-1', {
            serverId: 'server-a',
            timeoutMs: 10_000,
        });

        setMachineAdministrationTargetFixture({
            serverIdentityId: 'srv_identity-b',
            serverId: 'server-b',
            machineId: 'machine-2',
        });
        getActiveServerIdMock.mockReturnValue('server-b');

        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginSettingsHomeScreen, {
                scopeToken: 'machine-2',
            }));
            await flushAsync();
            await flushAsync();
        });

        expect(machineContributionRegistryProjectionDescribeMock).toHaveBeenCalledWith('machine-2', {
            serverId: 'server-b',
            timeoutMs: 10_000,
        });
        // The machine-1 Discover page and its controls are cleared, never shown
        // as machine-2 truth; machine-2's projection is unsupported, so no new
        // aggregate query is issued and the stale listing is gone.
        expect(screen.findRow(discoverListingTestID('sample-plugin'))).toBeFalsy();
        expect(screen.findRow('settings.plugins.marketplace.search')?.props.value).toBe('');
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
    });

    it('fences a late destructive lifecycle response from the previously selected machine authority', async () => {
        const machineOneAction = createDeferred();
        const machineTwoAction = createDeferred();
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
            rollbackAvailability: 'available',
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        invokeWithAlertsMock.mockImplementation(async ({ machineId }: Readonly<{ machineId: string }>) => {
            await (machineId === 'machine-1' ? machineOneAction.promise : machineTwoAction.promise);
            return {
                supported: true,
                response: {
                    ok: true,
                    result: {
                        action: 'rollback',
                        pluginId: installedPlugin.pluginId,
                        change: { kind: 'committed' },
                    },
                },
            };
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const RerenderablePluginDetailScreen = PluginDetailScreen as unknown as React.ComponentType<{
            pluginId: string;
            scopeToken: string;
        }>;
        const screen = await renderSettingsView(React.createElement(RerenderablePluginDetailScreen, {
            pluginId: installedPlugin.pluginId,
            scopeToken: 'machine-1',
        }));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        const findRollbackAction = () => screen.findRow(
            `settings.plugins.detail.${installedPlugin.pluginId}.action.rollback`,
        );

        await act(async () => {
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.rollback`);
            await flushAsync();
        });
        expect(findRollbackAction()?.props.disabled).toBe(true);

        setMachineAdministrationTargetFixture({
            serverIdentityId: 'srv_identity-b',
            serverId: 'server-b',
            machineId: 'machine-2',
        });
        getActiveServerIdMock.mockReturnValue('server-b');
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginDetailScreen, {
                pluginId: installedPlugin.pluginId,
                scopeToken: 'machine-2',
            }));
            await flushAsync();
            await flushAsync();
        });

        expect(findRollbackAction()?.props.disabled).not.toBe(true);
        await act(async () => {
            screen.pressRow(`settings.plugins.detail.${installedPlugin.pluginId}.action.rollback`);
            await flushAsync();
        });
        expect(findRollbackAction()?.props.disabled).toBe(true);

        machineOneAction.resolve();
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        expect(findRollbackAction()?.props.disabled).toBe(true);

        machineTwoAction.resolve();
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        expect(findRollbackAction()?.props.disabled).not.toBe(true);
    });

    it('deduplicates repeated same-plugin mutations before the busy state rerenders', async () => {
        const action = createDeferred();
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        invokeWithAlertsMock.mockImplementation(async () => {
            await action.promise;
            return {
                supported: true,
                response: { ok: true, result: { ok: true } },
            };
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        const findDisableAction = () => screen.findAllByType('ItemRowActions' as any)
            .find((node) => node.props.title === 'Installed Plugin')
            ?.props.actions
            ?.find((action: Readonly<{ id: string }>) => action.id === 'disable') as
            | Readonly<{ disabled: boolean; onPress: () => void }>
            | undefined;
        const actionBeforeBusyRender = findDisableAction();

        act(() => {
            actionBeforeBusyRender?.onPress();
            actionBeforeBusyRender?.onPress();
        });
        expect(invokeWithAlertsMock).toHaveBeenCalledTimes(1);
        expect(findDisableAction()?.disabled).toBe(true);

        action.resolve();
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        expect(findDisableAction()?.disabled).toBe(false);
    });

    it('drops an in-flight projection response when the selected machine becomes unavailable', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
        });
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh,
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);

        let resolveProjection!: (value: Readonly<{
            supported: true;
            projection: Readonly<{
                v: 2;
                generation: number;
                installedPackagesById: Readonly<Record<string, Readonly<{
                    id: string;
                    displayName: string;
                    version: string | null;
                    enabled: boolean | null;
                    source: Readonly<{
                        kind: string;
                        locator: string;
                    }>;
                }>>>;
                agentsById: Record<string, never>;
                backendsById: Record<string, never>;
                actionsById: Record<string, never>;
                toolsById: Record<string, never>;
                commandsById: Record<string, never>;
                resourcesById: Record<string, never>;
                diagnostics: readonly [];
            }>;
        }>) => void;
        const projectionPromise = new Promise<Parameters<typeof resolveProjection>[0]>((resolve) => {
            resolveProjection = resolve;
        });
        machineContributionRegistryProjectionDescribeMock.mockImplementation(async (machineId: string) => {
            if (machineId === 'machine-1') {
                return await projectionPromise;
            }
            return { supported: false };
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const RerenderablePluginSettingsHomeScreen = PluginSettingsHomeScreen as unknown as React.ComponentType<{
            scopeToken: string;
        }>;
        const screen = await renderSettingsView(React.createElement(RerenderablePluginSettingsHomeScreen, {
            scopeToken: 'machine-1',
        }));

        await act(async () => {
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.detail.installed-plugin.generation')).toBeFalsy();

        clearMachineAdministrationTargetFixture();
        await act(async () => {
            screen.tree.update(React.createElement(RerenderablePluginSettingsHomeScreen, {
                scopeToken: 'machine-none',
            }));
            await flushAsync();
        });

        resolveProjection({
            supported: true,
            projection: {
                v: 2,
                generation: 12,
                installedPackagesById: {
                    'installed-plugin': {
                        id: 'installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                diagnostics: [],
            },
        });

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.detail.installed-plugin.generation')).toBeFalsy();
    });

    it('renders duplicate plugin diagnostic codes with stable unique rows', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'com.acme.installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: true,
        });
        const capabilityState = createMachineCapabilitiesState([installedPlugin]);
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: capabilityState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockReturnValue(capabilityState);
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 12,
                installedPackagesById: {
                    'com.acme.installed-plugin': {
                        id: 'com.acme.installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                diagnostics: [
                    createPluginDiagnosticRecord({
                        id: 'com.acme.installed-plugin:normalization:capability-missing:0',
                        pluginId: 'com.acme.installed-plugin',
                        severity: 'warning',
                        code: 'plugin_runtime_capability_missing',
                        message: 'Missing actions capability',
                    }),
                    createPluginDiagnosticRecord({
                        id: 'com.acme.installed-plugin:normalization:capability-missing:1',
                        pluginId: 'com.acme.installed-plugin',
                        severity: 'warning',
                        code: 'plugin_runtime_capability_missing',
                        message: 'Missing resources capability',
                    }),
                ],
            },
        });

        const { PluginDetailScreen } = await import('./detail/PluginDetailScreen');
        const screen = await renderSettingsView(React.createElement(PluginDetailScreen, {
            pluginId: 'com.acme.installed-plugin',
        }));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.diagnostic.plugin_runtime_capability_missing.0')).toBeTruthy();
        expect(screen.findRow('settings.plugins.detail.com.acme.installed-plugin.diagnostic.plugin_runtime_capability_missing.1')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Missing actions capability');
        expect(screen.getTextContent()).toContain('Missing resources capability');
    });

    it('queries the aggregate daemon index for Discover and preserves the machine-installed inventory', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'installed-plugin',
            title: 'Installed Plugin',
            version: '1.0.0',
            enabled: false,
            source: {
                kind: 'catalog',
                locator: 'https://marketplace.example.test/catalog.json',
                trustPolicy: 'trusted',
                installPolicy: 'allow',
                resolvedPath: '/plugins/installed-plugin',
            },
            compatibility: {
                status: 'incompatible',
                diagnostics: [{ code: 'compatibility', message: 'Requires a newer runtime' }],
            },
            diagnostics: [{ code: 'provenance', message: 'Installed via host-owned flow' }],
        });
        const curatedMarketplaceRegistry = {
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [
                {
                    id: 'marketplace:curated-default',
                    title: 'Happier curated marketplace',
                    sourceUrl: 'https://marketplace.example.test/catalog.json',
                    enabled: true,
                    origin: 'curated' as const,
                    description: 'Official curated source',
                    addedAtMs: 1,
                    updatedAtMs: 1,
                },
            ],
        };

        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh,
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(curatedMarketplaceRegistry);
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([
            createMarketplaceCatalogEntry({ pluginId: 'installed-plugin', title: 'Installed Plugin', description: 'Descriptor for the installed plugin', version: '1.1.0' }),
            createMarketplaceCatalogEntry({ pluginId: 'new-plugin', title: 'New Plugin', description: null, version: '0.1.0' }),
        ]));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(useMachineCapabilitiesCacheMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            enabled: true,
            request: expect.objectContaining({
                requests: [{ id: MARKETPLACE_CAPABILITY_ID }],
            }),
        }));
        expect(machineMarketplaceSourceRegistryGetMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            serverId: 'server-a',
        }));

        const installedRow = screen.findRow('settings.plugins.marketplace.installed.installed-plugin');
        expect(installedRow).toBeTruthy();
        expect(screen.getTextContent()).toContain('common.disabled');
        expect(screen.getTextContent()).toContain('Installed via host-owned flow');
        expect(screen.getTextContent()).toContain('catalog: https://marketplace.example.test/catalog.json');
        expect(screen.getTextContent()).toContain('incompatible');

        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findAll((node) => node.props.footer === 'settingsPlugins.subtitle')).toHaveLength(1);

        // All is one aggregate daemon query: real (empty) search text, no
        // source filter, and no client-side catalog fetch anywhere.
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            text: '',
            cursor: null,
            filters: { includeUnavailable: true },
        }), expect.any(Object));
        expect(screen.findRow(discoverListingTestID('installed-plugin'))).toBeTruthy();
        expect(screen.findRow(discoverListingTestID('new-plugin'))).toBeTruthy();
        // An installed listing shows its installed state instead of lifecycle
        // actions; an uninstalled one gets the full Install & Trust review.
        expect(findDiscoverListingActions(screen, 'installed-plugin').map((action) => action.id)).toEqual(['manage']);
        // Missing package copy stays missing. The pane-level explanation is
        // shown once as its footer; it is neither repeated nor replaced with a
        // synthetic per-plugin description.
        expect(screen.getTextContent()).not.toContain('deps.ui.notInstalled');
        expect(findDiscoverInstallAction(screen, 'installed-plugin')).toBeUndefined();
        expect(findDiscoverInstallAction(screen, 'new-plugin')).toBeTruthy();
    });

    it('offers the built-in community npm source filter exactly once and narrows the aggregate query per chip', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [
                { id: 'marketplace:curated', title: 'Curated Marketplace', sourceUrl: 'https://marketplace.example.test/catalog.json', enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1 },
                { id: 'marketplace:community-npm', title: 'Community npm', sourceUrl: 'https://registry.npmjs.org/-/v1/search?text=keywords:happier-plugin&size=100', enabled: true, origin: 'user', addedAtMs: 2, updatedAtMs: 2 },
            ],
        });
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([]));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');

        expect(screen.findAllHostsByTestId('settings.plugins.marketplace.sourceFilter:marketplace:community-npm'))
            .toHaveLength(1);
        expect(screen.findAllHostsByTestId('settings.plugins.marketplace.sourceFilter:marketplace:curated'))
            .toHaveLength(1);

        // A chip narrows the same one aggregate query before acquisition; All
        // sends no source filter at all.
        await act(async () => {
            screen.pressByTestId('settings.plugins.marketplace.sourceFilter:marketplace:curated');
            await flushAsync();
            await flushAsync();
        });
        expect(machineMarketplaceIndexQueryMock).toHaveBeenLastCalledWith('machine-1', expect.objectContaining({
            text: '',
            filters: { sourceIds: ['marketplace:curated'], includeUnavailable: true },
        }), expect.any(Object));
        await act(async () => {
            screen.pressByTestId('settings.plugins.marketplace.sourceFilter:all');
            await flushAsync();
            await flushAsync();
        });
        expect(machineMarketplaceIndexQueryMock).toHaveBeenLastCalledWith('machine-1', expect.objectContaining({
            filters: { includeUnavailable: true },
        }), expect.any(Object));
    });

    it('coalesces source changes to the latest query intent after the current query settles', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [
                { id: 'marketplace:curated', title: 'Curated Marketplace', sourceUrl: 'https://marketplace.example.test/catalog.json', enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1 },
            ],
        });
        let settleInitial!: (result: MarketplaceIndexQueryResultV1) => void;
        machineMarketplaceIndexQueryMock
            .mockImplementationOnce(() => new Promise((resolve) => { settleInitial = resolve; }))
            .mockResolvedValue(createDaemonMarketplaceIndexResult([]));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
        });

        act(() => {
            screen.pressByTestId('settings.plugins.marketplace.sourceFilter:marketplace:curated');
            screen.pressByTestId('settings.plugins.marketplace.sourceFilter:marketplace:community-npm');
        });
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);

        settleInitial(createDaemonMarketplaceIndexResult([]));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(2);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenLastCalledWith('machine-1', expect.objectContaining({
            filters: { sourceIds: ['marketplace:community-npm'], includeUnavailable: true },
        }), expect.any(Object));
    });

    it('accepts a same-revision continuation, then keeps shown rows and clears a changed-revision cursor', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [{ id: 'marketplace:curated', title: 'Curated Marketplace', sourceUrl: 'https://marketplace.example.test/catalog.json', enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1 }],
        });
        machineMarketplaceIndexQueryMock
            .mockResolvedValueOnce(createDaemonMarketplaceIndexResult([
                createMarketplaceCatalogEntry({ pluginId: 'page-one-plugin', title: 'Page One Plugin', description: 'Descriptor on the loaded revision', version: '1.0.0' }),
            ], { revision: 1, nextCursor: 'cursor-1' }))
            .mockResolvedValueOnce(createDaemonMarketplaceIndexResult([
                createMarketplaceCatalogEntry({ pluginId: 'page-two-plugin', title: 'Page Two Plugin', description: 'Descriptor from the loaded revision', version: '2.0.0' }),
            ], { revision: 1, nextCursor: 'cursor-2' }))
            .mockResolvedValueOnce(createDaemonMarketplaceIndexResult([
                createMarketplaceCatalogEntry({ pluginId: 'changed-plugin', title: 'Changed Plugin', description: 'Descriptor from an incompatible revision', version: '2.1.0' }),
            ], { revision: 2, nextCursor: 'cursor-3' }))
            .mockResolvedValueOnce(createDaemonMarketplaceIndexResult([
                createMarketplaceCatalogEntry({ pluginId: 'fresh-plugin', title: 'Fresh Plugin', description: 'Descriptor from the refreshed revision', version: '3.0.0' }),
            ], { revision: 2 }));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow(discoverListingTestID('page-one-plugin'))).toBeTruthy();
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            screen.pressByTestId('settings.plugins.marketplace.loadMore');
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow(discoverListingTestID('page-one-plugin'))).toBeTruthy();
        expect(screen.findRow(discoverListingTestID('page-two-plugin'))).toBeTruthy();
        expect(screen.findAllHostsByTestId('settings.plugins.marketplace.loadMore')).toHaveLength(1);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(2);

        await act(async () => {
            screen.pressByTestId('settings.plugins.marketplace.loadMore');
            await flushAsync();
            await flushAsync();
        });

        // Last-known-good rows stay; the incompatible page is discarded — a
        // revision mismatch is not an empty catalog.
        expect(screen.findRow(discoverListingTestID('page-one-plugin'))).toBeTruthy();
        expect(screen.findRow(discoverListingTestID('page-two-plugin'))).toBeTruthy();
        expect(screen.findRow(discoverListingTestID('changed-plugin'))).toBeFalsy();
        // The mismatched page's cursor is gone, so the stale list cannot request
        // another incompatible continuation.
        expect(screen.findAllHostsByTestId('settings.plugins.marketplace.loadMore')).toHaveLength(0);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(3);
        // The mismatch is announced by the pane's one accessible status row;
        // its label carries the exact error key like every other status fact.
        const mismatchSummary = screen.findByTestId('settings.plugins.marketplace.discover.status.summary');
        expect(closestAccessibleAnnouncementAncestor(mismatchSummary)?.props.accessibilityLabel).toBe(
            'settingsPlugins.discover.status.errorTitle settingsPlugins.discoverRevisionChanged',
        );

        // Recovery stays with the user's own fresh query from cursor null.
        await act(async () => {
            screen.pressByTestId('settings.plugins.marketplace.refreshDiscover');
            await flushAsync();
            await flushAsync();
        });
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(4);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenLastCalledWith('machine-1', expect.objectContaining({
            cursor: null,
        }), expect.any(Object));
        expect(screen.findRow(discoverListingTestID('fresh-plugin'))).toBeTruthy();
        expect(screen.findAllHostsByTestId('settings.plugins.marketplace.loadMore')).toHaveLength(0);
    });

    it('keeps the shown daemon listings while the search draft changes until the user searches', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [{ id: 'marketplace:curated', title: 'Curated Marketplace', sourceUrl: 'https://marketplace.example.test/catalog.json', enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1 }],
        });
        machineMarketplaceIndexQueryMock
            .mockResolvedValueOnce(createDaemonMarketplaceIndexResult([
                createMarketplaceCatalogEntry({ pluginId: 'sample-plugin', title: 'Sample Plugin', description: 'Descriptor for the shown page', version: '1.0.0' }),
            ]))
            .mockResolvedValueOnce(createDaemonMarketplaceIndexResult([
                createMarketplaceCatalogEntry({ pluginId: 'replacement-plugin', title: 'Replacement Plugin', description: 'Descriptor for the searched page', version: '2.0.0' }),
            ]));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow(discoverListingTestID('sample-plugin'))).toBeTruthy();
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);

        // Typing only drafts the next query: nothing re-queries, and the list
        // the user is already reading stays on screen.
        await act(async () => {
            screen.findRow('settings.plugins.marketplace.search')?.props.onChangeText('replacement');
        });
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
        expect(screen.findRow(discoverListingTestID('sample-plugin'))).toBeTruthy();
        // The controls now describe a different query than the shown list.
        expect(screen.getTextContent()).toContain('settingsPlugins.discover.status.stale');

        await act(async () => {
            screen.pressRow('settings.plugins.marketplace.refreshDiscover');
            await flushAsync();
            await flushAsync();
        });

        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(2);
        expect(machineMarketplaceIndexQueryMock).toHaveBeenLastCalledWith('machine-1', expect.objectContaining({
            text: 'replacement',
            cursor: null,
        }), expect.any(Object));
        expect(screen.findRow(discoverListingTestID('replacement-plugin'))).toBeTruthy();
        expect(screen.findRow(discoverListingTestID('sample-plugin'))).toBeFalsy();
    });

    it('reconciles exact curated install truth after the private decision response is lost', async () => {
        const initialState = createMachineCapabilitiesState([]);
        let authoritativeState: MachineCapabilitiesState = initialState;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: initialState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockImplementation(() => authoritativeState);
        prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
            authoritativeState = createMachineCapabilitiesState([
                createInstalledPlugin({
                    pluginId: 'new-plugin',
                    title: 'New Plugin',
                    version: '0.1.0',
                }),
            ]);
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: {
                ok: true,
                result: {
                    action: 'install',
                    pluginId: 'new-plugin',
                    change: {
                        kind: 'reviewRequired',
                        pendingChangeId: 'pending-curated-1',
                        review: {
                            pluginId: 'new-plugin',
                            displayName: 'New Plugin',
                            version: '0.1.0',
                            packageIdentity: { name: '@acme/new-plugin', version: '0.1.0' },
                            publisherIdentity: { status: 'unverified', id: 'acme', displayName: 'Acme' },
                            source: {
                                kind: 'npm',
                                locator: '@acme/new-plugin@0.1.0',
                                integrity: 'sha512-exact',
                                integrityBasis: 'expected',
                            },
                            updateChannel: {
                                kind: 'npm',
                                packageName: '@acme/new-plugin',
                                registryOrigin: 'https://registry.npmjs.org',
                                marketplaceSource: {
                                    id: 'marketplace:curated',
                                    kind: 'curated',
                                    sourceUrl: 'https://marketplace.example.test/catalog.json',
                                },
                            },
                            signature: { status: 'verified', keyId: 'registry-key-1' },
                            provenance: { status: 'notProvided' },
                            curation: {
                                status: 'approved',
                                sourceId: 'marketplace:curated',
                                reviewedAt: '2026-07-24T00:00:00.000Z',
                            },
                            executableRealms: ['daemon'],
                            contributions: [],
                            uiArtifacts: { status: 'none', contributionIds: [] },
                            requiredHostAccess: [],
                            optionalHostAccess: [],
                            rawCredentialAccess: [],
                            requestInterceptors: [],
                            compatibility: { happier: '^0.2.0', runtimeApiVersion: 1 },
                            updatePolicy: 'reviewEveryUpdate',
                        },
                    },
                },
            },
        });
        machineRpcWithServerScopeMock.mockRejectedValueOnce(new Error('Connection closed after commit'));
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [{ id: 'marketplace:curated', title: 'Curated Marketplace', sourceUrl: 'https://marketplace.example.test/catalog.json', enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1 }],
        });
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([
            createMarketplaceCatalogEntry({ pluginId: 'new-plugin', title: 'New Plugin', description: 'Descriptor for an uninstalled plugin', version: '0.1.0' }),
        ]));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(screen.findRow(discoverListingTestID('new-plugin'))).toBeTruthy();
        const installAction = findDiscoverInstallAction(screen, 'new-plugin');
        expect(installAction).toBeTruthy();

        await act(async () => {
            installAction?.onPress();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'install',
                params: {
                    sourceId: 'marketplace:curated',
                    pluginId: 'new-plugin',
                    packageName: '@acme/new-plugin',
                },
            },
        }));
        // The install review is the shared dialog fed by the exact serialized
        // protocol review, named to the exact machine and server it grants on.
        expect(modalShowMock).toHaveBeenCalledWith(expect.objectContaining({
            chrome: expect.objectContaining({
                title: 'settingsPlugins.marketplaceInstallReviewTitle(name=New Plugin,version=0.1.0)',
            }),
            props: expect.objectContaining({
                review: expect.objectContaining({
                    pluginId: 'new-plugin',
                    packageIdentity: { name: '@acme/new-plugin', version: '0.1.0' },
                }),
                target: { machine: 'machine-1', server: 'Server A' },
            }),
        }));
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: {
                v: 1,
                pendingChangeId: 'pending-curated-1',
                decision: 'installAndTrust',
                optionalSelections: [],
            },
        }));
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: expect.objectContaining({ bypassCache: true }),
        }));
        expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'common.done');
    });

    it('shows unreviewed community npm code and routes Install & Trust through the exact daemon action', async () => {
        const communitySourceUrl = 'https://registry.npmjs.org/-/v1/search?text=keywords:happier-plugin';
        const refresh = vi.fn();
        const communityReview = createCommunityInstallReviewResult('pending-community-1');
        communityReview.change.review.optionalHostAccess.push({
            id: 'workspace',
            capability: 'workspace',
            reason: 'Read the selected workspace',
            authorizationClass: 'hostResourceSelection',
            normalizedScope: { access: ['read'] },
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh,
        });
        invokeWithAlertsMock.mockResolvedValueOnce({
            supported: true,
            response: {
                ok: true,
                result: communityReview,
            },
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({
            kind: 'committed',
            pluginId: 'community-plugin',
            desiredGeneration: 'generation-2',
            appliedGeneration: 'generation-2',
            pendingSurfaces: [],
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [{
                id: 'marketplace:community-npm',
                title: 'Community npm',
                sourceUrl: communitySourceUrl,
                enabled: true,
                origin: 'community-npm',
                addedAtMs: 1,
                updatedAtMs: 1,
            }],
        });
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([
            createMarketplaceCatalogEntry({
                pluginId: 'community-plugin',
                title: 'Community Plugin',
                description: 'Third-party plugin from npm',
                version: '2.0.0',
            }),
        ], {
            sourceId: 'marketplace:community-npm',
            sourceTitle: 'Community npm',
            sourceUrl: communitySourceUrl,
            sourceKind: 'community-npm',
            reviewStatus: 'unreviewed',
        }));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        // One listing is one row: its unreviewed-community status and its
        // Install & Trust action are carried by that row, not by extra rows
        // beneath it. The full disclosure stays in the install review.
        const communityRow = screen.findRow(discoverListingTestID('community-plugin', 'marketplace:community-npm'));
        expect(communityRow).toBeTruthy();
        await act(async () => {
            screen.pressRow(`${discoverListingTestID('community-plugin', 'marketplace:community-npm')}.details`);
        });
        expect(screen.getTextContent()).toContain('settingsPlugins.discover.publisherLabel(displayName=Acme,id=acme)');
        expect(screen.getTextContent()).toContain('settingsPlugins.discover.categories(values=agents)');
        expect(screen.getTextContent()).toContain(
            'settingsPlugins.discover.runtimeSummary(realms=settingsPlugins.discover.executableRealm.daemon,platforms=settingsPlugins.discover.platform.web)',
        );
        expect(screen.findByTestId('settings.plugins.marketplace.reviewStatus.marketplace:community-npm.community-plugin:variant:warning'))
            .toBeTruthy();
        expect(screen.getTextContent()).toContain('settingsPlugins.discover.reviewStatus.unreviewed');
        const communityInstallAction = findDiscoverInstallAction(screen, 'community-plugin', 'marketplace:community-npm');
        expect(communityInstallAction).toBeTruthy();
        expect(communityInstallAction?.accessibilityLabel).toBe(
            'settingsPlugins.installAndTrust. Community Plugin. Community npm',
        );

        modalShowMock.mockImplementationOnce(() => 'plugin-install-review-modal');
        await act(async () => {
            communityInstallAction?.onPress();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'install',
                params: {
                    sourceId: 'marketplace:community-npm',
                    pluginId: 'community-plugin',
                    // The npm package name is not derivable from the manifest
                    // plugin id, so the listing's own coordinate must travel.
                    packageName: '@acme/community-plugin',
                },
            },
            alerts: expect.objectContaining({ successMessage: null }),
        }));
        expect(modalShowMock).toHaveBeenCalledOnce();
        expect(modalConfirmMock).not.toHaveBeenCalled();
        const reviewModalConfig = modalShowMock.mock.calls[0]?.[0] as Readonly<{
            component: React.ComponentType<Readonly<{
                onClose: () => void;
                setChrome?: (chrome: unknown) => void;
                review: PluginInstallationReview;
                onResolve: (result: Readonly<{
                    approved: boolean;
                    optionalSelections: readonly Readonly<{ accessId: string; selected: boolean }>[];
                }>) => void;
            }>>;
            props: Readonly<{
                review: PluginInstallationReview;
                onResolve: (result: Readonly<{
                    approved: boolean;
                    optionalSelections: readonly Readonly<{ accessId: string; selected: boolean }>[];
                }>) => void;
            }>;
        }>;
        expect(reviewModalConfig.props.review).toMatchObject({
            pluginId: 'community-plugin',
            packageIdentity: { name: '@acme/community-plugin', version: '2.0.0' },
            requiredHostAccess: [expect.objectContaining({ capability: 'network' })],
        });
        const reviewModal = await renderSettingsView(React.createElement(reviewModalConfig.component, {
            ...reviewModalConfig.props,
            onClose: vi.fn(),
            setChrome: vi.fn(),
        }));
        const sessionsToggle = reviewModal.findByTestId('settings.plugins.installReview.optional.sessions');
        expect(sessionsToggle?.props.value).toBe(false);
        expect(sessionsToggle?.props.accessibilityLabel).toContain('sessions');
        expect(sessionsToggle?.props.accessibilityState).toEqual({ checked: false });
        const workspaceToggle = reviewModal.findByTestId('settings.plugins.installReview.optional.workspace');
        expect(workspaceToggle?.props.value).toBe(false);
        expect(workspaceToggle?.props.accessibilityState).toEqual({ checked: false });
        await act(async () => {
            sessionsToggle?.props.onValueChange(true);
        });
        expect(reviewModal.findByTestId('settings.plugins.installReview.optional.sessions')?.props.value).toBe(true);
        expect(reviewModal.findByTestId('settings.plugins.installReview.optional.sessions')?.props.accessibilityState)
            .toEqual({ checked: true });
        await act(async () => {
            reviewModal.pressByTestId('settings.plugins.installReview.confirm');
            await flushAsync();
            await flushAsync();
        });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: {
                v: 1,
                pendingChangeId: 'pending-community-1',
                decision: 'installAndTrust',
                optionalSelections: [
                    { accessId: 'sessions', selected: true },
                    { accessId: 'workspace', selected: false },
                ],
            },
        }));
        expect(refresh).toHaveBeenCalledTimes(1);

        modalShowMock.mockImplementationOnce((config: Readonly<{
            props?: Readonly<{
                onResolve?: (result: Readonly<{
                    approved: boolean;
                    optionalSelections: readonly Readonly<{ accessId: string; selected: boolean }>[];
                }>) => void;
            }>;
        }>) => {
            config.props?.onResolve?.({ approved: false, optionalSelections: [] });
            return 'plugin-install-review-modal';
        });
        invokeWithAlertsMock.mockResolvedValueOnce({
            supported: true,
            response: {
                ok: true,
                result: createCommunityInstallReviewResult('pending-community-2'),
            },
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ kind: 'cancelled' });

        await act(async () => {
            findDiscoverInstallAction(screen, 'community-plugin', 'marketplace:community-npm')?.onPress();
            await flushAsync();
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: {
                v: 1,
                pendingChangeId: 'pending-community-2',
                decision: 'cancel',
            },
        }));
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('reconciles an outcome-unknown exact marketplace update after the private review decision', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'community-plugin',
            title: 'Community Plugin',
            version: '1.0.0',
        });
        const initialState = createMachineCapabilitiesState([installedPlugin]);
        let authoritativeState: MachineCapabilitiesState = initialState;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: initialState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockImplementation(() => authoritativeState);
        prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
            authoritativeState = createMachineCapabilitiesState([{
                ...installedPlugin,
                version: '2.0.0',
            }]);
        });
        invokeWithAlertsMock.mockResolvedValueOnce({
            supported: true,
            response: {
                ok: true,
                result: createCommunityInstallReviewResult('pending-update-1', 'update'),
            },
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({
            kind: 'outcomeUnknown',
            pluginId: 'community-plugin',
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        // Update starts from the installed record's own row action; Discover
        // never advertised a lifecycle row for something already installed.
        const updateAction = screen.findAllByType('ItemRowActions' as any)
            .find((node) => node.props.title === 'Community Plugin')
            ?.props.actions
            ?.find((action: Readonly<{ id: string }>) => action.id === 'update') as
            | Readonly<{ disabled: boolean; onPress: () => void }>
            | undefined;
        expect(updateAction?.disabled).not.toBe(true);
        await act(async () => {
            updateAction?.onPress();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenCalledWith(expect.objectContaining({
            request: {
                id: MARKETPLACE_CAPABILITY_ID,
                method: 'update',
                params: {
                    pluginId: 'community-plugin',
                },
            },
            alerts: expect.objectContaining({ successMessage: null }),
        }));
        expect(modalShowMock).toHaveBeenCalledWith(expect.objectContaining({
            chrome: expect.objectContaining({
                title: 'settingsPlugins.marketplaceInstallReviewTitle(name=Community Plugin,version=2.0.0)',
            }),
            props: expect.objectContaining({
                review: expect.objectContaining({
                    pluginId: 'community-plugin',
                    packageIdentity: { name: '@acme/community-plugin', version: '2.0.0' },
                }),
            }),
        }));
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'daemon.plugins.install.review.decide',
            payload: expect.objectContaining({
                v: 1,
                pendingChangeId: 'pending-update-1',
                decision: 'installAndTrust',
            }),
        }));
        expect(prefetchMachineCapabilitiesMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-a',
            request: expect.objectContaining({ bypassCache: true }),
        }));
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledTimes(1);
        expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'common.done');
    });

    it('reconciles an ambiguous update against the installed record the update owner advanced, not the catalog version', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'community-plugin',
            title: 'Community Plugin',
            version: '1.0.0',
        });
        const initialState = createMachineCapabilitiesState([installedPlugin]);
        let authoritativeState: MachineCapabilitiesState = initialState;
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: initialState,
            refresh: vi.fn(),
        });
        getMachineCapabilitiesCacheStateMock.mockImplementation(() => authoritativeState);
        // The canonical update owner selected the newest compatible version, which
        // is not the version this catalog listing advertises.
        prefetchMachineCapabilitiesMock.mockImplementationOnce(async () => {
            authoritativeState = createMachineCapabilitiesState([{
                ...installedPlugin,
                version: '1.4.0',
            }]);
        });
        invokeWithAlertsMock.mockResolvedValueOnce({ supported: false, reason: 'error' });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await act(async () => {
            screen.findAllByType('ItemRowActions' as any)
                .find((node) => node.props.title === 'Community Plugin')
                ?.props.actions
                ?.find((action: Readonly<{ id: string }>) => action.id === 'update')
                ?.onPress();
            await flushAsync();
        });

        expect(modalAlertMock).toHaveBeenCalledWith('common.success', 'common.done');
        expect(modalAlertMock).not.toHaveBeenCalledWith('common.error', expect.anything());
    });

    it.each([
        ['stale', { freshnessState: 'stale' as const }],
        ['unapproved', { reviewStatus: 'blocked' as const }],
        ['non-curated', { sourceKind: 'user' as const }],
    ])('does not surface a non-warning %s marketplace listing', async (_label, options) => {
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [{ id: 'marketplace:curated', title: 'Curated Marketplace', sourceUrl: 'https://marketplace.example.test/catalog.json', enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1 }],
        });
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([
            createMarketplaceCatalogEntry({ pluginId: 'new-plugin' }),
        ], options));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        // The listing is not silently dropped: it surfaces as a non-installable
        // row with its reason, and nothing installable or mutating appears.
        expect(screen.findRow(discoverListingTestID('new-plugin'))).toBeFalsy();
        expect(screen.findByTestId('settings.plugins.marketplace.discover.nonInstallable.marketplace:curated.new-plugin')).toBeTruthy();
        expect(findDiscoverInstallAction(screen, 'new-plugin')).toBeUndefined();
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
    });

    it('shows an urgent warning for a withdrawn curated listing without disabling installed code', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'withdrawn-plugin',
            title: 'Withdrawn Plugin',
            version: '1.0.0',
            enabled: true,
        });
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [{ id: 'marketplace:curated', title: 'Curated Marketplace', sourceUrl: 'https://marketplace.example.test/catalog.json', enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1 }],
        });
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([
            createMarketplaceCatalogEntry({ pluginId: 'withdrawn-plugin', title: 'Withdrawn Plugin' }),
        ], {
            reviewStatus: 'withdrawn',
        }));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });
        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        // All is the unfiltered aggregate query: the daemon decides what a
        // withdrawal means, no source filter is sent from the client.
        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            filters: { includeUnavailable: true },
        }), expect.any(Object));
        const withdrawnRow = screen.findRow(discoverListingTestID('withdrawn-plugin'));
        expect(withdrawnRow).toBeTruthy();
        // One status pill carries withdrawal on the listing's own row rather
        // than duplicating it as a second warning line or a separate row.
        expect(screen.findByTestId('settings.plugins.marketplace.reviewStatus.marketplace:curated.withdrawn-plugin:variant:warning'))
            .toBeTruthy();
        expect(screen.getTextContent()).toContain('settingsPlugins.discover.reviewStatus.withdrawn');
        // The warning never becomes authority over installed code: Discover
        // renders no install (or any lifecycle) action for the installed listing.
        expect(findDiscoverListingActions(screen, 'withdrawn-plugin').map((action) => action.id)).toEqual(['manage']);
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
    });

    it('routes installed-row enable and disable through the host capability', async () => {
        const enabledPlugin = createInstalledPlugin({
            pluginId: 'existing-plugin',
            title: 'Existing Plugin',
            version: '1.0.0',
            enabled: true,
            source: {
                kind: 'catalog',
                locator: 'https://marketplace.example.test/catalog.json',
                trustPolicy: 'trusted',
                installPolicy: 'allow',
                resolvedPath: '/plugins/existing-plugin',
            },
            compatibility: {
                status: 'compatible',
                diagnostics: [],
            },
            diagnostics: [],
        });

        const disabledPlugin = createInstalledPlugin({
            pluginId: 'disabled-plugin',
            title: 'Disabled Plugin',
            version: '2.0.0',
            enabled: false,
            source: {
                kind: 'catalog',
                locator: 'https://marketplace.example.test/catalog.json',
                trustPolicy: 'trusted',
                installPolicy: 'allow',
                resolvedPath: '/plugins/disabled-plugin',
            },
            compatibility: {
                status: 'compatible',
                diagnostics: [],
            },
            diagnostics: [],
        });

        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([enabledPlugin, disabledPlugin]),
            refresh,
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: { ok: true, result: { ok: true } },
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        // Enable/disable live on the installed row; Discover renders no
        // lifecycle actions for installed listings at all.
        const rowActions = screen.findAllByType('ItemRowActions' as any);
        const disableAction = rowActions
            .find((node) => node.props.title === 'Existing Plugin')
            ?.props.actions.find((action: { id: string }) => action.id === 'disable');
        const enableAction = rowActions
            .find((node) => node.props.title === 'Disabled Plugin')
            ?.props.actions.find((action: { id: string }) => action.id === 'enable');
        expect(disableAction).toBeTruthy();
        expect(enableAction).toBeTruthy();

        await act(async () => {
            disableAction?.onPress();
            await flushAsync();
        });

        await act(async () => {
            enableAction?.onPress();
            await flushAsync();
        });

        expect(invokeWithAlertsMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
            request: expect.objectContaining({
                method: 'disable',
                params: expect.objectContaining({
                    pluginId: 'existing-plugin',
                }),
            }),
        }));
        expect(invokeWithAlertsMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            request: expect.objectContaining({
                method: 'enable',
                params: expect.objectContaining({
                    pluginId: 'disabled-plugin',
                }),
            }),
        }));
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenNthCalledWith(1, { bypassCache: true });
        expect(refresh).toHaveBeenNthCalledWith(2, { bypassCache: true });
    });

    it('does not offer Install & Trust for an already installed plugin from another marketplace source', async () => {
        const installedPlugin = createInstalledPlugin({
            pluginId: 'existing-plugin',
            title: 'Existing Plugin',
            version: '1.0.0',
            enabled: true,
            source: {
                kind: 'catalog',
                locator: 'https://catalog-a.example.test/catalog.json',
                trustPolicy: 'trusted',
                installPolicy: 'allow',
                resolvedPath: '/plugins/existing-plugin',
            },
            compatibility: {
                status: 'compatible',
                diagnostics: [],
            },
            diagnostics: [],
        });

        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([installedPlugin]),
            refresh: vi.fn(),
        });
        invokeWithAlertsMock.mockResolvedValue({
            supported: true,
            response: { ok: true, result: { ok: true } },
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue({
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [{
                id: 'marketplace:other',
                title: 'Other Marketplace',
                sourceUrl: 'https://catalog-b.example.test/catalog.json',
                enabled: true,
                origin: 'curated',
                addedAtMs: 1,
                updatedAtMs: 1,
            }],
        });
        // Discover is the one aggregate daemon query; the retired client-side
        // catalog-URL loader no longer exists, and the daemon's own listing for
        // the other source still must not offer Install & Trust for code this
        // machine already has installed and trusted.
        machineMarketplaceIndexQueryMock.mockResolvedValue(createDaemonMarketplaceIndexResult([
            createMarketplaceCatalogEntry({
                pluginId: 'existing-plugin',
                title: 'Existing Plugin',
                description: 'Descriptor from a different catalog source',
                version: '9.9.9',
                sourceUrl: 'https://catalog-b.example.test/entries/existing-plugin.json',
                packageUrl: 'https://catalog-b.example.test/plugins/existing-plugin.tgz',
            }),
        ], {
            sourceId: 'marketplace:other',
            sourceTitle: 'Other Marketplace',
            sourceUrl: 'https://catalog-b.example.test/catalog.json',
        }));

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        await selectPluginManagementView(screen, 'discover');
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(machineMarketplaceIndexQueryMock).toHaveBeenCalledTimes(1);
        expect(screen.findRow(discoverListingTestID('existing-plugin', 'marketplace:other'))).toBeTruthy();
        expect(findDiscoverInstallAction(screen, 'existing-plugin', 'marketplace:other')).toBeUndefined();
        expect(invokeWithAlertsMock).not.toHaveBeenCalled();
    });

    it('keeps unrelated plugin rows interactive while a plugin action is in flight', async () => {
        const deferred = createDeferred();
        const refresh = vi.fn();
        useMachineCapabilitiesCacheMock.mockReturnValue({
            state: createMachineCapabilitiesState([
                createInstalledPlugin({
                    pluginId: 'installed-plugin',
                    title: 'Installed Plugin',
                    version: '1.0.0',
                    enabled: true,
                }),
                createInstalledPlugin({
                    pluginId: 'other-plugin',
                    title: 'Other Plugin',
                    version: '1.0.0',
                    enabled: true,
                }),
            ]),
            refresh,
        });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(null);
        machineContributionRegistryProjectionDescribeMock.mockResolvedValue({
            supported: true,
            projection: {
                v: 2,
                generation: 12,
                installedPackagesById: {
                    'installed-plugin': {
                        id: 'installed-plugin',
                        displayName: 'Installed Plugin',
                        version: '1.0.0',
                        enabled: true,
                        source: {
                            kind: 'path',
                            locator: '/plugins/installed-plugin',
                        },
                    },
                },
                agentsById: {},
                backendsById: {},
                actionsById: {},
                toolsById: {},
                commandsById: {},
                resourcesById: {},
                diagnostics: [],
            },
        });
        invokeWithAlertsMock.mockImplementation(async () => {
            await deferred.promise;
            return {
                supported: true,
                response: { ok: true, result: { ok: true } },
            };
        });

        const { PluginSettingsHomeScreen } = await import('./PluginSettingsHomeScreen');
        const screen = await renderSettingsView(React.createElement(PluginSettingsHomeScreen));

        const rowActions = screen.findAllByType('ItemRowActions' as any);
        const installedAction = rowActions
            .find((node) => node.props.title === 'Installed Plugin')
            ?.props.actions.find((action: { id: string }) => action.id === 'disable');
        const otherAction = rowActions
            .find((node) => node.props.title === 'Other Plugin')
            ?.props.actions.find((action: { id: string }) => action.id === 'disable');
        expect(rowActions.flatMap((node) => node.props.actions).some((action: { id: string }) => action.id === 'reload')).toBe(false);
        expect(installedAction).toBeTruthy();
        expect(otherAction?.disabled).toBe(false);

        await act(async () => {
            installedAction?.onPress();
            await flushAsync();
        });

        const inFlightInstalledAction = screen.findAllByType('ItemRowActions' as any)
            .find((node) => node.props.title === 'Installed Plugin')
            ?.props.actions.find((action: { id: string }) => action.id === 'disable');
        const inFlightOtherAction = screen.findAllByType('ItemRowActions' as any)
            .find((node) => node.props.title === 'Other Plugin')
            ?.props.actions.find((action: { id: string }) => action.id === 'disable');
        expect(inFlightInstalledAction?.disabled).toBe(true);
        expect(inFlightOtherAction?.disabled).toBe(false);

        deferred.resolve();
        await act(async () => {
            await flushAsync();
            await flushAsync();
        });

        expect(refresh).toHaveBeenCalledWith({ bypassCache: true });
    });
});

describe('PluginMarketplaceSourcesScreen', () => {
    it('keeps unread Sources unavailable until the exact machine returns an authoritative registry', async () => {
        useMachineCapabilitiesCacheMock.mockReturnValue({ state: createMachineCapabilitiesState([]), refresh: vi.fn() });
        const machine = machineAdministrationFixture.activeMachines[0]!;
        machine.active = false;
        machine.activeAt = 0;
        const registry: MarketplaceSourceRegistryV1 = {
            t: 'happier_marketplace_source_registry_v1', schemaVersion: 1,
            sources: [{ id: 'user-known', title: 'Known source', sourceUrl: 'https://plugins.example.test/index.json', origin: 'user', enabled: true, addedAtMs: 1, updatedAtMs: 1 }],
        };
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(registry);
        const { PluginMarketplaceSourcesScreen } = await import('./PluginMarketplaceSourcesScreen');
        const RerenderableSources = PluginMarketplaceSourcesScreen as React.ComponentType<{ revision: number }>;
        const screen = await renderSettingsView(React.createElement(RerenderableSources, { revision: 1 }));
        await act(async () => { await flushAsync(); });
        expect(screen.findRow('settings.plugins.sources.empty')).toBeNull();
        expect(screen.findRow('settings.plugins.sources.unavailable')).toBeTruthy();
        expect(machineMarketplaceSourceRegistryGetMock).not.toHaveBeenCalled();

        machine.active = true;
        machine.activeAt = Date.now();
        await act(async () => {
            screen.tree.update(React.createElement(RerenderableSources, { revision: 2 }));
            await flushAsync(); await flushAsync();
        });
        expect(screen.findRow('settings.plugins.sources.source.user-known')).toBeTruthy();
        expect(screen.findRow('settings.plugins.sources.unavailable')).toBeNull();
        machineMarketplaceSourceRegistryGetMock.mockRejectedValueOnce(new Error('read failed'));
        screenFocusState.value = false;
        await act(async () => { screen.tree.update(React.createElement(RerenderableSources, { revision: 3 })); });
        screenFocusState.value = true;
        await act(async () => {
            screen.tree.update(React.createElement(RerenderableSources, { revision: 4 }));
            await flushAsync(); await flushAsync();
        });
        expect(screen.findRow('settings.plugins.sources.source.user-known')).toBeTruthy();
        expect(screen.findRow('settings.plugins.sources.retry')).toBeTruthy();
        expect(screen.findRow('settings.plugins.sources.empty')).toBeNull();
        machineMarketplaceSourceRegistryGetMock.mockResolvedValueOnce({ ...registry, sources: [] });
        await act(async () => { screen.pressRow('settings.plugins.sources.retry'); await flushAsync(); });
        expect(screen.findRow('settings.plugins.sources.empty')).toBeTruthy();
        expect(screen.findRow('settings.plugins.sources.source.user-known')).toBeNull();

        setMachineAdministrationTargetFixture({ serverIdentityId: 'srv_identity-b', serverId: 'server-b', machineId: 'machine-2' });
        const replacement = machineAdministrationFixture.machineListByServerId['server-b']![0]!;
        replacement.active = false;
        replacement.activeAt = 0;
        await act(async () => {
            screen.tree.update(React.createElement(RerenderableSources, { revision: 5 }));
            await flushAsync();
        });
        expect(screen.findRow('settings.plugins.sources.empty')).toBeNull();
        expect(screen.findRow('settings.plugins.sources.unavailable')).toBeTruthy();
        expect(screen.findRow('settings.plugins.sources.source.user-known')).toBeNull();
    });

    it('keeps Community npm read-only and mutates only user sources through the canonical registry operations', async () => {
        const registry: MarketplaceSourceRegistryV1 = {
            t: 'happier_marketplace_source_registry_v1',
            schemaVersion: 1,
            sources: [
                {
                    id: 'curated', title: 'Curated', sourceUrl: 'https://curated.example/index.json',
                    enabled: true, origin: 'curated', addedAtMs: 1, updatedAtMs: 1,
                },
                {
                    id: 'user', title: 'My source', sourceUrl: 'https://mine.example/index.json',
                    enabled: true, origin: 'user', addedAtMs: 1, updatedAtMs: 1,
                },
            ],
        };
        useMachineCapabilitiesCacheMock.mockReturnValue({ state: createMachineCapabilitiesState([]), refresh: vi.fn() });
        machineMarketplaceSourceRegistryGetMock.mockResolvedValue(registry);
        // The op's own settlement shape: a parsed registry snapshot on success
        // (or `outcomeUnknown` after the mutation was issued), never a raw registry.
        machineMarketplaceSourceRegistryMutateMock.mockImplementation(async () => ({ status: 'success' as const, registry }));

        const { PluginMarketplaceSourcesScreen } = await import('./PluginMarketplaceSourcesScreen');
        const screen = await renderSettingsView(React.createElement(PluginMarketplaceSourcesScreen));
        await act(async () => { await flushAsync(); await flushAsync(); });

        const communityNpmRow = screen.findRow('settings.plugins.sources.communityNpm');
        expect(communityNpmRow).toBeTruthy();
        expect(communityNpmRow?.props.accessibilityLabel).toBe(
            'settingsPlugins.sourceAdministration.communityTitle. settingsPlugins.sourceAdministration.communitySubtitle',
        );
        expect(communityNpmRow?.props.onPress).toBeUndefined();
        expect(screen.findRow('settings.plugins.sources.source.curated')).toBeTruthy();
        expect(screen.findRow('settings.plugins.sources.remove.curated')).toBeNull();
        expect(screen.findRow('settings.plugins.sources.remove.user')).toBeTruthy();

        await act(async () => {
            screen.findByTestId('settings.plugins.sources.enabled.user')?.props.onValueChange(false);
            await flushAsync();
        });
        expect(machineMarketplaceSourceRegistryMutateMock).toHaveBeenCalledWith(
            'machine-1',
            { kind: 'setEnabled', sourceId: 'user', enabled: false },
            { serverId: 'server-a' },
        );

        // Adding a source asks for the address only: the Protocol owner derives
        // the display title, and Edit stays the owner of optional metadata.
        modalPromptMock.mockResolvedValueOnce('https://new.example/index.json');
        await act(async () => {
            screen.pressRow('settings.plugins.sources.add');
            await flushAsync();
            await flushAsync();
        });
        expect(machineMarketplaceSourceRegistryMutateMock).toHaveBeenLastCalledWith(
            'machine-1',
            { kind: 'upsert', input: { sourceUrl: 'https://new.example/index.json', origin: 'user', enabled: true } },
            { serverId: 'server-a' },
        );
    });
});
