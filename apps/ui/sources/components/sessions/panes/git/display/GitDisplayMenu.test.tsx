import * as React from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const textMock = createTextModuleMock({ translate: (key: string) => key });
vi.mock('@/text', () => textMock);

// The account settings are the storage boundary: the rows read and write exactly these three.
const settings = vi.hoisted(() => ({
    values: {} as Record<string, unknown>,
    writes: [] as Array<[string, unknown]>,
}));
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub, createUseSettingMutableMockFromReader } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useSettingMutable: createUseSettingMutableMockFromReader((key) => [
            settings.values[key],
            (next: unknown) => { settings.writes.push([key, next]); settings.values[key] = next; },
        ] as const),
    });
});

describe('GitDisplayOptions', () => {
    async function render(values: Record<string, unknown>) {
        settings.values = { ...values };
        settings.writes = [];
        const { GitDisplayOptions } = await import('./GitDisplayMenu');
        return renderScreen(<GitDisplayOptions testIDPrefix="display" />);
    }

    it('writes the pane layout, the list-or-tree choice and the density to their account settings', async () => {
        const screen = await render({ scmGitPaneLayout: 'unified', scmChangedFilesLayout: 'list', filesChangedFilesRowDensity: 'comfortable' });
        await act(async () => { screen.pressByTestId('display-layout:tabs'); });
        await act(async () => { screen.pressByTestId('display-density:compact'); });
        await act(async () => { screen.pressByTestId('display-show-as:tree'); });
        expect(settings.writes).toEqual([
            ['scmGitPaneLayout', 'tabs'],
            ['filesChangedFilesRowDensity', 'compact'],
            ['scmChangedFilesLayout', 'tree'],
        ]);
    });

    it('offers no density while the tree shows (tree rows are always compact)', async () => {
        const tree = await render({ scmChangedFilesLayout: 'tree' });
        expect(tree.findAllByTestId('display-density:compact')).toHaveLength(0);
        const list = await render({});
        expect(list.findAllByTestId('display-density:compact').length).toBeGreaterThan(0);
    });
});
