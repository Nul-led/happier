import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen as renderScreenWithProviders } from '@/dev/testkit';
import { installMachineDetailsCommonModuleMocks } from './machineDetailsTestHelpers';
import { loadSyncSingletonForTests } from '@/dev/testkit/harness/syncSingletonLoader';
import { decodePlainMachineStoredContent } from '@happier-dev/protocol';
import type { MachineUpdateMetadataRequest, MachineUpdateMetadataResponse } from '@happier-dev/protocol';
import type { Machine } from '@/sync/domains/state/storageTypes';

const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    expo?: { EventEmitter: new () => unknown };
};

testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
testGlobal.expo = { EventEmitter: class {} } as unknown as NonNullable<typeof testGlobal.expo>;

const {
    confirmSpy,
    showSpy,
    itemSpy,
    machineState,
    clearReplacementSpy,
    coordinatorSpy,
    alertSpy,
    promptSpy,
    metadataTransportSpy,
    refreshMachinesSpy,
    routeParams,
    stackOptionsState,
    mutateAccountSettingsSpy,
    replaceSpy,
    refreshMachinesThrottledSpy,
    revokeSpy,
    routerBackSpy,
    routerMock,
} = vi.hoisted(() => ({
    confirmSpy: vi.fn<(..._args: any[]) => Promise<boolean>>(async () => true),
    showSpy: vi.fn<(..._args: any[]) => string>(() => 'replacement-picker-modal'),
    itemSpy: vi.fn(),
    machineState: {
        currentMachine: null as any,
        machinesByServerId: {} as Record<string, any[] | null>,
        settings: { providerSettingsV1: undefined } as Record<string, unknown>,
    },
    clearReplacementSpy: vi.fn(async (_machineId: string) => ({ ok: true as const })),
    coordinatorSpy: vi.fn(async (_machineId: string, dependencies: any): Promise<any> => {
        await dependencies.mutateAccountSettings((raw: Record<string, unknown>) => raw);
        return { ok: true as const, machineAlreadyRevoked: false, providerCleanup: 'complete' as const };
    }),
    alertSpy: vi.fn(),
    promptSpy: vi.fn<(..._args: any[]) => Promise<string | null>>(async () => null),
    metadataTransportSpy: vi.fn<(_event: string, _request: MachineUpdateMetadataRequest) => Promise<MachineUpdateMetadataResponse>>(),
    refreshMachinesSpy: vi.fn(async () => {}),
    routeParams: { id: 'machine-1', serverId: undefined as string | undefined },
    stackOptionsState: { current: null as Record<string, unknown> | null },
    mutateAccountSettingsSpy: vi.fn(async (mutate: (raw: Record<string, unknown>) => Record<string, unknown>) => {
        mutate({ providerSettingsV1: undefined });
    }),
    replaceSpy: vi.fn(async (_params: any) => ({ ok: true as const })),
    refreshMachinesThrottledSpy: vi.fn(async () => {}),
    revokeSpy: vi.fn(async (_machineId: string) => ({ ok: true as const })),
    routerBackSpy: vi.fn(),
    routerMock: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
}));

installMachineDetailsCommonModuleMocks({
    // Parameterized copy keeps its params, so the machine a fact names is observable.
    text: async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock(),
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { ...routerMock, back: routerBackSpy },
            params: routeParams,
            stackOptionsCapture: {
                record: (options) => {
                    stackOptionsState.current = typeof options === 'function' ? options() : options;
                },
                reset: () => {
                    stackOptionsState.current = null;
                },
                getRaw: () => stackOptionsState.current,
                getResolved: () => stackOptionsState.current,
            },
        }).module;
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: alertSpy,
                confirm: confirmSpy,
                prompt: promptSpy,
                show: showSpy,
            },
        }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        const { profileDefaults } = await import('@/sync/domains/profiles/profile');
        return createStorageModuleStub({
            useSessions: () => [],
            useMachine: () => machineState.currentMachine,
            useMachineListByServerId: () => machineState.machinesByServerId,
            useSetting: () => false,
            useSettingMutable: () => [null, vi.fn()],
            useSettings: () => machineState.settings,
            storage: {
                getState: () => ({
                    settings: {},
                    profile: profileDefaults,
                    profileScope: null,
                    sessions: {},
                    machines: { [machineState.currentMachine.id]: machineState.currentMachine },
                    applyMachines: (machines: Machine[]) => {
                        machineState.currentMachine = machines.find((machine) => machine.id === routeParams.id) ?? machineState.currentMachine;
                    },
                    getProjectForSession: () => null,
                }),
            },
        });
    },
});

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => {
        itemSpy(props);
        return React.createElement(React.Fragment, null);
    },
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/ui/lists/ItemGroupTitleWithAction', () => ({ ItemGroupTitleWithAction: () => null }));
vi.mock('@/components/ui/lists/ItemList', () => ({ ItemList: ({ children }: any) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/ui/forms/MultiTextInput', () => ({ MultiTextInput: () => null }));
vi.mock('@/components/ui/pathBrowser/PathInputBrowseButton', () => ({
    PathInputBrowseButton: () => null,
}));
vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: vi.fn(async () => null),
}));
vi.mock('@/components/ui/forms/Switch', () => ({ Switch: () => null }));
vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));
vi.mock('@/components/machines/InstallableDepInstaller', () => ({ InstallableDepInstaller: () => null }));
vi.mock('@/components/sessions/runs/ExecutionRunRow', () => ({ ExecutionRunRow: () => null }));

