import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardItemRefV1 } from '@happier-dev/protocol';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { BoardByStatus } from './byStatus/BoardByStatus';
import { BoardCanvas } from './canvas/BoardCanvas';
import type { BoardCard } from './model/boardCards';
import { BOARD_CANVAS_METRICS } from './model/boardCanvasGeometry';

vi.mock('react-native', async () => (await import('@/dev/testkit/mocks/reactNative')).createReactNativeWebMock());
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@/text', async () => (await import('@/dev/testkit/mocks/text')).createTextModuleMock());

afterEach(async () => {
    vi.useRealTimers();
    await standardCleanup();
});

function card(kind: BoardItemRefV1['kind'], id: string, bucket: BoardCard['status']['bucket']): BoardCard {
    const ref: BoardItemRefV1 = { kind, qualifiedId: { serverId: 'home-a', id } };
    return {
        key: JSON.stringify([kind, 'home-a', id]),
        ref,
        picked: true,
        availability: 'ready',
        title: id,
        status: { bucket, tone: bucket === 'needs_you' ? 'attention' : 'neutral', word: bucket },
        body: { kind: 'none' },
    };
}

const MIXED = [
    card('session', 'checkout', 'needs_you'),
    card('workflow_run', 'release', 'needs_you'),
    card('machine', 'macbook', 'working'),
    card('session', 'runbook', 'finished'),
    card('workflow', 'nightly', 'idle'),
    card('machine', 'build-vps', 'offline'),
];

describe('Board layouts', () => {
    it('By status shows the five shared buckets with every kind in its status column', async () => {
        const screen = await renderScreen(<BoardByStatus cards={MIXED} onOpen={() => {}} stacked={false} />);
        const column = (bucket: string) => screen.findHostByTestId(`board-status:${bucket}`);
        for (const bucket of ['needs_you', 'working', 'finished', 'idle', 'offline']) expect(column(bucket)).not.toBeNull();
        const keysIn = (bucket: string) => MIXED
            .filter((candidate) => screen.findAllHostsByTestId(`board-status-card:${candidate.key}`)
                .some((host) => column(bucket)?.findAll((node) => node === host).length))
            .map((candidate) => candidate.ref.qualifiedId.id);
        expect(keysIn('needs_you')).toEqual(['checkout', 'release']);
        expect(keysIn('working')).toEqual(['macbook']);
        expect(keysIn('offline')).toEqual(['build-vps']);
    });

    it('on a phone, By status stacks only the statuses that hold something', async () => {
        const screen = await renderScreen(<BoardByStatus cards={MIXED.slice(0, 3)} onOpen={() => {}} stacked />);
        expect(screen.findHostByTestId('board-status:needs_you')).not.toBeNull();
        expect(screen.findHostByTestId('board-status:finished')).toBeNull();
    });

    it('moves a focused Canvas card one grid step per arrow key and saves once it rests', async () => {
        vi.useFakeTimers();
        const placed = MIXED[0]!;
        const commits: Record<string, { x: number; y: number }>[] = [];
        const screen = await renderScreen(
            <BoardCanvas
                cards={[placed]}
                positionsByItemRef={{ [placed.key]: { x: 48, y: 24 } }}
                snap
                onOpen={() => {}}
                onCommitPositions={(positions) => { commits.push({ ...positions }); }}
            />,
        );
        const target = screen.findHostByTestId(`board-canvas-card:${placed.key}`);
        const press = (key: string) => act(() => { target?.props.onKeyDown?.({ key, preventDefault: () => {} }); });
        await press('ArrowRight');
        await press('ArrowRight');
        await press('ArrowDown');
        expect(commits).toEqual([]);
        await act(async () => { vi.advanceTimersByTime(1000); });
        const step = BOARD_CANVAS_METRICS.gridStepPx;
        expect(commits).toEqual([{ [placed.key]: { x: 48 + 2 * step, y: 24 + step } }]);
    });

    it('offers a screen reader the same grid moves as named accessibility actions (touch, §5.1)', async () => {
        vi.useFakeTimers();
        const placed = MIXED[0]!;
        const commits: Record<string, { x: number; y: number }>[] = [];
        const screen = await renderScreen(
            <BoardCanvas
                cards={[placed]}
                positionsByItemRef={{ [placed.key]: { x: 48, y: 24 } }}
                snap
                onOpen={() => {}}
                onCommitPositions={(positions) => { commits.push({ ...positions }); }}
            />,
        );
        const target = screen.findHostByTestId(`board-canvas-card:${placed.key}`);
        const actions = (target?.props.accessibilityActions ?? []) as readonly { name: string }[];
        expect(actions.map((action) => action.name)).toEqual(expect.arrayContaining(['moveUp', 'moveDown', 'moveLeft', 'moveRight']));
        await act(() => { target?.props.onAccessibilityAction?.({ nativeEvent: { actionName: 'moveLeft' } }); });
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(commits).toEqual([{ [placed.key]: { x: 48 - BOARD_CANVAS_METRICS.gridStepPx, y: 24 } }]);
    });
});
