import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installNavigationShellCommonModuleMocks } from '@/components/navigation/shell/navigationShellTestHelpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const healthState = vi.hoisted(() => ({ kind: 'connecting' as string }));
const retrySpy = vi.hoisted(() => vi.fn(async () => {}));

installNavigationShellCommonModuleMocks({
    // Keep translation params visible, so the Home's name can be asserted.
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock();
    },
});

// The canonical connection-health owner (Homes program) is this gate's input: its kind decides.
vi.mock('@/components/navigation/connectionStatus/useConnectionHealth', () => ({
    useActiveHomeConnectionHealth: () => ({ kind: healthState.kind }),
}));

// The connection manager (network boundary) applies a Home and reconnects it. During a switch the
// applied Home (whose health is reported) differs from the requested one; the gate names the applied.
vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    retryActiveServerConnection: retrySpy,
    getAppliedActiveServerId: () => 'srv_applied',
    subscribeAppliedActiveServer: () => () => {},
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    getServerProfileById: (id: string) => (id === 'srv_applied'
        ? { id: 'srv_applied', name: 'Studio', serverUrl: 'https://studio.example.test' }
        : { id, name: 'Elsewhere', serverUrl: 'https://elsewhere.example.test' }),
}));

vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'srv_requested', serverUrl: 'https://elsewhere.example.test', generation: 1 }),
}));

describe('HomeReachabilityGate', () => {
    beforeAll(async () => {
        await import('./HomeReachabilityGate');
    }, 300_000);
    afterEach(() => {
        standardCleanup();
        retrySpy.mockClear();
        healthState.kind = 'connecting';
    });

    it('keeps the quiet loading state while the Home is still connecting', async () => {
        const { HomeReachabilityGate } = await import('./HomeReachabilityGate');
        const screen = await renderScreen(
            <HomeReachabilityGate variant="pane">{React.createElement('QuietLoading')}</HomeReachabilityGate>,
        );
        expect(screen.findAllByType('QuietLoading' as never)).toHaveLength(1);
        expect(screen.findAllByTestId('home-unreachable')).toHaveLength(0);
    });

    it.each(['server_unreachable', 'server_error'])('says the Home cannot be reached, by name, with Retry (%s)', async (kind) => {
        healthState.kind = kind;
        const { HomeReachabilityGate } = await import('./HomeReachabilityGate');
        const screen = await renderScreen(
            <HomeReachabilityGate variant="pane">{React.createElement('QuietLoading')}</HomeReachabilityGate>,
        );

        expect(screen.findAllByType('QuietLoading' as never)).toHaveLength(0);
        expect(screen.findAllByTestId('home-unreachable').length).toBeGreaterThan(0);
        // The Home whose health is reported, not the one being switched to.
        expect(screen.getTextContent()).toContain('Studio');
        expect(screen.getTextContent()).not.toContain('Elsewhere');
        screen.pressByTestId('home-unreachable-retry');
        expect(retrySpy).toHaveBeenCalledTimes(1);
    });

    it('offers the same Retry as a quiet line in a list', async () => {
        healthState.kind = 'server_unreachable';
        const { HomeReachabilityGate } = await import('./HomeReachabilityGate');
        const screen = await renderScreen(
            <HomeReachabilityGate variant="line">{React.createElement('SkeletonRows')}</HomeReachabilityGate>,
        );

        expect(screen.findAllByType('SkeletonRows' as never)).toHaveLength(0);
        screen.pressByTestId('home-unreachable-retry');
        expect(retrySpy).toHaveBeenCalledTimes(1);
    });

    it('does not report the active Home for a list scoped only to another Home', async () => {
        healthState.kind = 'server_unreachable';
        const { HomeReachabilityGate } = await import('./HomeReachabilityGate');
        const screen = await renderScreen(
            <HomeReachabilityGate variant="line" relevantServerIds={['srv_other']}>
                {React.createElement('OtherHomeRows')}
            </HomeReachabilityGate>,
        );

        expect(screen.findAllByType('OtherHomeRows' as never)).toHaveLength(1);
        expect(screen.findAllByTestId('home-unreachable')).toHaveLength(0);
    });
});