vi.mock('@/sync/api/session/apiSocket', () => ({ apiSocket: { emitWithAck: metadataTransportSpy } }));

vi.mock('@/sync/ops', async () => ({
    machineSpawnNewSession: vi.fn(async () => ({ type: 'error', errorCode: 'unexpected', errorMessage: 'noop' })),
    machineStopDaemon: vi.fn(async () => ({ message: 'noop' })),
    machineStopSession: vi.fn(async () => ({ ok: true })),
    // Keep metadata serialization, concurrency, retry and projection updates real beneath the socket boundary.
    machineUpdateMetadata: (await import('@/sync/ops/machines')).machineUpdateMetadata,
    machineExecutionRunsList: vi.fn(async () => ({ ok: true, runs: [] })),
    machineClearReplacementFromAccount: clearReplacementSpy,
    machineReplaceInAccount: replaceSpy,
    machineRevokeFromAccount: revokeSpy,
    machineRevokeWithProviderCleanup: coordinatorSpy,
}));

vi.mock('@/sync/ops/sessionExecutionRuns', () => ({
    sessionExecutionRunStop: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/hooks/session/useNavigateToSession', () => ({ useNavigateToSession: () => () => {} }));
vi.mock('@/hooks/ui/useMountedShouldContinue', () => ({
    useMountedShouldContinue: () => () => true,
}));
vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({ useMachineCapabilitiesCache: () => ({ state: { status: 'idle' }, refresh: vi.fn() }) }));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>();
    return {
        ...actual,
        areServerProfileIdentifiersEquivalent: (left: unknown, right: unknown) => String(left ?? '').trim() === String(right ?? '').trim(),
        getActiveServerId: () => 'server-a',
        getActiveServerSnapshot: () => ({
            serverId: 'server-a',
            serverUrl: 'https://server-a.example.test',
            generation: 1,
        }),
    };
});
vi.mock('@/sync/domains/server/activeServerSwitch', () => ({ setActiveServerAndSwitch: vi.fn(async () => true) }));
vi.mock('@/sync/sync', () => ({ sync: {
    mutateAccountSettings: mutateAccountSettingsSpy,
    refreshMachinesThrottled: refreshMachinesThrottledSpy,
    refreshMachines: refreshMachinesSpy,
    retryNow: vi.fn(),
} }));
vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>, options?: { onError?: (error: unknown) => void }) => {
        void promise.catch((error) => {
            options?.onError?.(error);
        });
    },
}));
vi.mock('@/utils/errors/daemonUnavailableAlert', () => ({
    tryShowDaemonUnavailableAlertForRpcError: () => false,
    tryShowDaemonUnavailableAlertForRpcFailure: () => false,
}));
vi.mock('@/utils/sessions/machineUtils', () => ({ isMachineOnline: () => true }));
vi.mock('@/utils/sessions/sessionUtils', () => ({ formatOSPlatform: (platform?: string) => platform ?? '', formatPathRelativeToHome: () => '', getSessionName: () => '', getSessionSubtitle: () => '' }));
vi.mock('@/utils/path/pathUtils', () => ({ resolveAbsolutePath: () => '' }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionConsole', () => ({ resolveWindowsRemoteSessionConsoleFromMachineMetadata: () => 'visible' }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionLaunchMode', () => ({
    readMachineWindowsRemoteSessionLaunchMode: () => undefined,
    resolveEffectiveWindowsRemoteSessionLaunchMode: () => ({ mode: 'visible' }),
}));
vi.mock('@/capabilities/installablesRegistry', () => ({ getInstallablesRegistryEntries: () => [] }));
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: () => null,
}));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionLaunchModeOptions', () => ({
    WINDOWS_REMOTE_SESSION_LAUNCH_MODE_OPTIONS: [],
}));
vi.mock('@/sync/ops/sessionMachineTarget', () => ({
    readMachineTargetForSession: () => null,
}));

