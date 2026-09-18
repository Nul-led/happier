import { describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook } from '@/dev/testkit';
import { buildSessionFolderGroupKey, DEFAULT_SESSION_FOLDERS_V1 } from '@/sync/domains/session/folders';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import {
    useSessionListRowInteractions,
    type UseSessionListRowInteractionsInput,
} from './useSessionListRowInteractions';
import { treeRowId } from './drop-resolution/treeRowId';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setSessionFolderAssignmentSpy = vi.hoisted(() => vi.fn(async () => {}));
const resolveSessionOrganizationMutationScopeSpy = vi.hoisted(() => vi.fn(async (serverId: string) => ({
    ok: true as const,
    scope: {
        credentials: { token: 'folder-token', secret: 'folder-secret' },
        serverId,
        serverIdAliases: ['profile-a', 'legacy-a'],
        serverUrl: 'https://server-a.example.test',
    },
})));

vi.mock('react-native-reanimated', () => ({
    Easing: {
        bezier: () => () => 0,
        linear: () => 0,
    },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedReaction: vi.fn(),
}));

vi.mock('@/hooks/ui/useHappyAction', () => ({
    useHappyAction: (action: () => Promise<void>) => {
        let running = false;
        let pending = false;
        const run = () => {
            if (running) {
                pending = true;
                return;
            }
            running = true;
            void action().catch(() => {}).finally(() => {
                running = false;
                if (pending) {
                    pending = false;
                    run();
                }
            });
        };
        return [null, run];
    },
}));

vi.mock('@/sync/ops/sessionOrganization', () => ({
    resolveSessionOrganizationMutationScope: resolveSessionOrganizationMutationScopeSpy,
    requireSessionOrganizationMutationScope: async (serverId: string) => {
        const result = await resolveSessionOrganizationMutationScopeSpy(serverId);
        return result.scope;
    },
    writeSessionOrganizationFolderAssignment: setSessionFolderAssignmentSpy,
}));

