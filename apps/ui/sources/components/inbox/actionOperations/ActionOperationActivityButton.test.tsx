import * as React from 'react';
import { View } from 'react-native';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionOperationSnapshotV1 } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';
import type { ActionOperationProjection } from '@/sync/domains/actionOperations/actionOperationSelectors';

const activityHookState = vi.hoisted(() => ({
    operations: [] as ActionOperationProjection[],
    summary: { activeCount: 0, hasAttention: false },
    useAllActionOperations: vi.fn(),
}));

vi.mock('@/sync/domains/actionOperations/useActionOperations', () => ({
    useActionOperationActivitySummary: () => activityHookState.summary,
    useActionOperationsHaveAttention: () => activityHookState.summary.hasAttention,
    useAllActionOperations: () => {
        activityHookState.useAllActionOperations();
        return activityHookState.operations;
    },
}));

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
    return createTextModuleMock({ translate: (key: string) => key === 'inbox.updates' ? 'Activity' : key });
});

const capturedPopoverProps: { current: Readonly<Record<string, unknown>> | null } = { current: null };
type CapturedPopoverProps = Readonly<Record<string, unknown>> & Readonly<{
    open: boolean;
    children: React.ReactNode | ((renderProps: Readonly<{ maxHeight: number; maxWidth: number; placement: 'bottom' }>) => React.ReactNode);
}>;
vi.mock('@/components/ui/popover', () => ({
    Popover: React.memo((props: CapturedPopoverProps) => {
        capturedPopoverProps.current = props;
        if (!props.open) return null;
        const content = typeof props.children === 'function'
            ? props.children({ maxHeight: 560, maxWidth: 396, placement: 'bottom' })
            : props.children;
        return <View testID="action-operation-activity-popover">{content}</View>;
    }),
}));
vi.mock('@/components/ui/overlays/FloatingOverlay', () => ({
    FloatingOverlay: React.memo((props: { children: React.ReactNode }) => <View>{props.children}</View>),
}));

function operation(overrides: Partial<ActionOperationSnapshotV1> = {}): ActionOperationProjection {
    return {
        serverId: 'server-1',
        snapshot: {
            version: 1,
            operationId: 'operation-1',
            revision: 1,
            actionId: 'session.fork',
            state: 'running',
            scope: { accountId: 'account-1', machineId: 'machine-1', sessionId: 'session-1' },
            title: 'Fork session',
            createdAt: 100,
            startedAt: 110,
            cancellation: 'unsupported',
            ...overrides,
        },
        observation: 'available',
        isUnavailableProjection: false,
    };
}

