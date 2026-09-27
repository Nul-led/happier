import React from 'react';
import { act } from 'react-test-renderer';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installMachineDetailsCommonModuleMocks } from './machineDetailsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).expo = { EventEmitter: class {} };

const refreshMachinesSpy = vi.fn(async () => {});
const machineState = vi.hoisted(() => ({
    machine: null as null | {
        id: string;
        active: boolean;
        activeAt: number;
        createdAt: number;
        updatedAt: number;
        seq: number;
        metadata: { displayName: string; host: string; platform: string; homeDir?: string };
        metadataVersion: number;
        daemonState: null;
        daemonStateVersion: number;
        revokedAt: null;
    },
}));

installMachineDetailsCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
            params: { id: 'machine-missing' },
        }).module;
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            storage: {
                getState: () => ({
                    settings: {},
                    sessions: {},
                    machines: {},
                    getProjectForSession: () => null,
                }),
            },
            useSessions: () => [],
            useAllMachines: () => [],
            useMachine: () => machineState.machine,
            useIsDataReady: () => false,
            useSetting: () => false,
            useSettingMutable: () => [null, vi.fn()],
            useSettings: () => ({}),
        });
    },
});

vi.mock('@/components/ui/lists/Item', () => ({ Item: () => null }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: ({ children }: React.PropsWithChildren<Record<string, never>>) => React.createElement(React.Fragment, null, children) }));
vi.mock('@/components/ui/lists/ItemGroupTitleWithAction', () => ({ ItemGroupTitleWithAction: () => null }));
// A host element that keeps its props, so the page's pull-to-refresh control is observable.
vi.mock('@/components/ui/lists/ItemList', () => ({ ItemList: (props: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('ItemList', props, props.children) }));
vi.mock('@/components/ui/forms/MultiTextInput', () => ({ MultiTextInput: () => null }));
vi.mock('@/components/ui/pathBrowser/PathInputBrowseButton', () => ({ PathInputBrowseButton: () => null }));
vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({ openMachinePathBrowserModal: vi.fn(async () => null) }));
vi.mock('@/components/machines/DetectedClisList', () => ({ DetectedClisList: () => null }));
vi.mock('@/components/ui/forms/Switch', () => ({ Switch: () => null }));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text', TextInput: 'TextInput' }));
vi.mock('@/components/machines/InstallableDepInstaller', () => ({ InstallableDepInstaller: () => null }));
vi.mock('@/components/sessions/runs/ExecutionRunRow', () => ({ ExecutionRunRow: () => null }));
vi.mock('@/hooks/session/useNavigateToSession', () => ({ useNavigateToSession: () => () => {} }));
vi.mock('@/hooks/ui/useMountedShouldContinue', () => ({ useMountedShouldContinue: () => () => true }));
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
vi.mock('@/sync/sync', () => ({ sync: { refreshMachinesThrottled: vi.fn(), refreshMachines: refreshMachinesSpy, retryNow: vi.fn() } }));
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
vi.mock('@/utils/sessions/machineUtils', () => ({ isMachineOnline: (machine: { active?: boolean }) => machine.active === true }));
vi.mock('@/utils/sessions/sessionUtils', () => ({ formatOSPlatform: (platform?: string) => platform ?? '', formatPathRelativeToHome: () => '', getSessionName: () => '', getSessionSubtitle: () => '' }));
vi.mock('@/utils/path/pathUtils', () => ({ resolveAbsolutePath: () => '' }));
vi.mock('@/sync/domains/settings/terminalSettings', () => ({ resolveTerminalSpawnOptions: () => ({}) }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionConsole', () => ({ resolveWindowsRemoteSessionConsoleFromMachineMetadata: () => 'visible' }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionLaunchMode', () => ({
    readMachineWindowsRemoteSessionLaunchMode: () => undefined,
    resolveEffectiveWindowsRemoteSessionLaunchMode: () => ({ mode: 'visible' }),
}));
vi.mock('@/capabilities/installablesRegistry', () => ({ getInstallablesRegistryEntries: () => [] }));
vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({ DropdownMenu: () => null }));
vi.mock('@/sync/domains/session/spawn/windowsRemoteSessionLaunchModeOptions', () => ({
    WINDOWS_REMOTE_SESSION_LAUNCH_MODE_OPTIONS: [],
}));
vi.mock('@/sync/ops/sessionMachineTarget', () => ({
    readMachineTargetForSession: () => null,
}));
vi.mock('@/sync/ops', () => ({
    machineSpawnNewSession: vi.fn(async () => ({ type: 'error', errorCode: 'unexpected', errorMessage: 'noop' })),
    machineStopDaemon: vi.fn(async () => ({ message: 'noop' })),
    machineStopSession: vi.fn(async () => ({ ok: true })),
    machineUpdateMetadata: vi.fn(async () => ({})),
    machineExecutionRunsList: vi.fn(async () => ({ ok: true, runs: [] })),
    machineRevokeFromAccount: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/sync/ops/sessionExecutionRuns', () => ({
    sessionExecutionRunStop: vi.fn(async () => ({ ok: true })),
}));

