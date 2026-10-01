import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installUiListsCommonModuleMocks } from './uiListsTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installUiListsCommonModuleMocks();

// The canonical connection-health owner decides whether the Home this device uses answers; the
// connection manager (network boundary) names the Home it applied.
const healthState = vi.hoisted(() => ({ kind: 'connected' as string }));
vi.mock('@/components/navigation/connectionStatus/useConnectionHealth', () => ({
    useActiveHomeConnectionHealth: () => ({ kind: healthState.kind }),
}));
vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    retryActiveServerConnection: vi.fn(async () => {}),
    getAppliedActiveServerId: () => 'srv_studio',
    subscribeAppliedActiveServer: () => () => {},
}));
vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'srv_studio', serverUrl: 'https://studio.example.test', generation: 1 }),
}));

const { ItemLoadStateRows } = await import('./ItemLoadStateRows');

type Screen = Awaited<ReturnType<typeof renderScreen>>;

function hostTexts(screen: Screen): string[] {
    return screen.root
        .findAll((node) => typeof node.type === 'string' && typeof node.props.children === 'string')
        .map((node) => node.props.children as string);
}

describe('ItemLoadStateRows: a read from the Home this device uses', () => {
    const failedOnStudio = (onRetry: () => void, homeServerIds: readonly string[] = ['srv_studio']) => (
        <ItemLoadStateRows
            testID="retention"
            state={{ kind: 'failed', reason: "Couldn't read this Home's retention policy", onRetry, homeServerIds }}
        />
    );

    it('defers to the page\'s "can\'t reach" banner while that Home is unreachable: no second failure, no second Retry', async () => {
        healthState.kind = 'server_unreachable';
        const onRetry = vi.fn();
        const screen = await renderScreen(failedOnStudio(onRetry));

        expect(hostTexts(screen)).not.toContain("Couldn't read this Home's retention policy");
        expect(hostTexts(screen)).toContain('sidebarFooter.availableWhenHomeAnswers');
        expect(screen.findHostByTestId('retention-retry')).toBeNull();
        healthState.kind = 'connected';
    });

    it('reads again by itself once the Home answers, so the banner\'s Retry re-reads every deferred section', async () => {
        healthState.kind = 'server_unreachable';
        const onRetry = vi.fn();
        const screen = await renderScreen(failedOnStudio(onRetry));
        expect(onRetry).not.toHaveBeenCalled();

        healthState.kind = 'connected';
        await screen.update(failedOnStudio(onRetry));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps its own failure and Retry when the Home answers but this read failed, or the read needs another Home', async () => {
        healthState.kind = 'connected';
        const answered = await renderScreen(failedOnStudio(vi.fn()));
        expect(hostTexts(answered)).toContain("Couldn't read this Home's retention policy");
        expect(answered.findHostByTestId('retention-retry')).not.toBeNull();
        await answered.unmount();

        healthState.kind = 'server_unreachable';
        const elsewhere = await renderScreen(failedOnStudio(vi.fn(), ['srv_studio', 'srv_lab']));
        expect(hostTexts(elsewhere)).toContain("Couldn't read this Home's retention policy");
        expect(elsewhere.findHostByTestId('retention-retry')).not.toBeNull();
        healthState.kind = 'connected';
    });
});

describe('ItemLoadStateRows', () => {
    it('reserves the section rows as a busy placeholder while loading, with no "Loading…" text row', async () => {
        const screen = await renderScreen(
            <ItemLoadStateRows testID="pools" state={{ kind: 'loading' }} rows={3} accessibilityLabel="Loading machine pools" />,
        );
        const region = screen.findHostByTestId('pools');
        expect(region?.props.accessibilityState).toEqual({ busy: true });
        expect(region?.props.accessibilityLabel).toBe('Loading machine pools');
        expect(screen.root.findAll((node) => typeof node.type === 'string' && /^pools-skeleton:\d$/.test(String(node.props.testID)))).toHaveLength(3);
        expect(hostTexts(screen).some((text) => /loading/i.test(text))).toBe(false);
    });

    it('turns into one row that says what failed, with Retry, when the source fails', async () => {
        const onRetry = vi.fn();
        const screen = await renderScreen(
            <ItemLoadStateRows
                testID="pools"
                state={{ kind: 'failed', reason: "Couldn't read machine pools on Studio", onRetry }}
                rows={3}
                accessibilityLabel="Loading machine pools"
            />,
        );
        expect(hostTexts(screen)).toContain("Couldn't read machine pools on Studio");
        expect(screen.root.findAll((node) => typeof node.type === 'string' && /^pools-skeleton:/.test(String(node.props.testID)))).toHaveLength(0);
        expect(screen.findHostByTestId('pools')?.props.accessibilityState?.busy).not.toBe(true);
        await screen.pressByTestIdAsync('pools-retry');
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('offers no Retry when the failure cannot be retried from here', async () => {
        const screen = await renderScreen(
            <ItemLoadStateRows testID="pools" state={{ kind: 'failed', reason: 'This Home needs an update' }} rows={2} />,
        );
        expect(hostTexts(screen)).toContain('This Home needs an update');
        expect(screen.findHostByTestId('pools-retry')).toBeNull();
    });
});