type RenderedScreen = Awaited<ReturnType<typeof renderScreen>>;

async function renderScreen(element: React.ReactElement) {
    const { AppPaneProvider } = await import('@/components/appShell/panes/AppPaneProvider');
    return renderScreenWithProviders(React.createElement(AppPaneProvider, null, element));
}

/** The page's closing destructive button (a quiet button row, not a row in a sheet). */
function findRemoveMachineButton(screen: RenderedScreen) {
    return screen.findAll((node) => node.props?.testID === 'machine-detail-remove' && typeof node.props?.onPress === 'function')[0]?.props;
}

/** A rare operation in the page header's `⋯` menu, by its test id. */
function findHeaderMenuAction(screen: RenderedScreen, testID: string) {
    const menus = screen.findAll((node) => node.props?.testID === 'machine-detail-menu' && Array.isArray(node.props?.actions));
    return menus.flatMap((menu) => menu.props.actions as any[]).find((action) => action.testID === testID);
}

describe('MachineDetailScreen (revoke/forget machine)', () => {
    beforeEach(async () => {
        await loadSyncSingletonForTests();
        itemSpy.mockReset();
        showSpy.mockReset();
        confirmSpy.mockReset();
        coordinatorSpy.mockClear();
        coordinatorSpy.mockImplementation(async (_machineId: string, dependencies: any) => {
            await dependencies.mutateAccountSettings((raw: Record<string, unknown>) => raw);
            return { ok: true as const, machineAlreadyRevoked: false, providerCleanup: 'complete' as const };
        });
        alertSpy.mockReset();
        promptSpy.mockReset();
        promptSpy.mockResolvedValue(null);
        routeParams.id = 'machine-1';
        routeParams.serverId = undefined;
        metadataTransportSpy.mockReset();
        metadataTransportSpy.mockResolvedValue({ result: 'success', version: 2, metadata: 'server-plain' });
        refreshMachinesSpy.mockReset();
        stackOptionsState.current = null;
        mutateAccountSettingsSpy.mockReset();
        mutateAccountSettingsSpy.mockImplementation(async (mutate: (raw: Record<string, unknown>) => Record<string, unknown>) => {
            mutate({ providerSettingsV1: undefined });
        });
        clearReplacementSpy.mockReset();
        replaceSpy.mockReset();
        refreshMachinesThrottledSpy.mockReset();
        revokeSpy.mockReset();
        routerBackSpy.mockReset();
        machineState.currentMachine = {
            id: 'machine-1',
            active: true,
            activeAt: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 0,
            metadata: { displayName: 'My Machine', host: 'host', platform: 'darwin' },
            metadataVersion: 1,
            daemonState: null,
            daemonStateVersion: 0,
            revokedAt: null,
            storageMode: 'plain',
        };
        machineState.machinesByServerId = {
            'server-a': [
                machineState.currentMachine,
                {
                    id: 'machine-2',
                    active: true,
                    activeAt: Date.now(),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    seq: 0,
                    metadata: { displayName: 'Replacement Machine', host: 'replacement', platform: 'darwin' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                    revokedAt: null,
                },
            ],
        };
        machineState.settings = { providerSettingsV1: undefined };
    });

    it('updates the visible machine name only after saving the inline rename draft', async () => {
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        // Rename is one of the header's `⋯` actions (entity-header anatomy: presence, then `⋯`).
        expect(screen.findAll((node) => node.props?.testID === 'machine-detail-rename' && typeof node.props?.onPress === 'function')).toHaveLength(0);
        const menu = screen.findAll((node) => node.props?.testID === 'machine-detail-menu' && typeof node.props?.onSelect === 'function')[0];
        expect(menu).toBeTruthy();

        await act(async () => {
            await menu.props.onSelect('rename');
        });
        expect(screen.findByTestId('machine-detail-name-input')?.props.value).toBe('My Machine');
        await act(async () => screen.changeTextByTestId('machine-detail-name-input', '  theo-devbox  '));
        expect(metadataTransportSpy).not.toHaveBeenCalled();
        expect(promptSpy).not.toHaveBeenCalled();
        await screen.pressByTestIdAsync('machine-detail-name-save');
        const request = metadataTransportSpy.mock.calls[0]?.[1];
        expect(request).toMatchObject({ machineId: 'machine-1', expectedVersion: 1 });
        expect(decodePlainMachineStoredContent(request!.metadata)).toMatchObject({ displayName: 'theo-devbox', host: 'host' });
        expect(machineState.currentMachine.metadata.displayName).toBe('theo-devbox');
        expect(machineState.currentMachine.metadataVersion).toBe(2);
        expect(screen.findByTestId('machine-detail-name-input')).toBeNull();
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('cancels and retires the inline rename draft when the machine identity changes', async () => {
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        await act(async () => findHeaderMenuAction(screen, 'machine-detail-menu-rename').onSelect());
        expect(screen.findByTestId('machine-detail-name-input')).toBeTruthy();
        await act(async () => screen.changeTextByTestId('machine-detail-name-input', 'not saved'));
        await screen.pressByTestIdAsync('machine-detail-name-cancel');
        expect(screen.findByTestId('machine-detail-name-input')).toBeNull();
        await act(async () => findHeaderMenuAction(screen, 'machine-detail-menu-rename').onSelect());
        expect(screen.findByTestId('machine-detail-name-input')?.props.value).toBe('My Machine');
        routeParams.id = 'machine-2';
        machineState.currentMachine = machineState.machinesByServerId['server-a']![1];
        const { AppPaneProvider } = await import('@/components/appShell/panes/AppPaneProvider');
        await screen.update(React.createElement(AppPaneProvider, null, React.createElement(MachineDetailScreen)));
        expect(screen.findByTestId('machine-detail-name-input')).toBeNull();
        await act(async () => findHeaderMenuAction(screen, 'machine-detail-menu-rename').onSelect());
        expect(screen.findByTestId('machine-detail-name-input')?.props.value).toBe('Replacement Machine');
        // The same machine id on another Home is a different editing target.
        routeParams.serverId = 'server-b';
        await screen.update(React.createElement(AppPaneProvider, null, React.createElement(MachineDetailScreen)));
        expect(screen.findByTestId('machine-detail-name-input')).toBeNull();
        expect(metadataTransportSpy).not.toHaveBeenCalled();
    });

    it('keeps the inline rename draft available after a save error and refreshes machine metadata', async () => {
        metadataTransportSpy.mockRejectedValueOnce(new Error('rename transport failed'));
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        await act(async () => findHeaderMenuAction(screen, 'machine-detail-menu-rename').onSelect());
        expect(screen.findByTestId('machine-detail-name-input')).toBeTruthy();
        await act(async () => screen.changeTextByTestId('machine-detail-name-input', 'Retry name'));
        await screen.pressByTestIdAsync('machine-detail-name-save');
        expect(alertSpy).toHaveBeenCalledWith('common.error', 'rename transport failed');
        expect(refreshMachinesSpy).toHaveBeenCalled();
        expect(screen.findByTestId('machine-detail-name-input')?.props.value).toBe('Retry name');
        expect(screen.findByTestId('machine-detail-name-input')?.props.editable).toBe(true);
    });

    it('clears a custom machine name by saving an empty inline rename draft', async () => {
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        await act(async () => findHeaderMenuAction(screen, 'machine-detail-menu-rename').onSelect());
        expect(screen.findByTestId('machine-detail-name-input')).toBeTruthy();
        await act(async () => screen.changeTextByTestId('machine-detail-name-input', '  '));
        await screen.pressByTestIdAsync('machine-detail-name-save');
        expect(machineState.currentMachine.metadata.displayName).toBeUndefined();
        const request = metadataTransportSpy.mock.calls[0]?.[1];
        expect(request).toMatchObject({ machineId: 'machine-1', expectedVersion: 1 });
        expect(decodePlainMachineStoredContent(request!.metadata)).not.toHaveProperty('displayName');
    });

    it('confirms and revokes the machine', async () => {
        confirmSpy.mockResolvedValueOnce(true);

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        const removeItem = findRemoveMachineButton(screen);
        expect(removeItem).toBeTruthy();
        expect(typeof removeItem.onPress).toBe('function');

        await act(async () => {
            await removeItem.onPress();
        });

        expect(confirmSpy).toHaveBeenCalled();
        expect(coordinatorSpy).toHaveBeenCalledWith('machine-1', expect.objectContaining({
            revoke: revokeSpy,
            mutateAccountSettings: expect.any(Function),
        }));
        expect(mutateAccountSettingsSpy).toHaveBeenCalledTimes(1);
        expect(refreshMachinesThrottledSpy).toHaveBeenCalled();
        expect(routerBackSpy).toHaveBeenCalled();
    });

    it('keeps the user on the screen and explains retry when Provider cleanup remains pending', async () => {
        coordinatorSpy
            .mockResolvedValueOnce({
                ok: false as const,
                status: 503,
                error: 'provider_cleanup_pending',
                machineRevoked: true as const,
                providerCleanup: 'pending' as const,
                retryable: true as const,
            })
            .mockResolvedValueOnce({
                ok: true as const,
                machineAlreadyRevoked: true,
                providerCleanup: 'complete' as const,
            });
        refreshMachinesThrottledSpy.mockImplementation(async () => {
            machineState.currentMachine = { ...machineState.currentMachine, revokedAt: Date.now() };
        });

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        const removeItem = findRemoveMachineButton(screen);

        await act(async () => {
            await removeItem.onPress();
        });

        expect(alertSpy).toHaveBeenCalledWith(
            'common.error',
            'settingsProviders.errors.machineCleanupPendingDescription',
        );
        expect(refreshMachinesThrottledSpy).toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();

        const retryItem = findRemoveMachineButton(screen);
        expect(retryItem.disabled).toBe(false);
        await act(async () => {
            await retryItem.onPress();
        });

        expect(coordinatorSpy).toHaveBeenCalledTimes(2);
        expect(routerBackSpy).toHaveBeenCalledTimes(1);
    });

    it('restores cleanup retry actionability from durable Provider machine state after remount', async () => {
        machineState.currentMachine = { ...machineState.currentMachine, revokedAt: Date.now() };
        machineState.machinesByServerId = { 'server-a': [machineState.currentMachine] };
        machineState.settings = {
            providerSettingsV1: {
                v: 1,
                connections: [{
                    v: 1,
                    id: 'pc_a',
                    source: { kind: 'contribution', contributionKey: 'plugin/gateway' },
                    role: 'default',
                    displayName: 'Gateway',
                    displayNameMode: 'automatic',
                    revision: 0,
                    createdAt: 1,
                    updatedAt: 1,
                }],
                connectionTombstones: [],
                accountGrants: [],
                machineGrants: [{
                    v: 1,
                    machineId: 'machine-1',
                    connectionId: 'pc_a',
                    endpointSetFingerprint: 'endpoint-set:v1:a',
                    connectionSecurityFingerprint: 'connection-security:v1:a',
                    confirmedAt: 1,
                }],
                secretBindingsByConnectionId: {},
                manualModelsByConnectionId: {},
                modelVisibilityByRef: {},
                defaultsByAgentTargetKey: {},
                experimentalBindingConfirmations: [],
            },
        };

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        const retryItem = findRemoveMachineButton(screen);

        // The consequence under the button explains that removal can be retried.
        expect(screen.getTextContent()).toContain('settingsProviders.errors.machineCleanupPendingDescription');
        expect(retryItem.disabled).toBe(false);
        await act(async () => { await retryItem.onPress(); });
        expect(coordinatorSpy).toHaveBeenCalledOnce();
    });

    it('renders one replacement repair action that opens a candidate picker', async () => {
        machineState.machinesByServerId = {
            'server-a': [
                machineState.currentMachine,
                ...Array.from({ length: 5 }, (_, index) => ({
                    id: `machine-${index + 2}`,
                    active: index === 0,
                    activeAt: Date.now() - index,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    seq: 0,
                    metadata: { displayName: index % 2 === 0 ? 'leeroy-mbp' : 'L-C-005', host: 'replacement', platform: 'darwin' },
                    metadataVersion: 1,
                    daemonState: null,
                    daemonStateVersion: 0,
                    revokedAt: null,
                })),
            ],
        };

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        expect(findHeaderMenuAction(screen, 'machine-replacement-repair-undo')).toBeUndefined();
        const replacementItem = findHeaderMenuAction(screen, 'machine-replacement-repair-open');
        expect(replacementItem).toBeTruthy();

        await act(async () => {
            await replacementItem.onSelect();
        });

        expect(showSpy).toHaveBeenCalledTimes(1);
        const showOptions = showSpy.mock.calls[0]?.[0];
        expect(showOptions).toMatchObject({
            props: expect.objectContaining({
                onSelectCandidate: expect.any(Function),
            }),
            chrome: expect.objectContaining({
                testID: 'machine-replacement-picker-modal',
                scrollHost: 'body',
            }),
        });
        expect(showOptions?.chrome).not.toHaveProperty('layout');
        expect(showOptions?.props?.candidates).toHaveLength(5);
        // Same-named candidates are told apart by the machine naming owner.
        const labels = (showOptions?.props?.candidates as Array<{ label: string }>).map((candidate) => candidate.label);
        expect(new Set(labels).size).toBe(5);
        expect(replaceSpy).not.toHaveBeenCalled();
    });

    it('opens the replacement picker with candidates regardless of spawn readiness', async () => {
        machineState.machinesByServerId['server-a'] = machineState.machinesByServerId['server-a']!.map((machine) =>
            machine.id === 'machine-2'
                ? { ...machine, active: false, activeAt: 0 }
                : machine,
        );
        machineState.machinesByServerId['server-loading'] = null;

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        const replacementItem = findHeaderMenuAction(screen, 'machine-replacement-repair-open');
        expect(replacementItem).toBeTruthy();

        await act(async () => {
            await replacementItem.onSelect();
        });

        expect(showSpy.mock.calls[0]?.[0]?.props?.candidates).toEqual([
            expect.objectContaining({ id: 'machine-2' }),
        ]);
    });

    it('selects a replacement candidate from the picker', async () => {
        confirmSpy.mockResolvedValueOnce(true);

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        const replacementItem = findHeaderMenuAction(screen, 'machine-replacement-repair-open');
        expect(replacementItem).toBeTruthy();

        await act(async () => {
            await replacementItem.onSelect();
            await showSpy.mock.calls[0]?.[0]?.props?.onSelectCandidate('machine-2', 'Replacement Machine');
        });

        expect(confirmSpy).toHaveBeenCalled();
        expect(replaceSpy).toHaveBeenCalledWith({
            oldMachineId: 'machine-1',
            replacementMachineId: 'machine-2',
            confirmActiveOldMachine: true,
        });
        expect(refreshMachinesThrottledSpy).toHaveBeenCalled();
    });

    it('names an unnamed replacement as unnamed, never by its id', async () => {
        machineState.machinesByServerId['server-a'] = machineState.machinesByServerId['server-a']!.map((machine) =>
            machine.id === 'machine-2' ? { ...machine, metadata: { platform: 'darwin' } } : machine,
        );
        machineState.currentMachine = { ...machineState.currentMachine, replacedByMachineId: 'machine-2' };
        machineState.machinesByServerId['server-a'] = machineState.machinesByServerId['server-a']!.map((machine) =>
            machine.id === 'machine-1' ? machineState.currentMachine : machine,
        );

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        const text = screen.getTextContent();
        expect(text).toContain('machineDetailPage.replacedByFact(machine=machine.unnamedMachine)');
        expect(text).not.toContain('machine=machine-2');
    });

    it('clears an existing explicit replacement relation', async () => {
        confirmSpy.mockResolvedValueOnce(true);
        machineState.currentMachine = {
            ...machineState.currentMachine,
            replacedByMachineId: 'machine-2',
        };

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');

        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        // The replaced state is a header fact, and undoing it is a rare operation in `⋯`.
        expect(screen.getTextContent()).toContain('machineDetailPage.replacedByFact');
        const undoItem = findHeaderMenuAction(screen, 'machine-replacement-repair-undo');
        expect(undoItem).toBeTruthy();

        await act(async () => {
            await undoItem.onSelect();
        });

        expect(confirmSpy).toHaveBeenCalled();
        expect(clearReplacementSpy).toHaveBeenCalledWith('machine-1');
        expect(refreshMachinesThrottledSpy).toHaveBeenCalled();
    });
});
