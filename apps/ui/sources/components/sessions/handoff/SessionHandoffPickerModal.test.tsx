import * as React from 'react';
import { act, ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeTestInstanceHandler, renderScreen } from '@/dev/testkit';
import { installSessionHandoffCommonModuleMocks } from './sessionHandoffTestHelpers';
import type { CustomModalChromeConfig } from '@/modal';

const refreshMachinesThrottledMock = vi.fn(async () => {});
const openMachinePathBrowserModalMock = vi.fn<(params: unknown) => Promise<string>>(async () => '/home/leeroy.guest/.happier-stack/workspace/0.3');
const pathBrowserModuleLoadedMock = vi.fn();
let credentialsReady = true;


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settingsState: Record<string, any> = {};
let machineListByServerIdState: Record<string, any> = {};
let allMachinesState: any[] = [];
let sessionsState: any[] = [];
let sessionsByIdState: Record<string, any> = {};

type CardChrome = Extract<CustomModalChromeConfig, { kind: 'card' }>;

function requireCardChrome(chrome: CustomModalChromeConfig | null): CardChrome {
    if (chrome?.kind !== 'card') {
        throw new Error('expected card chrome to be set');
    }
    return chrome;
}

function findElementByTestId(node: React.ReactNode, testID: string): React.ReactElement | null {
    if (!node) return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElementByTestId(child, testID);
            if (found) return found;
        }
        return null;
    }

    if (!React.isValidElement(node)) {
        return null;
    }

    const props = node.props as Record<string, unknown> & { children?: React.ReactNode; testID?: string };
    if (props.testID === testID) return node;
    return findElementByTestId(props.children, testID);
}

vi.mock('@happier-dev/protocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
    return {
        ...actual,
        getActionSpec: () => ({ id: 'session.handoff', title: 'session.handoff.title', description: 'session.handoff.description' }),
    };
});

installSessionHandoffCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useMachineListByServerId: () => machineListByServerIdState,
            useMachineRecordValues: () => allMachinesState,
            useAllSessionListRenderables: () => sessionsState,
            useSession: (id: string) => sessionsByIdState[id] ?? null,
            useSessionListRenderable: (id: string) => sessionsState.find((session) => session?.id === id) ?? null,
            useSettingMutable: (key: string) => [
                settingsState[key],
                (next: any) => {
                    settingsState[key] = next;
                },
            ],
        });
    },
});

vi.mock('@/components/sessions/new/components/MachineSelector', () => ({
    MachineSelector: (props: any) => React.createElement('MachineSelector', props),
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: (props: any) => React.createElement('ItemList', props, props.children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: any) => React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props, props.rightElement ?? null, props.children ?? null),
}));

vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: (props: any) => React.createElement('RoundButton', props),
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/utils/sessions/recentMachines', () => ({
    getRecentMachinesFromSessions: () => [],
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshMachinesThrottled: refreshMachinesThrottledMock,
        getCredentials: () => (credentialsReady ? ({ token: 'test' } as any) : null),
    },
}));

vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => {
    pathBrowserModuleLoadedMock();
    return {
        openMachinePathBrowserModal: (params: unknown) => openMachinePathBrowserModalMock(params),
    };
});

