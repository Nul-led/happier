import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSyncConflictV1 } from '@happier-dev/protocol';

import { createModalModuleMock } from '@/dev/testkit/mocks/modal';
import { createReactNativeWebMock } from '@/dev/testkit/mocks/reactNative';
import { renderScreen } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    deleteLoser: vi.fn(),
    readFile: vi.fn(),
    refreshConflicts: vi.fn(),
    refreshStatus: vi.fn(),
    setStatus: vi.fn(),
    conflictSnapshot: {
        phase: 'ready' as const,
        list: {
            relationshipId: 'relationship-1',
            totalCount: 1,
            shownCount: 1,
            truncatedCount: 0,
            conflicts: [{
                relationshipId: 'relationship-1',
                path: 'src/index.ts',
                alpha: { kind: 'file' as const, digest: 'a'.repeat(40), size: 12 },
                beta: { kind: 'file' as const, digest: 'b'.repeat(40), size: 13 },
            }] as WorkspaceSyncConflictV1[],
        },
        error: null,
    },
    statusSnapshot: {
        phase: 'ready' as const,
        status: {
            relationshipId: 'relationship-1',
            controllerMachineId: 'machine-alpha',
            state: 'watching' as const,
            alphaPath: '/live/source',
            betaPath: '/live/destination',
            mode: 'keep_synced' as const,
            changedFiles: 0,
            conflictCount: 1,
            lastSuccessfulSyncAtMs: 4,
            errorCode: 'test_engine_error',
        },
        error: null,
    },
}));

vi.mock('react-native', async () => createReactNativeWebMock());
vi.mock('@/modal', async () => createModalModuleMock({ confirmResult: true }).module);
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/components/ui/code/diff/DiffViewer', () => ({ DiffViewer: 'DiffViewer' }));
vi.mock('@/components/ui/buttons/IconButton', () => ({
    IconButton: (props: object) => React.createElement('IconButton', props),
}));
vi.mock('@/components/ui/buttons/RoundButton', () => ({
    RoundButton: (props: object) => React.createElement('RoundButton', props),
}));
vi.mock('@/components/ui/icons/Icon', () => ({
    Icon: (props: object) => React.createElement('Icon', props),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: { title?: string; subtitle?: string; detail?: string; copy?: string | boolean }) => React.createElement('Item', props),
}));
vi.mock('@/components/ui/lists/ExpandableItem', () => ({
    ExpandableItem: (props: React.PropsWithChildren<{
        expanded: boolean;
        onExpandedChange: (next: boolean) => void;
        header: (state: Readonly<{
            expanded: boolean;
            headerProps: Readonly<{
                onPress: () => void;
                accessibilityRole: 'button';
                accessibilityState: Readonly<{ expanded: boolean }>;
            }>;
        }>) => React.ReactNode;
    }>) => React.createElement(
        'ExpandableItem',
        props,
        props.header({
            expanded: props.expanded,
            headerProps: {
                onPress: () => props.onExpandedChange(!props.expanded),
                accessibilityRole: 'button',
                accessibilityState: { expanded: props.expanded },
            },
        }),
        props.expanded ? props.children : null,
    ),
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: React.PropsWithChildren<{ title?: string }>) => React.createElement('ItemGroup', props, props.children),
}));
vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: (props: React.PropsWithChildren) => React.createElement('ItemList', props, props.children),
}));
vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: React.PropsWithChildren) => React.createElement('Text', props, props.children),
}));
vi.mock('@/sync/ops/workspaceSync', () => ({
    deleteWorkspaceSyncConflictLoser: shared.deleteLoser,
    readWorkspaceSyncFile: shared.readFile,
}));
vi.mock('@/sync/domains/sessionHandoff/workspaceSyncConflictStore', () => ({
    getWorkspaceSyncConflictSnapshot: () => shared.conflictSnapshot,
    refreshWorkspaceSyncConflicts: shared.refreshConflicts,
    subscribeWorkspaceSyncConflicts: () => () => {},
}));
vi.mock('@/sync/domains/sessionHandoff/workspaceSyncStatusStore', () => ({
    getWorkspaceSyncStatusSnapshot: () => shared.statusSnapshot,
    subscribeWorkspaceSyncStatus: () => () => {},
    setWorkspaceSyncStatus: shared.setStatus,
    refreshWorkspaceSyncStatus: shared.refreshStatus,
}));

const resource = {
    kind: 'workspaceSyncConflicts' as const,
    relationshipId: 'relationship-1',
    controllerMachineId: 'machine-alpha',
    serverId: 'server-1',
    mode: 'keep_synced' as const,
    enabled: true,
    alpha: { label: 'Local project', machineId: 'machine-alpha', machineName: 'Alpha Mac', rootPath: '/work/local' },
    beta: { label: 'Remote project', machineId: 'machine-beta', machineName: 'Beta workstation', rootPath: '/work/remote' },
    localSide: 'alpha' as const,
};