describe('useSessionListRowInteractions', () => {
    const workspace = {
        t: 'workspaceScope',
        serverId: 'server-a',
        machineId: 'machine-a',
        rootPath: '/repo/a',
    } as const;
    const listItems: SessionListIndexItem[] = [
        {
            type: 'header',
            title: 'Project A',
            headerKind: 'project',
            groupKey: 'project-a',
            workspaceKey: 'project-a',
            workspace,
            serverId: 'server-a',
        },
        {
            type: 'session',
            sessionId: 's1',
            serverId: 'server-a',
            storageKind: 'persisted',
            groupKey: 'project-a',
            groupKind: 'project',
            folderId: null,
            folderDepth: 0,
            workspace,
        },
    ];
    const twoSessionListItems: SessionListIndexItem[] = [
        listItems[0]!,
        listItems[1]!,
        {
            type: 'session',
            sessionId: 's2',
            serverId: 'server-a',
            storageKind: 'persisted',
            groupKey: 'project-a',
            groupKind: 'project',
            folderId: null,
            folderDepth: 0,
            workspace,
        },
    ];

    function buildInteractionsInput(overrides: Partial<UseSessionListRowInteractionsInput> = {}): UseSessionListRowInteractionsInput {
        return {
            folderActionsEnabled: true,
            isFolderActionsEnabledForServerId: () => true,
            sessionFoldersV1: DEFAULT_SESSION_FOLDERS_V1,
            listItems,
            currentGroupOrderMap: {},
            currentWorkspaceOrderMap: {},
            sessionListOrderingModeV1: 'custom',
            sessionListSectionModeV1: 'activity',
            manualSessionOrderingEnabled: true,
            setSessionListGroupOrderV1: vi.fn(),
            setSessionWorkspaceOrderV1: vi.fn(),
            setSessionFoldersV1: vi.fn(),
            pinnedKeySet: new Set(),
            setSessionPinForKey: vi.fn(),
            sessionTags: {},
            setSessionTagsForKey: vi.fn(),
            ...overrides,
        };
    }

    function renderInteractions(overrides: Partial<UseSessionListRowInteractionsInput> = {}) {
        return renderHook(() => useSessionListRowInteractions(buildInteractionsInput(overrides)));
    }

    it('serializes every accepted organization move with its original qualified target', async () => {
        let resolveFirstWrite: (() => void) | null = null;
        const firstWrite = new Promise<void>((resolve) => {
            resolveFirstWrite = resolve;
        });
        setSessionFolderAssignmentSpy.mockReset();
        setSessionFolderAssignmentSpy
            .mockImplementationOnce(async () => firstWrite)
            .mockImplementation(async () => {});
        resolveSessionOrganizationMutationScopeSpy.mockClear();
        const hook = await renderInteractions();

        act(() => {
            hook.getCurrent().scheduleSessionFolderAssignment({
                type: 'session',
                serverId: 'server-a',
                session: { id: 's1' },
            }, 'folder-a');
        });
        await vi.waitFor(() => expect(setSessionFolderAssignmentSpy).toHaveBeenCalledTimes(1));

        act(() => {
            hook.getCurrent().scheduleSessionFolderAssignment({
                type: 'session',
                serverId: 'server-b',
                session: { id: 's2' },
            }, 'folder-b');
        });
        expect(setSessionFolderAssignmentSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveFirstWrite?.();
            await firstWrite;
        });

        await vi.waitFor(() => expect(setSessionFolderAssignmentSpy).toHaveBeenCalledTimes(2));
        expect(setSessionFolderAssignmentSpy.mock.calls).toEqual([
            [{
                scope: expect.objectContaining({ serverId: 'server-a' }),
                sessionId: 's1',
                folderId: 'folder-a',
            }],
            [{
                scope: expect.objectContaining({ serverId: 'server-b' }),
                sessionId: 's2',
                folderId: 'folder-b',
            }],
        ]);

        await hook.unmount();
    });

    it('reports a rejected commit as failed and continues with the next accepted intent', async () => {
        setSessionFolderAssignmentSpy.mockReset();
        setSessionFolderAssignmentSpy
            .mockRejectedValueOnce(new Error('write rejected'))
            .mockResolvedValue(undefined);
        const hook = await renderInteractions();

        let failedCommit: Promise<boolean> | undefined;
        let succeedingCommit: Promise<boolean> | undefined;
        act(() => {
            failedCommit = hook.getCurrent().scheduleSessionFolderAssignment({
                type: 'session',
                serverId: 'server-a',
                session: { id: 's1' },
            }, 'folder-a');
            succeedingCommit = hook.getCurrent().scheduleSessionFolderAssignment({
                type: 'session',
                serverId: 'server-b',
                session: { id: 's2' },
            }, 'folder-b');
        });

        await expect(failedCommit).resolves.toBe(false);
        await expect(succeedingCommit).resolves.toBe(true);
        expect(setSessionFolderAssignmentSpy).toHaveBeenCalledTimes(2);

        await hook.unmount();
    });

    it('reports a normally resolved unsuccessful organization operation as failed without poisoning the queue', async () => {
        setSessionFolderAssignmentSpy.mockReset();
        setSessionFolderAssignmentSpy.mockResolvedValue(undefined);
        const hook = await renderInteractions({ listItems: twoSessionListItems });

        let committed: Promise<boolean> | undefined;
        let succeedingCommit: Promise<boolean> | undefined;
        act(() => {
            committed = hook.getCurrent().applyKeyboardMove(
                treeRowId.session('server-a', 's1'),
                'up',
            )?.committed;
            succeedingCommit = hook.getCurrent().scheduleSessionFolderAssignment({
                type: 'session',
                serverId: 'server-a',
                session: { id: 's2' },
            }, 'folder-a');
        });

        await expect(committed).resolves.toBe(false);
        await expect(succeedingCommit).resolves.toBe(true);
        expect(setSessionFolderAssignmentSpy).toHaveBeenCalledTimes(1);
        await hook.unmount();
    });

    it('rebases a queued keyboard move onto the latest committed list membership', async () => {
        let resolveFirstWrite: (() => void) | null = null;
        const firstWrite = new Promise<void>((resolve) => {
            resolveFirstWrite = resolve;
        });
        setSessionFolderAssignmentSpy.mockReset();
        setSessionFolderAssignmentSpy
            .mockImplementationOnce(async () => firstWrite)
            .mockResolvedValue(undefined);
        const setSessionListGroupOrderV1 = vi.fn();
        const rootGroupKey = buildSessionFolderGroupKey({
            serverId: 'server-a',
            workspace,
            folderId: null,
        });
        const initialItems: SessionListIndexItem[] = [
            ...twoSessionListItems,
            {
                type: 'session',
                sessionId: 's3',
                serverId: 'server-a',
                storageKind: 'persisted',
                groupKey: 'project-a',
                groupKind: 'project',
                folderId: null,
                folderDepth: 0,
                workspace,
            },
        ];
        const latestItems: SessionListIndexItem[] = [
            initialItems[0]!,
            initialItems[1]!,
            initialItems[2]!,
            {
                ...initialItems[3] as Extract<SessionListIndexItem, { type: 'session' }>,
                sessionId: 's4',
            },
        ];
        const hook = await renderHook(
            (input: UseSessionListRowInteractionsInput) => useSessionListRowInteractions(input),
            {
                initialProps: buildInteractionsInput({
                    listItems: initialItems,
                    setSessionListGroupOrderV1,
                }),
            },
        );

        let firstCommit: Promise<boolean> | undefined;
        let queuedCommit: Promise<boolean> | undefined;
        act(() => {
            firstCommit = hook.getCurrent().scheduleSessionFolderAssignment({
                type: 'session',
                serverId: 'server-a',
                session: { id: 's3' },
            }, 'folder-a');
            queuedCommit = hook.getCurrent().applyKeyboardMove(
                treeRowId.session('server-a', 's1'),
                'down',
            )?.committed;
        });
        await vi.waitFor(() => expect(setSessionFolderAssignmentSpy).toHaveBeenCalledTimes(1));

        await hook.rerender(buildInteractionsInput({
            listItems: latestItems,
            currentGroupOrderMap: {
                [rootGroupKey]: [
                    sessionAddressKey({ serverId: 'server-a', sessionId: 's1' }),
                    sessionAddressKey({ serverId: 'server-a', sessionId: 's2' }),
                    sessionAddressKey({ serverId: 'server-a', sessionId: 's4' }),
                ],
            },
            setSessionListGroupOrderV1,
        }));

        await act(async () => {
            resolveFirstWrite?.();
            await firstWrite;
        });

        await expect(firstCommit).resolves.toBe(true);
        await expect(queuedCommit).resolves.toBe(true);
        expect(setSessionListGroupOrderV1).toHaveBeenLastCalledWith({
            [rootGroupKey]: [
                sessionAddressKey({ serverId: 'server-a', sessionId: 's2' }),
                sessionAddressKey({ serverId: 'server-a', sessionId: 's1' }),
                sessionAddressKey({ serverId: 'server-a', sessionId: 's4' }),
            ],
        });

        await hook.unmount();
    });

    it('persists drag folder assignments under the list projection server id', async () => {
        setSessionFolderAssignmentSpy.mockClear();
        resolveSessionOrganizationMutationScopeSpy.mockClear();
        const folderItems: SessionListIndexItem[] = [
            listItems[0]!,
            {
                type: 'header',
                title: 'Folder A',
                headerKind: 'folder',
                folderId: 'folder-a',
                folderDepth: 0,
                groupKey: 'folder:server-a:workspaceScope:server-a:machine-a:/repo/a:folder-a',
                workspace,
                serverId: 'server-a',
            },
            listItems[1]!,
        ];
        const hook = await renderInteractions({
            listItems: folderItems,
            sessionFoldersV1: {
                v: 1,
                folders: [{
                    id: 'folder-a',
                    workspace,
                    parentId: null,
                    name: 'Folder A',
                    createdAt: 1,
                    updatedAt: 1,
                }],
            },
        });

        await act(async () => {
            hook.getCurrent().handleDragStart(sessionAddressKey({ serverId: 'server-a', sessionId: 's1' }));
            hook.getCurrent().handleTreeDropResult({
                sessionKey: 'server-a:s1',
                groupKey: 'project-a',
                dataIndex: 2,
                result: {
                    instruction: {
                        kind: 'nest-into',
                        targetId: treeRowId.folder('server-a', 'folder-a'),
                        containerId: treeRowId.folder('server-a', 'folder-a'),
                        parentId: treeRowId.folder('server-a', 'folder-a'),
                        depth: 1,
                    },
                    visual: { kind: 'outline', targetId: treeRowId.folder('server-a', 'folder-a') },
                },
            });
        });

        await vi.waitFor(() => {
            expect(setSessionFolderAssignmentSpy).toHaveBeenCalledWith({
                scope: {
                    credentials: { token: 'folder-token', secret: 'folder-secret' },
                    serverId: 'server-a',
                    serverIdAliases: ['profile-a', 'legacy-a'],
                    serverUrl: 'https://server-a.example.test',
                },
                sessionId: 's1',
                folderId: 'folder-a',
            });
        });
        expect(resolveSessionOrganizationMutationScopeSpy).toHaveBeenCalledWith('server-a');

        await hook.unmount();
    });

    it('does not start a folder mutation for a row whose exact Home disables folders', async () => {
        setSessionFolderAssignmentSpy.mockClear();
        resolveSessionOrganizationMutationScopeSpy.mockClear();
        const folderItems: SessionListIndexItem[] = [
            listItems[0]!,
            {
                type: 'header',
                title: 'Folder A',
                headerKind: 'folder',
                folderId: 'folder-a',
                folderDepth: 0,
                groupKey: 'folder:server-a:workspaceScope:server-a:machine-a:/repo/a:folder-a',
                workspace,
                serverId: 'server-a',
            },
            listItems[1]!,
        ];
        const hook = await renderInteractions({
            listItems: folderItems,
            isFolderActionsEnabledForServerId: (serverId) => serverId === 'server-b',
            sessionFoldersV1: {
                v: 1,
                folders: [{ id: 'folder-a', workspace, parentId: null, name: 'Folder A', createdAt: 1, updatedAt: 1 }],
            },
        });

        await act(async () => {
            hook.getCurrent().handleDragStart(sessionAddressKey({ serverId: 'server-a', sessionId: 's1' }));
            hook.getCurrent().handleTreeDropResult({
                sessionKey: 'server-a:s1',
                groupKey: 'project-a',
                dataIndex: 2,
                result: {
                    instruction: {
                        kind: 'nest-into',
                        targetId: treeRowId.folder('server-a', 'folder-a'),
                        containerId: treeRowId.folder('server-a', 'folder-a'),
                        parentId: treeRowId.folder('server-a', 'folder-a'),
                        depth: 1,
                    },
                    visual: { kind: 'outline', targetId: treeRowId.folder('server-a', 'folder-a') },
                },
            });
            await Promise.resolve();
        });

        expect(resolveSessionOrganizationMutationScopeSpy).not.toHaveBeenCalled();
        expect(setSessionFolderAssignmentSpy).not.toHaveBeenCalled();
        await hook.unmount();
    });

    it('exposes only drag snapshot and numeric overlay state for pointer drag visuals', async () => {
        const hook = await renderInteractions();

        await act(async () => {
            hook.getCurrent().handleDragStart(sessionAddressKey({ serverId: 'server-a', sessionId: 's1' }));
            hook.getCurrent().handleDragUpdate({
                sessionKey: 'server-a:s1',
                groupKey: 'g1',
                dataIndex: 1,
                result: {
                    instruction: {
                        kind: 'nest-into',
                        targetId: 'folder:target',
                        containerId: 'folder:target',
                        parentId: 'folder:target',
                        depth: 1,
                    },
                    visual: {
                        kind: 'outline',
                        targetId: 'folder:target',
                    },
                },
            });
        });

        expect(hook.getCurrent().draggingSessionKey).toBe(sessionAddressKey({ serverId: 'server-a', sessionId: 's1' }));
        expect(hook.getCurrent()).toHaveProperty('activeDragSnapshot');
        expect(hook.getCurrent()).toHaveProperty('dropOverlayShared');
        expect(hook.getCurrent()).not.toHaveProperty('activeDropTargetId');
        expect(hook.getCurrent()).not.toHaveProperty('activeDropVisual');
        expect(hook.getCurrent()).not.toHaveProperty('dropVisual');

        await hook.unmount();
    });

    it('does not expose a legacy delta-based drag-end handler', async () => {
        const hook = await renderInteractions();

        expect(hook.getCurrent()).not.toHaveProperty('handleDragEnd');
        expect(hook.getCurrent()).toHaveProperty('resolveTreeDropResult');
        expect(hook.getCurrent()).toHaveProperty('handleTreeDropResult');

        await hook.unmount();
    });

    it('does not persist same-container session reorder from row interactions in date ordering mode', async () => {
        const setSessionListGroupOrderV1 = vi.fn();
        const dateModeInput = {
            listItems: twoSessionListItems,
            sessionListOrderingModeV1: 'updated' as const,
            sessionListSectionModeV1: 'activity' as const,
            setSessionListGroupOrderV1,
        };
        const hook = await renderInteractions(dateModeInput);

        await act(async () => {
            hook.getCurrent().handleDragStart(sessionAddressKey({ serverId: 'server-a', sessionId: 's2' }));
            hook.getCurrent().handleTreeDropResult({
                sessionKey: 'server-a:s2',
                groupKey: 'project-a',
                dataIndex: 2,
                result: {
                    instruction: {
                        kind: 'reorder-before',
                        targetId: treeRowId.session('server-a', 's1'),
                        containerId: treeRowId.workspaceRoot('project-a'),
                        parentId: null,
                        depth: 0,
                    },
                    visual: { kind: 'line', targetId: treeRowId.session('server-a', 's1'), edge: 'top', depth: 0 },
                },
            });
        });

        expect(setSessionListGroupOrderV1).not.toHaveBeenCalled();

        await hook.unmount();
    });

    it('preserves pin and tag row actions while using the tree pipeline', async () => {
        const setSessionPinForKey = vi.fn();
        const setSessionTagsForKey = vi.fn();
        const hook = await renderInteractions({
            pinnedKeySet: new Set(['server-a:s1']),
            setSessionPinForKey,
            sessionTags: { 'server-a:s1': ['old'] },
            setSessionTagsForKey,
        });

        hook.getCurrent().handleTogglePinnedSessionKey('server-a:s1');
        hook.getCurrent().handleSetTagsSessionKey('server-a:s1', ['new']);

        expect(setSessionPinForKey).toHaveBeenCalledWith('server-a:s1', false);
        expect(setSessionTagsForKey).toHaveBeenCalledWith('server-a:s1', ['new']);

        await hook.unmount();
    });

    it('suppresses exactly one folder-focus press immediately after a tree drag drop', async () => {
        const folderItems: SessionListIndexItem[] = [
            listItems[0]!,
            {
                type: 'header',
                title: 'Folder A',
                headerKind: 'folder',
                folderId: 'folder-a',
                folderDepth: 0,
                groupKey: 'folder:server-a:workspaceScope:server-a:machine-a:/repo/a:folder-a',
                workspace,
                serverId: 'server-a',
            },
            listItems[1]!,
        ];
        const hook = await renderInteractions({
            listItems: folderItems,
            sessionFoldersV1: {
                v: 1,
                folders: [{
                    id: 'folder-a',
                    workspace,
                    parentId: null,
                    name: 'Folder A',
                    createdAt: 1,
                    updatedAt: 1,
                }],
            },
        });

        expect(hook.getCurrent().consumeFolderFocusPressAfterDrag()).toBe(false);

        await act(async () => {
            hook.getCurrent().handleDragStart(sessionAddressKey({ serverId: 'server-a', sessionId: 's1' }));
            hook.getCurrent().handleTreeDropResult({
                sessionKey: 'server-a:s1',
                groupKey: 'project-a',
                dataIndex: 2,
                result: {
                    instruction: {
                        kind: 'nest-into',
                        targetId: treeRowId.folder('server-a', 'folder-a'),
                        containerId: treeRowId.folder('server-a', 'folder-a'),
                        parentId: treeRowId.folder('server-a', 'folder-a'),
                        depth: 1,
                    },
                    visual: { kind: 'outline', targetId: treeRowId.folder('server-a', 'folder-a') },
                },
            });
        });

        expect(hook.getCurrent().consumeFolderFocusPressAfterDrag()).toBe(true);
        expect(hook.getCurrent().consumeFolderFocusPressAfterDrag()).toBe(false);

        await hook.unmount();
    });

    it('keeps row action handler identities stable across pin and tag state changes', async () => {
        const setSessionPinForKey = vi.fn();
        const setSessionTagsForKey = vi.fn();
        const hook = await renderHook(
            (input: UseSessionListRowInteractionsInput) => useSessionListRowInteractions(input),
            {
                initialProps: buildInteractionsInput({
                    setSessionPinForKey,
                    sessionTags: { 'server-a:s1': ['old'] },
                    setSessionTagsForKey,
                }),
            },
        );

        const initialTogglePinned = hook.getCurrent().handleTogglePinnedSessionKey;
        const initialSetTags = hook.getCurrent().handleSetTagsSessionKey;

        await hook.rerender(buildInteractionsInput({
            pinnedKeySet: new Set(['server-a:s1']),
            setSessionPinForKey,
            sessionTags: { 'server-a:s1': ['old', 'new'] },
            setSessionTagsForKey,
        }));

        expect(hook.getCurrent().handleTogglePinnedSessionKey).toBe(initialTogglePinned);
        expect(hook.getCurrent().handleSetTagsSessionKey).toBe(initialSetTags);

        hook.getCurrent().handleTogglePinnedSessionKey('server-a:s1');
        hook.getCurrent().handleSetTagsSessionKey('server-a:s1', ['latest']);

        expect(setSessionPinForKey).toHaveBeenLastCalledWith('server-a:s1', false);
        expect(setSessionTagsForKey).toHaveBeenLastCalledWith('server-a:s1', ['latest']);

        await hook.unmount();
    });
});