describe('MachineDetailScreen hydration', () => {
    it('keeps the screen in loading while missing machine data is refreshed', async () => {
        machineState.machine = null;
        refreshMachinesSpy.mockClear();
        let resolveRefresh: (() => void) | null = null;
        refreshMachinesSpy.mockReturnValueOnce(new Promise<void>((resolve) => {
            resolveRefresh = resolve;
        }));

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));

        await flushHookEffects({ cycles: 2, turns: 1 });

        expect(screen.getTextContent()).toContain('common.loading');
        expect(screen.getTextContent()).not.toContain('machine.notFound');
        expect(refreshMachinesSpy).toHaveBeenCalled();
        // The page keeps its identity while it loads: a header, not a bare spinner.
        expect(screen.findAllByProps({ testID: 'machine-detail-header' }).length).toBeGreaterThan(0);

        await act(async () => {
            machineState.machine = {
                id: 'machine-missing',
                active: true,
                activeAt: Date.now(),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                seq: 1,
                metadata: { displayName: 'Recovered Machine', host: 'host', platform: 'darwin' },
                metadataVersion: 1,
                daemonState: null,
                daemonStateVersion: 0,
                revokedAt: null,
            };
            resolveRefresh?.();
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        expect(screen.getTextContent()).not.toContain('common.loading');
        expect(screen.getTextContent()).not.toContain('machine.notFound');
    });

    it('shows the page header with the not-found state when the machine does not exist', async () => {
        machineState.machine = null;
        refreshMachinesSpy.mockClear();
        refreshMachinesSpy.mockReturnValueOnce(Promise.resolve());

        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        await flushHookEffects({ cycles: 3, turns: 2 });

        expect(screen.getTextContent()).toContain('machine.notFound');
        expect(screen.findAllByProps({ testID: 'machine-detail-header' }).length).toBeGreaterThan(0);
    });

    it('retries an unavailable machine without running the pull-to-refresh spinner', async () => {
        let resolveRefresh: (() => void) | null = null;
        machineState.machine = {
            id: 'machine-missing',
            active: false,
            activeAt: Date.now() - 86_400_000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: { displayName: 'Offline Machine', host: 'host', platform: 'darwin' },
            metadataVersion: 1,
            daemonState: null,
            daemonStateVersion: 0,
            revokedAt: null,
        };
        const { default: MachineDetailScreen } = await import('@/app/(app)/machine/[id]');
        const screen = await renderScreen(React.createElement(MachineDetailScreen));
        await flushHookEffects({ cycles: 2, turns: 1 });

        // The banner component itself (the first node carrying its testID) holds its action.
        const banner = () => screen.findAllByProps({ testID: 'machine-detail-unavailable' })[0]!;
        const pullToRefresh = () => (screen.findAllByType('ItemList' as never)[0]!.props.refreshControl as React.ReactElement<{ refreshing: boolean }>).props.refreshing;
        expect(banner().props.action.loading).toBeFalsy();

        refreshMachinesSpy.mockClear();
        refreshMachinesSpy.mockReturnValueOnce(new Promise<void>((resolve) => {
            resolveRefresh = resolve;
        }));
        await act(async () => {
            banner().props.action.onPress();
            await flushHookEffects({ cycles: 1, turns: 1 });
        });

        // The banner's own action shows the retry; the list's pull-to-refresh control stays idle.
        expect(refreshMachinesSpy).toHaveBeenCalled();
        expect(banner().props.action.loading).toBe(true);
        expect(pullToRefresh()).toBe(false);

        await act(async () => {
            resolveRefresh?.();
            await flushHookEffects({ cycles: 2, turns: 1 });
        });
        expect(banner().props.action.loading).toBe(false);
    });
});
