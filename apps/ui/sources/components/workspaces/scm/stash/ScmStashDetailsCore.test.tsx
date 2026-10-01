import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import type { ScmStashDetailsAdapter } from './scmStashAdapter';
import type { ScmStashEntry } from '@happier-dev/protocol';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ confirmResult: true }).module;
});
vi.mock('@legendapp/list/react-native', async (importOriginal) => {
    const { createCapturingLegendListMock } = await import('@/dev/testkit/mocks/legendList');
    // The native recycler needs host geometry unavailable in the Node renderer.
    return createCapturingLegendListMock({ original: await importOriginal<Record<string, unknown>>() }).module;
});

const { storage } = await import('@/sync/domains/state/storage');

describe('ScmStashDetailsCore captured stash identity', () => {
    beforeEach(() => {
        const initial = storage.getInitialState();
        storage.setState({ ...initial, settings: { ...initial.settings, experiments: true, featureToggles: { 'scm.writeOperations': true } } }, true);
    });

    it.each(['apply', 'restore', 'discard'] as const)('uses the captured object for %s and its displayed diff', async (operation) => {
        const stashOid = 'a'.repeat(40);
        // The adapter is the daemon transport boundary; all Core/domain logic stays real.
        const adapter = {
            list: vi.fn(async () => ({ success: true, stashes: [{ stashRef: 'stash@{0}', stashOid, kind: 'branch' as const, branch: 'main' }] })),
            show: vi.fn(async (_identity: string) => ({ success: true, diff: '' })),
            pop: vi.fn(async (_identity: string) => ({ success: true })),
            drop: vi.fn(async (_identity: string) => ({ success: true })),
            apply: vi.fn(async (_identity: string) => ({ success: true })),
        } satisfies ScmStashDetailsAdapter;
        const { ScmStashDetailsCore } = await import('./ScmStashDetailsCore');
        const screen = await renderScreen(<ScmStashDetailsCore adapter={adapter} scopeResetKey="repo" applyButtonTestId="apply" restoreButtonTestId="restore" discardButtonTestId="discard" />);
        await screen.pressByTestIdAsync(operation);

        expect(adapter.show).toHaveBeenCalledWith(stashOid);
        expect(adapter[operation === 'restore' ? 'pop' : operation === 'discard' ? 'drop' : 'apply']).toHaveBeenCalledWith(stashOid);
    });

    it('keeps the selected object when a refreshed list reuses its old index for another stash', async () => {
        const stashOid = 'a'.repeat(40);
        let stashes: ScmStashEntry[] = [{ stashRef: 'stash@{0}', stashOid, kind: 'branch', branch: 'main' }];
        const adapter = {
            list: vi.fn(async () => ({ success: true, stashes })),
            show: vi.fn(async (_identity: string) => ({ success: true, diff: '' })),
            pop: vi.fn(async (_identity: string) => ({ success: true })),
            drop: vi.fn(async (_identity: string) => ({ success: true })),
            apply: vi.fn(async (_identity: string) => ({ success: true })),
        } satisfies ScmStashDetailsAdapter;
        const { ScmStashDetailsCore } = await import('./ScmStashDetailsCore');
        const screen = await renderScreen(<ScmStashDetailsCore adapter={adapter} scopeResetKey="repo" applyButtonTestId="apply" />);
        stashes = [
            { stashRef: 'stash@{0}', stashOid: 'b'.repeat(40), kind: 'branch', branch: 'other' },
            { stashRef: 'stash@{1}', stashOid, kind: 'branch', branch: 'main' },
        ];
        await screen.update(<ScmStashDetailsCore adapter={{ ...adapter }} scopeResetKey="repo" applyButtonTestId="apply" />);
        await screen.pressByTestIdAsync('apply');

        expect(screen.getTextContent()).toContain('stash@{1}');
        expect(adapter.show).toHaveBeenLastCalledWith(stashOid);
        expect(adapter.apply).toHaveBeenCalledWith(stashOid);
    });
});