describe('WorkspaceSyncConflictDetailsView', () => {
    beforeEach(() => {
        shared.deleteLoser.mockReset();
        shared.readFile.mockReset().mockImplementation(async (input: { request: { side: 'alpha' | 'beta' } }) => ({
            status: 'binary',
            digest: input.request.side === 'alpha' ? 'a'.repeat(40) : 'b'.repeat(40),
            size: input.request.side === 'alpha' ? 12 : 13,
        }));
        shared.refreshConflicts.mockReset().mockResolvedValue(shared.conflictSnapshot.list);
        shared.refreshStatus.mockReset().mockResolvedValue(null);
        shared.setStatus.mockReset();
        shared.conflictSnapshot.list.conflicts = [{
            relationshipId: 'relationship-1',
            path: 'src/index.ts',
            alpha: { kind: 'file', digest: 'a'.repeat(40), size: 12 },
            beta: { kind: 'file', digest: 'b'.repeat(40), size: 13 },
        }];
    });

    it('leads with the relationship summary, then conflicts and refresh, and keeps diagnostics closed behind one disclosure', async () => {
        const { WorkspaceSyncConflictDetailsView } = await import('./WorkspaceSyncConflictDetailsView');
        const screen = await renderScreen(<WorkspaceSyncConflictDetailsView resource={resource} />);

        const items = screen.findAllByType('Item');
        expect(items).toEqual(expect.arrayContaining([
            expect.objectContaining({ props: expect.objectContaining({ title: 'Local project → Remote project', subtitle: 'workspaceSync.mode.keepSynced' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.state.watching' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: expect.stringContaining('workspaceSync.endpoint.source'), subtitle: 'Alpha Mac · /live/source' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: expect.stringContaining('workspaceSync.endpoint.destination'), subtitle: 'Beta workstation · /live/destination' }) }),
        ]));
        expect(items.some((item) => String(item.props.subtitle).includes('workspaceSync.lastSynced'))).toBe(true);

        // Summary first, then the conflicts/refresh task group, and only then the
        // untitled group that carries the single diagnostics disclosure.
        expect(screen.findAllByType('ItemGroup').map((group) => group.props.title)).toEqual([
            'workspaceSync.title',
            'workspaceSync.conflictsTitle',
            undefined,
        ]);

        const titles = items.map((item) => item.props.title);
        expect(titles.indexOf('src/index.ts')).toBeLessThan(titles.indexOf('workspaceSync.diagnostics.title'));
        expect(titles.indexOf('workspaceSync.actions.refresh')).toBeLessThan(titles.indexOf('workspaceSync.diagnostics.title'));

        const disclosures = screen.findAllByType('ExpandableItem');
        expect(disclosures).toHaveLength(1);
        expect(disclosures[0]?.props.expanded).toBe(false);

        // Closed by default: no raw identifier, live root, mode/state or error
        // code is rendered until the reader opens diagnostics.
        expect(items.filter((item) => item.props.copy)).toEqual([]);
        expect(screen.getTextContent()).not.toContain('workspaceSync.diagnostics.relationshipId');
    });

    it('labels each conflicting path with localized file states instead of raw protocol kinds', async () => {
        shared.conflictSnapshot.list.conflicts = [{
            relationshipId: 'relationship-1',
            path: 'src/index.ts',
            alpha: { kind: 'file', digest: 'a'.repeat(40), size: 12 },
            beta: { kind: 'directory' },
        }];
        const { WorkspaceSyncConflictDetailsView } = await import('./WorkspaceSyncConflictDetailsView');
        const screen = await renderScreen(<WorkspaceSyncConflictDetailsView resource={resource} />);
        const conflictItem = screen.findAllByType('Item').find((node) => node.props.title === 'src/index.ts');
        expect(conflictItem?.props.subtitle).toBe(
            'Local project: workspaceSync.conflictKind.file · Remote project: workspaceSync.conflictKind.directory',
        );
    });

    it('exposes selectable, copyable identifiers, live roots and engine state once diagnostics are opened', async () => {
        const { WorkspaceSyncConflictDetailsView } = await import('./WorkspaceSyncConflictDetailsView');
        const screen = await renderScreen(<WorkspaceSyncConflictDetailsView resource={resource} />);

        const toggle = screen.findAllByType('Item').find((item) => item.props.title === 'workspaceSync.diagnostics.title');
        expect(toggle?.props.accessibilityRole).toBe('button');
        expect(toggle?.props.accessibilityState).toEqual({ expanded: false });
        await act(async () => {
            await toggle?.props.onPress();
        });

        expect(screen.findAllByType('ExpandableItem')[0]?.props.expanded).toBe(true);
        const diagnosticItems = screen.findAllByType('Item').filter((item) => item.props.copy);
        expect(diagnosticItems).toEqual(expect.arrayContaining([
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.relationshipId', subtitle: 'relationship-1', copy: 'relationship-1' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.controllerMachineId', subtitle: 'machine-alpha', copy: 'machine-alpha' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.alphaMachineId', subtitle: 'machine-alpha', copy: 'machine-alpha' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.betaMachineId', subtitle: 'machine-beta', copy: 'machine-beta' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.alphaRoot', subtitle: '/live/source', copy: '/live/source' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.betaRoot', subtitle: '/live/destination', copy: '/live/destination' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.engineState', subtitle: 'watching', copy: 'watching' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.engineMode', subtitle: 'keep_synced', copy: 'keep_synced' }) }),
            expect.objectContaining({ props: expect.objectContaining({ title: 'workspaceSync.diagnostics.errorCode', subtitle: 'test_engine_error', copy: 'test_engine_error' }) }),
        ]));
    });

    it('names both endpoints and shows non-text preview states under the matching endpoint', async () => {
        const { WorkspaceSyncConflictDetailsView } = await import('./WorkspaceSyncConflictDetailsView');
        const screen = await renderScreen(<WorkspaceSyncConflictDetailsView resource={resource} />);

        await act(async () => {
            await screen.findAllByType('Item').find((node) => node.props.title === 'src/index.ts')?.props.onPress();
        });

        expect(screen.getTextContent()).toContain('Local project');
        expect(screen.getTextContent()).toContain('/live/source');
        expect(screen.getTextContent()).toContain('Remote project');
        expect(screen.getTextContent()).toContain('/live/destination');
        expect(screen.getTextContent()).toContain('workspaceSync.fileState.binary');
    });

    it('treats a single-file version choice as the decision and refreshes a stale conflict inline', async () => {
        const changed = Object.assign(new Error('changed'), { code: 'conflict_changed' });
        shared.deleteLoser.mockRejectedValueOnce(changed);
        const { Modal } = await import('@/modal');
        const { WorkspaceSyncConflictDetailsView } = await import('./WorkspaceSyncConflictDetailsView');
        const screen = await renderScreen(<WorkspaceSyncConflictDetailsView resource={resource} />);
        await act(async () => {
            await screen.findAllByType('Item').find((node) => node.props.title === 'src/index.ts')?.props.onPress();
        });

        const keepLocal = screen.findAllByType('RoundButton').find(
            (node) => node.props.title === 'workspaceSync.actions.keepLocal',
        );
        expect(keepLocal).toBeTruthy();
        await act(async () => {
            await keepLocal?.props.onPress();
        });

        expect(Modal.confirm).not.toHaveBeenCalled();
        expect(Modal.alert).not.toHaveBeenCalled();
        expect(shared.refreshConflicts).toHaveBeenCalled();
        expect(screen.getTextContent()).toContain('workspaceSync.resolve.changedBody');
        expect(screen.getTextContent()).toContain('src/index.ts');
    });

    it('keeps one consequence-specific confirmation for recursive directory removal', async () => {
        shared.conflictSnapshot.list.conflicts = [{
            relationshipId: 'relationship-1',
            path: 'generated',
            alpha: { kind: 'directory' },
            beta: { kind: 'directory' },
        }];
        const { Modal } = await import('@/modal');
        vi.mocked(Modal.confirm).mockResolvedValueOnce(false);
        const { WorkspaceSyncConflictDetailsView } = await import('./WorkspaceSyncConflictDetailsView');
        const screen = await renderScreen(<WorkspaceSyncConflictDetailsView resource={resource} />);
        await act(async () => {
            await screen.findAllByType('Item').find((node) => node.props.title === 'generated')?.props.onPress();
        });

        await act(async () => {
            await screen.findAllByType('RoundButton').find(
                (node) => node.props.title === 'workspaceSync.actions.keepLocal',
            )?.props.onPress();
        });

        expect(Modal.confirm).toHaveBeenCalledOnce();
        expect(shared.deleteLoser).not.toHaveBeenCalled();
    });

    it('does not offer a resolution that the protocol rejects for a digest-less file loser', async () => {
        shared.conflictSnapshot.list.conflicts = [{
            relationshipId: 'relationship-1',
            path: 'src/unverified.ts',
            alpha: { kind: 'file' },
            beta: { kind: 'file', digest: 'b'.repeat(40) },
        }];
        const { WorkspaceSyncConflictDetailsView } = await import('./WorkspaceSyncConflictDetailsView');
        const screen = await renderScreen(<WorkspaceSyncConflictDetailsView resource={resource} />);

        await act(async () => {
            await screen.findAllByType('Item').find((node) => node.props.title === 'src/unverified.ts')?.props.onPress();
        });

        const actions = screen.findAllByType('RoundButton');
        expect(actions.find((node) => node.props.title === 'workspaceSync.actions.keepRemote')).toBeUndefined();
        expect(actions.find((node) => node.props.title === 'workspaceSync.actions.keepLocal')).toBeTruthy();
        expect(screen.getTextContent()).toContain('workspaceSync.resolve.unverifiedFile');
    });
});