describe('ActionOperationActivityButtonView', () => {
    afterEach(() => {
        activityHookState.operations = [];
        activityHookState.summary = { activeCount: 0, hasAttention: false };
        activityHookState.useAllActionOperations.mockClear();
    });

    it('stays absent when there is no active or unseen operation', async () => {
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[]}
                hasAttention={false}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={() => {}}
            />,
        );

        expect(screen.findByTestId('action-operation-activity-button')).toBeNull();
    });

    it('opens the shared responsive ledger and preserves its portal contract', async () => {
        const onOpenOperation = vi.fn();
        const markSeen = vi.fn();
        const projectedOperation = operation();
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[projectedOperation]}
                hasAttention={true}
                preferredSessionAddress={{ serverId: 'server-1', sessionId: 'session-1' }}
                onOpenOperation={onOpenOperation}
                onMarkVisibleTerminalSeen={markSeen}
            />,
        );

        await act(async () => {
            await screen.findByTestId('action-operation-activity-button')?.props.onPress({
                currentTarget: {
                    getBoundingClientRect: () => ({ left: 262, top: 6, width: 44, height: 44 }),
                },
            });
        });

        expect(screen.findByTestId('action-operation-activity-popover')).not.toBeNull();
        expect(screen.findByTestId('inbox.action-operation.operation-1')).not.toBeNull();
        expect(capturedPopoverProps.current?.placement).toBe('bottom');
        expect(capturedPopoverProps.current?.anchor).toEqual({
            kind: 'rect',
            rect: { left: 262, top: 6, width: 44, height: 44 },
            coordinateSpace: 'window',
        });
        expect(capturedPopoverProps.current?.boundaryRef).toBeNull();
        expect(capturedPopoverProps.current?.portal).toEqual({
            web: { target: 'body' },
            native: true,
            matchAnchorWidth: false,
            anchorAlign: 'end',
        });
        expect(markSeen).toHaveBeenCalled();

        act(() => {
            screen.findByTestId('inbox.action-operation.operation-1')?.props.onPress();
        });
        expect(onOpenOperation).toHaveBeenCalledWith(projectedOperation);
        expect(screen.findByTestId('action-operation-activity-popover')).toBeNull();
    });

    it('opens the exact Home-qualified projection when operation ids collide across Homes', async () => {
        const onOpenOperation = vi.fn();
        const first = operation();
        const second = { ...operation(), serverId: 'server-2' };
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[first, second]}
                hasAttention={true}
                onOpenOperation={onOpenOperation}
                onMarkVisibleTerminalSeen={() => {}}
            />,
        );

        await screen.pressByTestIdAsync('action-operation-activity-button');
        const matchingRows = screen.findAllByTestId('inbox.action-operation.operation-1')
            .filter((node) => typeof node.type === 'string');
        expect(matchingRows).toHaveLength(2);

        act(() => matchingRows[1]?.props.onPress());
        expect(onOpenOperation).toHaveBeenCalledWith(second);
        expect(onOpenOperation).not.toHaveBeenCalledWith(first);
    });

    it('keeps an unseen terminal ledger mounted while marking it seen', async () => {
        const markSeen = vi.fn();
        const clearRecent = vi.fn();
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[operation({ state: 'succeeded', settledAt: 200 })]}
                hasAttention={true}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={markSeen}
                onClearRecent={clearRecent}
            />,
        );

        await screen.pressByTestIdAsync('action-operation-activity-button');
        expect(screen.findByTestId('action-operation-activity-popover')).not.toBeNull();
        expect(markSeen).toHaveBeenCalled();

        await screen.pressByTestIdAsync('action-operations-clear-recent');
        expect(clearRecent).toHaveBeenCalledOnce();
        expect(screen.findByTestId('action-operation-activity-popover')).toBeNull();
    });

    it('uses an attention dot instead of counting unavailable active projections', async () => {
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[{ ...operation(), observation: 'unavailable', isUnavailableProjection: true }]}
                hasAttention={true}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={() => {}}
            />,
        );

        expect(screen.findByTestId('action-operation-activity-attention-dot')).not.toBeNull();
        expect(screen.findByTestId('action-operation-activity-count')).toBeNull();
    });

    it('counts a listed active row but not an omitted active row from the same machine', async () => {
        const { ActionOperationActivityButtonView } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(
            <ActionOperationActivityButtonView
                operations={[
                    operation({ operationId: 'operation-listed' }),
                    {
                        ...operation({ operationId: 'operation-omitted' }),
                        observation: 'unavailable',
                        isUnavailableProjection: true,
                    },
                ]}
                hasAttention={true}
                onOpenOperation={() => {}}
                onMarkVisibleTerminalSeen={() => {}}
            />,
        );

        expect(screen.findByTestId('action-operation-activity-count')).not.toBeNull();
        expect(screen.getTextContent()).toContain('1');
        expect(screen.findByTestId('action-operation-activity-attention-dot')).toBeNull();
    });

    it('subscribes to ledger details only while the activity popover is open', async () => {
        activityHookState.operations = [operation()];
        activityHookState.summary = { activeCount: 1, hasAttention: true };
        const { ActionOperationActivityButton } = await import('./ActionOperationActivityButton');
        const screen = await renderScreen(<ActionOperationActivityButton />);

        expect(screen.findByTestId('action-operation-activity-count')).not.toBeNull();
        expect(activityHookState.useAllActionOperations).not.toHaveBeenCalled();

        await screen.pressByTestIdAsync('action-operation-activity-button');

        expect(activityHookState.useAllActionOperations).toHaveBeenCalledOnce();
        expect(screen.findByTestId('inbox.action-operation.operation-1')).not.toBeNull();
    });
});