describe('SessionHandoffPickerModal', () => {
    beforeEach(() => {
        refreshMachinesThrottledMock.mockClear();
        openMachinePathBrowserModalMock.mockClear();
        credentialsReady = true;
        machineListByServerIdState = {
            server_a: [
                {
                    id: 'machine_target',
                    active: true,
                    activeAt: Date.now(),
                    metadata: { displayName: 'Target machine', host: 'target.local' },
                },
            ],
        };
        allMachinesState = [
            {
                id: 'machine_target',
                active: true,
                activeAt: Date.now(),
                metadata: { displayName: 'Target machine', host: 'target.local' },
            },
        ];
        sessionsByIdState = {
            sess_1: {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '~/projects/happier',
                    homeDir: '/Users/tester',
                    externalSessionV1: {
                        v: 1,
                        agentId: 'claude',
                        machineId: 'machine_source',
                        remoteSessionId: 'claude_session_1',
                        source: { kind: 'claudeConfig', configDir: '/Users/tester/.claude' },
                    },
                },
            },
        };
        sessionsState = [
            {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    // Session list view may format the path relative to home; the picker must use the canonical
                    // session record path for safety decisions (not the display string).
                    path: '~',
                    homeDir: '/Users/tester',
                    externalSessionV1: {
                        v: 1,
                        agentId: 'claude',
                        machineId: 'machine_source',
                        remoteSessionId: 'claude_session_1',
                        source: { kind: 'claudeConfig', configDir: '/Users/tester/.claude' },
                    },
                },
            },
        ];
        settingsState.favoriteMachines = [];
        settingsState.favoriteDirectories = [];
        settingsState.recentMachinePaths = [];
        settingsState.sessionHandoffDefaultsV1 = {
            v: 1,
            workspaceSyncMode: 'copy_once',
            workspaceSyncRelationshipId: null,
            includeIgnoredMode: 'include_selected',
            ignoredIncludeGlobs: ['dist/**'],
            directTargetMode: 'convert_to_persisted',
        };
    });

    it('does not load the target path browser until the user asks to choose a directory', async () => {
        await import('./SessionHandoffPickerModal');

        expect(pathBrowserModuleLoadedMock).not.toHaveBeenCalled();
    });

    it('returns the selected machine and default handoff options', async () => {
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        let chrome: CustomModalChromeConfig | null = null;
        const setChrome = vi.fn((next: CustomModalChromeConfig | null) => {
            chrome = next;
        });

        let tree!: ReactTestRenderer;
        tree = (await renderScreen(<SessionHandoffPickerModal
                    onClose={onClose}
                    setChrome={setChrome}
                    onResolve={onResolve}
                    sessionId="sess_1"
                    sourceMachineId="machine_source"
                    serverId="server_a"
                />)).tree;

        await act(async () => {});
        expect(refreshMachinesThrottledMock).toHaveBeenCalled();

        const machineSelector = tree.findByType('MachineSelector' as any);
        expect(machineSelector.props.testIdPrefix).toBe('session-handoff-machine');
        expect(machineSelector.props.presentation).toBe('dropdown');
        expect(machineSelector.props.showSearch).toBe(true);
        expect(machineSelector.props.dropdownTestID).toBe('session-handoff-machine-dropdown-trigger');
        await act(async () => {
            invokeTestInstanceHandler(machineSelector, 'onSelect', { id: 'machine_target', metadata: { displayName: 'Target machine' } });
        });

        const footer = requireCardChrome(chrome).footer;
        const startButton = findElementByTestId(footer, 'session-handoff-start');
        expect(startButton).toBeTruthy();
        await act(async () => {
            const onPress = (startButton!.props as { onPress?: () => unknown }).onPress;
            if (typeof onPress !== 'function') {
                throw new Error('expected start button to have an onPress handler');
            }
            await onPress();
        });

        expect(onResolve).toHaveBeenCalledWith({
            targetMachineId: 'machine_target',
            sourceRootPath: '~/projects/happier',
            targetSessionStorageMode: 'persisted',
            workspaceAction: {
                kind: 'copy_once',
                contentPolicy: {
                    v: 1,
                    selection: 'git_worktree',
                    extraIgnorePatterns: [],
                    extraIncludePatterns: ['dist/**'],
                    includeGitDirectory: false,
                    policyDigest: expect.any(String),
                },
            },
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('offers creation of the first persistent relationship without seeded settings state', async () => {
        settingsState.sessionHandoffDefaultsV1 = {
            v: 1,
            workspaceSyncMode: 'keep_synced',
            workspaceSyncRelationshipId: null,
            includeIgnoredMode: 'exclude',
            ignoredIncludeGlobs: [],
            directTargetMode: 'convert_to_persisted',
        };
        settingsState.workspaceSyncRelationshipsV1 = [];
        const onResolve = vi.fn();
        let chrome: CustomModalChromeConfig | null = null;
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        const screen = await renderScreen(<SessionHandoffPickerModal
            onClose={vi.fn()}
            setChrome={(next) => { chrome = next; }}
            onResolve={onResolve}
            sessionId="sess_1"
            sourceMachineId="machine_source"
            serverId="server_a"
        />);

        await act(async () => {
            invokeTestInstanceHandler(screen.tree.findByType('MachineSelector' as any), 'onSelect', {
                id: 'machine_target',
                active: true,
                metadata: { displayName: 'Target machine', homeDir: '/home/target' },
            });
            screen.changeTextByTestId('path-selection-list:header:input', '/home/target/happier');
        });

        const startButton = findElementByTestId(requireCardChrome(chrome).footer, 'session-handoff-start');
        expect(startButton?.props.disabled).toBe(false);
        await act(async () => {
            await (startButton!.props as { onPress: () => unknown }).onPress();
        });

        expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({
            targetMachineId: 'machine_target',
            targetPath: '/home/target/happier',
            workspaceSyncRelationshipIntent: expect.objectContaining({ mode: 'keep_synced' }),
        }));
    });

    it('reuses the editable recent-path picker and opens its browser only on Browse', async () => {
        const onResolve = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        let chrome: CustomModalChromeConfig | null = null;
        const setChrome = vi.fn((next: CustomModalChromeConfig | null) => {
            chrome = next;
        });

        machineListByServerIdState.server_a[0]!.metadata.homeDir = '/home/target';
        allMachinesState[0]!.metadata.homeDir = '/home/target';
        settingsState.recentMachinePaths = [{
            machineId: 'machine_target',
            path: '/home/target/recent-project',
        }];

        const screen = await renderScreen(<SessionHandoffPickerModal
            onClose={vi.fn()}
            setChrome={setChrome}
            onResolve={onResolve}
            sessionId="sess_1"
            sourceMachineId="machine_source"
            serverId="server_a"
        />);

        await act(async () => {
            invokeTestInstanceHandler(screen.tree.findByType('MachineSelector' as any), 'onSelect', {
                id: 'machine_target',
                active: true,
                activeAt: Date.now(),
                metadata: {
                    displayName: 'Target machine',
                    host: 'target.local',
                    homeDir: '/home/target',
                },
            });
        });

        expect(screen.findByTestId('path-selection-list:header:input')).not.toBeNull();
        expect(screen.findByTestId('path-selection-list:path-root:option:recent:/home/target/recent-project')).not.toBeNull();
        await act(async () => {
            screen.changeTextByTestId('path-selection-list:header:input', '/home/target/pasted-project');
        });
        openMachinePathBrowserModalMock.mockResolvedValueOnce('/home/target/browser-project');
        await screen.pressByTestIdAsync('path-selection-list:open-tree-browser');
        expect(openMachinePathBrowserModalMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine_target',
            serverId: 'server_a',
            initialPath: '/home/target/pasted-project',
        }));

        const startButton = findElementByTestId(requireCardChrome(chrome).footer, 'session-handoff-start');
        await act(async () => {
            await (startButton!.props as { onPress: () => unknown }).onPress();
        });
        expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({
            targetMachineId: 'machine_target',
            targetPath: '/home/target/browser-project',
        }));
    });

    it('offers direct target handling for released directSessionV1 metadata', async () => {
        const releasedDirectSessionV1 = {
            v: 1,
            providerId: 'claude',
            machineId: 'machine_source',
            remoteSessionId: 'claude_session_1',
            source: { kind: 'claudeConfig', configDir: '/Users/tester/.claude' },
        };
        sessionsByIdState = {
            sess_1: {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '~/projects/happier',
                    homeDir: '/Users/tester',
                    directSessionV1: releasedDirectSessionV1,
                },
            },
        };
        sessionsState = [{
            id: 'sess_1',
            metadata: {
                flavor: 'claude',
                machineId: 'machine_source',
                path: '~/projects/happier',
                homeDir: '/Users/tester',
                directSessionV1: releasedDirectSessionV1,
            },
        }];

        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        const rendered = await renderScreen(<SessionHandoffPickerModal
            onClose={vi.fn()}
            onResolve={vi.fn()}
            sessionId="sess_1"
            sourceMachineId="machine_source"
            serverId="server_a"
        />);

        const directModeMenu = rendered.tree
            .findAllByType('DropdownMenu' as any)
            .find((node: any) => node.props?.itemTrigger?.title === 'settingsSession.handoff.directTargetMode.title');
        expect(directModeMenu).toBeTruthy();
    });

    it('selects the canonical none action without exposing copy policy controls', async () => {
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        let chrome: CustomModalChromeConfig | null = null;
        const setChrome = vi.fn((next: CustomModalChromeConfig | null) => {
            chrome = next;
        });

        let tree!: ReactTestRenderer;
        tree = (await renderScreen(<SessionHandoffPickerModal
                    onClose={onClose}
                    setChrome={setChrome}
                    onResolve={onResolve}
                    sessionId="sess_1"
                    sourceMachineId="machine_source"
                    serverId="server_a"
                />)).tree;

        await act(async () => {});

        const machineSelector = tree.findByType('MachineSelector' as any);
        await act(async () => {
            invokeTestInstanceHandler(machineSelector, 'onSelect', { id: 'machine_target', metadata: { displayName: 'Target machine' } });
        });

        const modeMenu = tree.findAllByType('DropdownMenu' as any)
            .find((node: any) => node.props?.itemTrigger?.title === 'settingsSession.handoff.workspaceMode.title');
        expect(modeMenu?.props.selectedId).toBe('copy_once');

        await act(async () => {
            invokeTestInstanceHandler(modeMenu!, 'onSelect', 'none');
        });

        const ignoredModeMenu = tree.findAllByType('DropdownMenu' as any)
            .find((node: any) => node.props?.itemTrigger?.title === 'settingsSession.handoff.includeIgnoredMode.title');
        expect(ignoredModeMenu?.props.itemTrigger.itemProps.disabled).toBe(true);
        const globInput = tree.findAllByType('TextInput' as any)
            .find((node: any) => node.props.value === 'dist/**');
        expect(globInput?.props.editable).toBe(false);

        const footer = requireCardChrome(chrome).footer;
        const startButton = findElementByTestId(footer, 'session-handoff-start');
        await act(async () => {
            const onPress = (startButton!.props as { onPress?: () => unknown }).onPress;
            if (typeof onPress !== 'function') {
                throw new Error('expected start button to have an onPress handler');
            }
            await onPress();
        });

        expect(onResolve).toHaveBeenCalledWith({
            targetMachineId: 'machine_target',
            sourceRootPath: '~/projects/happier',
            targetSessionStorageMode: 'persisted',
            workspaceAction: { kind: 'none' },
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('blocks a canonical workspace operation at the machine home while keeping none available', async () => {
        sessionsByIdState = {
            sess_1: {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '/Users/tester',
                    homeDir: '/Users/tester',
                    externalSessionV1: { source: 'claudeConfig' },
                },
            },
        };
        sessionsState = [
            {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '/Users/tester',
                    homeDir: '/Users/tester',
                    externalSessionV1: { source: 'claudeConfig' },
                },
            },
        ];
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        let chrome: CustomModalChromeConfig | null = null;
        const setChrome = vi.fn((next: CustomModalChromeConfig | null) => {
            chrome = next;
        });

        let tree!: ReactTestRenderer;
        tree = (await renderScreen(<SessionHandoffPickerModal
                    onClose={onClose}
                    setChrome={setChrome}
                    onResolve={onResolve}
                    sessionId="sess_1"
                    sourceMachineId="machine_source"
                    serverId="server_a"
                />)).tree;

        const machineSelector = tree.findByType('MachineSelector' as any);
        await act(async () => {
            invokeTestInstanceHandler(machineSelector, 'onSelect', { id: 'machine_target', metadata: { displayName: 'Target machine' } });
        });

        let startButton = findElementByTestId(requireCardChrome(chrome).footer, 'session-handoff-start');
        expect(startButton?.props.disabled).toBe(true);

        const modeMenu = tree.findAllByType('DropdownMenu' as any)
            .find((node: any) => node.props?.itemTrigger?.title === 'settingsSession.handoff.workspaceMode.title');
        expect(modeMenu?.props.selectedId).toBe('copy_once');
        await act(async () => {
            invokeTestInstanceHandler(modeMenu!, 'onSelect', 'none');
        });
        startButton = findElementByTestId(requireCardChrome(chrome).footer, 'session-handoff-start');
        expect(startButton?.props.disabled).toBe(false);

        await act(async () => {
            await (startButton!.props as { onPress: () => unknown }).onPress();
        });
        expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({
            workspaceAction: { kind: 'none' },
        }));
    });

    it('falls back to current session machineId when sourceMachineId prop is missing', async () => {
        sessionsByIdState = {
            sess_1: {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '/Users/tester',
                },
            },
        };
        sessionsState = [
            {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '/Users/tester',
                },
            },
        ];
        machineListByServerIdState = {
            server_a: [
                { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local', homeDir: '/Users/tester' } },
                { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
            ],
        };
        allMachinesState = [
            { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local', homeDir: '/Users/tester' } },
            { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
        ];

        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');

        let tree!: ReactTestRenderer;
        tree = (await renderScreen(<SessionHandoffPickerModal
                    onClose={onClose}
                    onResolve={onResolve}
                    sessionId="sess_1"
                    serverId="server_a"
                />)).tree;

        const machineSelector = tree.findByType('MachineSelector' as any);
        expect(machineSelector.props.machines).toEqual([
            { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
        ]);
    });

    it('prefers the current session machineId over a divergent sourceMachineId prop when filtering picker targets', async () => {
        sessionsByIdState = {
            sess_1: {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '/Users/tester/repo',
                },
            },
        };
        sessionsState = [
            {
                id: 'sess_1',
                metadata: {
                    flavor: 'claude',
                    machineId: 'machine_source',
                    path: '/Users/tester/repo',
                },
            },
        ];
        machineListByServerIdState = {
            server_a: [
                { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local', homeDir: '/Users/tester' } },
                { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
            ],
        };
        allMachinesState = [
            { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local', homeDir: '/Users/tester' } },
            { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
        ];

        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');

        const tree = (await renderScreen(<SessionHandoffPickerModal
                    onClose={onClose}
                    onResolve={onResolve}
                    sessionId="sess_1"
                    sourceMachineId="machine_target"
                    serverId="server_a"
                />)).tree;

        const machineSelector = tree.findByType('MachineSelector' as any);
        expect(machineSelector.props.machines).toEqual([
            { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
        ]);
    });

    it('does not start when the selected machine is structurally offline', async () => {
        machineListByServerIdState = {
            server_a: [
                {
                    id: 'machine_target',
                    active: false,
                    activeAt: 0,
                    metadata: { displayName: 'Target machine', host: 'target.local' },
                },
            ],
        };
        allMachinesState = machineListByServerIdState.server_a;
        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        let chrome: CustomModalChromeConfig | null = null;
        const setChrome = vi.fn((next: CustomModalChromeConfig | null) => {
            chrome = next;
        });

        const tree = (await renderScreen(<SessionHandoffPickerModal
                    onClose={onClose}
                    setChrome={setChrome}
                    onResolve={onResolve}
                    sessionId="sess_1"
                    sourceMachineId="machine_source"
                    serverId="server_a"
                />)).tree;

        const machineSelector = tree.findByType('MachineSelector' as any);
        await act(async () => {
            invokeTestInstanceHandler(machineSelector, 'onSelect', { id: 'machine_target', metadata: { displayName: 'Target machine' } });
        });

        const footer = requireCardChrome(chrome).footer;
        const startButton = findElementByTestId(footer, 'session-handoff-start');
        const startButtonProps = startButton?.props as { disabled?: boolean; onPress?: () => unknown } | undefined;
        expect(startButtonProps?.disabled).toBe(true);

        await act(async () => {
            const onPress = startButtonProps?.onPress;
            if (typeof onPress !== 'function') {
                throw new Error('expected start button to have an onPress handler');
            }
            await onPress();
        });

        expect(onResolve).not.toHaveBeenCalled();
    });

    it('falls back to the active machine record when the server-scoped list lags behind', async () => {
        machineListByServerIdState = {
            server_a: [
                { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local' } },
            ],
        };
        allMachinesState = [
            { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local' } },
            { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
        ];

        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');

        let tree!: ReactTestRenderer;
        tree = (await renderScreen(<SessionHandoffPickerModal
                    onClose={onClose}
                    onResolve={onResolve}
                    sessionId="sess_1"
                    sourceMachineId="machine_source"
                    serverId="server_a"
                />)).tree;

        const machineSelector = tree.findByType('MachineSelector' as any);
        expect(machineSelector.props.machines).toEqual([
            { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
        ]);
    });

    it('retries the machine refresh once credentials are hydrated', async () => {
        vi.useFakeTimers();
        credentialsReady = false;

        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');

        await renderScreen(<SessionHandoffPickerModal
            onClose={onClose}
            onResolve={onResolve}
            sessionId="sess_1"
            sourceMachineId="machine_source"
            serverId="server_a"
        />);

        await act(async () => {});
        expect(refreshMachinesThrottledMock).not.toHaveBeenCalled();

        credentialsReady = true;
        await vi.advanceTimersByTimeAsync(300);
        await act(async () => {});

        expect(refreshMachinesThrottledMock).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('keeps retrying machine refresh until a second online machine becomes visible', async () => {
        vi.useFakeTimers();
        credentialsReady = true;

        let refreshCount = 0;
        machineListByServerIdState = {
            server_a: [
                { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local' } },
            ],
        };
        allMachinesState = [
            { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local' } },
        ];
        refreshMachinesThrottledMock.mockImplementation(async () => {
            refreshCount += 1;
            if (refreshCount >= 2) {
                machineListByServerIdState = {
                    server_a: [
                        { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local' } },
                        { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
                    ],
                };
                allMachinesState = [
                    { id: 'machine_source', metadata: { displayName: 'Source machine', host: 'source.local' } },
                    { id: 'machine_target', metadata: { displayName: 'Target machine', host: 'target.local' } },
                ];
            }
        });

        const onResolve = vi.fn();
        const onClose = vi.fn();
        const { SessionHandoffPickerModal } = await import('./SessionHandoffPickerModal');
        const renderModal = () => (
            <SessionHandoffPickerModal
                onClose={onClose}
                onResolve={onResolve}
                sessionId="sess_1"
                sourceMachineId="machine_source"
                serverId="server_a"
            />
        );

        let tree!: ReactTestRenderer;
        tree = (await renderScreen(renderModal())).tree;

        await act(async () => {});
        expect(refreshMachinesThrottledMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        await act(async () => {
            tree.update(renderModal());
        });
        await act(async () => {});

        expect(refreshMachinesThrottledMock.mock.calls.length).toBeGreaterThanOrEqual(2);
        const machineSelector = tree.findByType('MachineSelector' as any);
        expect(machineSelector.props.machines.map((machine: any) => machine.id)).toEqual(['machine_target']);

        vi.useRealTimers();
    });
});
