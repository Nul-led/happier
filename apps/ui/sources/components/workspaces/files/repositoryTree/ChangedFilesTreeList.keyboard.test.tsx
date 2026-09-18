import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ItemProps } from '@/components/ui/lists/Item';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { renderScreen } from '@/dev/testkit';
import { lightTheme } from '@/theme';
import { ChangedFilesTreeList } from './ChangedFilesTreeList';

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
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
const legend = vi.hoisted(() => ({ state: null as import('@/dev/testkit/mocks/legendList').CapturingLegendListMockState | null }));
vi.mock('@legendapp/list/react-native', async () => {
    const { createCapturingLegendListMock } = await import('@/dev/testkit/mocks/legendList');
    const mock = createCapturingLegendListMock({ renderItems: false });
    legend.state = mock.state;
    return mock.module;
});

const snapshot: ScmWorkingSnapshot = {
    projectKey: 'project', fetchedAt: 0,
    repo: { isRepo: true, rootPath: '/repo' },
    branch: { head: 'main', upstream: null, ahead: 0, behind: 0, detached: false },
    hasConflicts: false,
    entries: ['src/a.ts', 'src/b.ts', 'z.ts'].map(path => ({
        path, previousPath: null, kind: 'modified', includeStatus: ' ', pendingStatus: 'M',
        hasIncludedDelta: false, hasPendingDelta: true,
        stats: { includedAdded: 0, includedRemoved: 0, pendingAdded: 1, pendingRemoved: 0, isBinary: false },
    })),
    totals: { includedFiles: 0, pendingFiles: 3, untrackedFiles: 0, includedAdded: 0, includedRemoved: 0, pendingAdded: 3, pendingRemoved: 0 },
};

describe('ChangedFilesTreeList keyboard navigation', () => {
    it('follows expanded and filtered rows with one tab stop and file pin activation', async () => {
        const open = vi.fn();
        const pin = vi.fn();
        const element = (searchQuery: string) => <ChangedFilesTreeList theme={lightTheme} snapshot={snapshot} searchQuery={searchQuery} onOpenFile={open} onOpenFilePinned={pin} />;
        const screen = await renderScreen(element(''));
        // Inspect the real rendered rows at the external virtualizer boundary; the projection and keyboard owner stay real.
        const rows = (): ItemProps[] => legend.state!.props.data.map((item: unknown, index: number) => legend.state!.props.renderItem({ item, index }).props);
        const key = async (index: number, value: string) => {
            await React.act(async () => { rows()[index].onKeyDown?.({ key: value, preventDefault() {} }); });
        };

        expect(screen.tree.root.findAll(node => typeof node.type === 'string' && node.props.role === 'tree')).toHaveLength(1);
        expect(rows().map(row => row.webTabIndex)).toEqual([0, -1]);
        await key(0, 'ArrowRight');
        expect(rows()).toHaveLength(4);
        expect(rows()[0].accessibilityExpanded).toBe(true);
        expect(rows()[1].accessibilityLevel).toBe(2);
        await key(0, 'ArrowDown');
        expect(rows().map(row => row.webTabIndex)).toEqual([-1, 0, -1, -1]);
        expect(legend.state!.refHandle.scrollToIndex).toHaveBeenLastCalledWith({ index: 1, animated: false });
        await key(1, 'p');
        expect(pin).toHaveBeenCalledWith('src/a.ts');
        expect(open).not.toHaveBeenCalled();
        await key(1, 'ArrowLeft');
        await key(0, 'ArrowLeft');
        expect(rows()).toHaveLength(2);
        expect(rows()[0].accessibilityExpanded).toBe(false);
        await screen.update(element('b.ts'));
        expect(rows()).toHaveLength(1);
        expect(rows()[0].webTabIndex).toBe(0);
        expect(rows()[0].accessibilityLevel).toBe(1);
        await React.act(async () => { rows()[0].onPress?.(); });
        expect(open).toHaveBeenCalledWith('src/b.ts');
        await screen.update(element('absent'));
        expect(rows()).toHaveLength(0);
    });
});
