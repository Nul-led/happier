import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { buildSessionNavigationCursor } from '@/sync/domains/session/navigation/sessionNavigationCursor';
import {
    publishSessionNavigationCursor,
    resetSessionNavigationCursorForTests,
} from '@/sync/domains/session/navigation/sessionNavigationCursorStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sessionNamesState = vi.hoisted(() => ({
    bySessionId: {} as Record<string, string>,
    metadataBySessionId: {} as Record<string, Record<string, unknown>>,
    // Full-record overrides for sessions whose layout fields the synthesized
    // record cannot express (e.g. layout-1 shared metadata + owner view).
    recordOverridesBySessionId: {} as Record<string, Record<string, unknown>>,
    rowsByServerId: {} as Record<string, Record<string, Record<string, unknown>>>,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: ({ children, ...props }: any) => React.createElement('View', props, children),
    });
});

vi.mock('react-native-worklets', () => ({
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: Record<string, unknown>) => React.createElement('AgentIcon', props),
}));

vi.mock('@/components/sessions/presentation/SessionAgentCatalogIdentityIcon', () => ({
    SessionAgentCatalogIdentityIcon: (props: Record<string, unknown>) =>
        React.createElement('SessionAgentCatalogIdentityIcon', props),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    getCurrentAuth: () => null,
    // `useNavigateToSession` reads `refreshFromActiveServer` off the context here (it does
    // not in the origin repo), so the boundary stub has to supply it or every render that
    // reaches navigation throws before the assertion runs.
    useAuth: () => ({ refreshFromActiveServer: async () => undefined }),
}));

vi.mock('expo-router', () => createExpoRouterMock({}).module);

// The neighbour hook reads metadata imperatively (it runs in a host mounted on every route,
// so it must not hold a subscription per render). Seed the store the same way production reads it.
vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({
    storage: {
        getState: () => ({
            sessions: Object.fromEntries(
                Object.entries(sessionNamesState.bySessionId).map(([sessionId, name]) => [
                    sessionId,
                    {
                        metadata: { name, ...sessionNamesState.metadataBySessionId[sessionId] },
                        ...sessionNamesState.recordOverridesBySessionId[sessionId],
                    },
                ]),
            ),
            sessionListRowsByServerId: sessionNamesState.rowsByServerId,
        }),
    },
}));

type VisibleTestSession = string | Readonly<{ sessionId: string; serverId: string }>;

function publishVisibleSessionOrder(sessions: readonly VisibleTestSession[]): void {
    const cursor = buildSessionNavigationCursor({
        identity: { origin: 'session-list', sourceScopeKey: 'all', storageKind: 'all' },
        items: sessions.map((session) => typeof session === 'string'
            ? { type: 'session', sessionId: session }
            : { type: 'session', sessionId: session.sessionId, serverId: session.serverId }),
        nowMs: 1_000,
    });
    if (!cursor) throw new Error('test setup: cursor needs at least two sessions');
    publishSessionNavigationCursor(cursor);
}

type Harness = {
    progress?: { value: number };
    picker?: {
        direction: { value: 'previous' | 'next' | null };
        browseProgress: { value: number };
        rowOffset: { value: number };
        index: { value: number };
    };
    rerender?: () => void;
};

/**
 * Puts the shared values where a real gesture would. The capsule names what the gesture
 * has SELECTED, and the gesture always publishes the locked direction and the selected
 * index alongside the travel — so driving `progress` on its own would describe a state
 * production never produces.
 */
function steerTo(harness: Harness, direction: 'previous' | 'next', progress: number, index = 1): void {
    harness.progress!.value = progress;
    harness.picker!.direction.value = direction;
    harness.picker!.index.value = index;
    harness.rerender!();
}

async function renderReadout(sessionId: string, serverId?: string) {
    const harness: Harness = {};
    const { SessionCockpitLateralReadout } = await import('./SessionCockpitLateralReadout');
    const { SessionCockpitChromeRegistryProvider, useSessionLateralSwipe } = await import(
        '@/components/workspaceCockpit/session/SessionCockpitChromeRegistry'
    );

    function ReadoutHarness() {
        const swipe = useSessionLateralSwipe();
        // Remount on demand: the readout is memoised and reads progress from a shared
        // value, so a node test has to re-run its reaction explicitly.
        const [tick, force] = React.useReducer((current: number) => current + 1, 0);
        harness.progress = swipe.progress;
        harness.picker = swipe.picker as Harness['picker'];
        harness.rerender = force;
        return <SessionCockpitLateralReadout key={tick} sessionId={sessionId} serverId={serverId} />;
    }

    const screen = await renderScreen(
        <SessionCockpitChromeRegistryProvider>
            <ReadoutHarness />
        </SessionCockpitChromeRegistryProvider>,
    );
    return { harness, screen };
}

describe('SessionCockpitLateralReadout', () => {
    afterEach(() => {
        standardCleanup();
        resetSessionNavigationCursorForTests();
        sessionNamesState.bySessionId = {};
        sessionNamesState.metadataBySessionId = {};
        sessionNamesState.recordOverridesBySessionId = {};
        sessionNamesState.rowsByServerId = {};
    });

    it('adds no resting pixels to the capsule', async () => {
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
        const { screen } = await renderReadout('session-1');

        expect(screen.findAllHostsByTestId('session-cockpit-lateral-readout')).toHaveLength(0);
    });

    it('names the destination and its place in the captured order while the finger travels', async () => {
        sessionNamesState.bySessionId = { 'session-2': 'Refactor the parser' };
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
        const { harness, screen } = await renderReadout('session-1');

        act(() => {
            // Negative progress travels toward the NEXT session.
            steerTo(harness, 'next', -0.6);
        });

        expect(screen.findByTestId('session-cockpit-lateral-readout-title')?.props.children)
            .toBe('Refactor the parser');
        expect(screen.getTextContent()).toContain('3 of 3');
    });

    it('keeps an external destination machine-scoped through the catalog identity owner', async () => {
        sessionNamesState.bySessionId = { 'session-2': 'External destination' };
        sessionNamesState.metadataBySessionId['session-2'] = {
            machineId: 'machine_external',
            runtimeDescriptorV1: {
                v: 1,
                agentId: 'acme.plugin/ultracode',
                agent: {},
            },
        };
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
        const { harness, screen } = await renderReadout('session-1');

        act(() => {
            steerTo(harness, 'next', -0.6);
        });

        expect(screen.findAllByType('AgentIcon' as never)).toHaveLength(0);
        expect(screen.findByType('SessionAgentCatalogIdentityIcon' as never)?.props).toMatchObject({
            agentId: 'acme.plugin/ultracode',
            machineId: 'machine_external',
            serverId: null,
            size: 18,
        });
    });

    it('reads the exact Home row when another Home has the same session id', async () => {
        sessionNamesState.bySessionId = { 'same-session': 'Wrong Home title' };
        sessionNamesState.metadataBySessionId['same-session'] = {
            machineId: 'machine-a',
            runtimeDescriptorV1: {
                v: 1,
                agentId: 'acme.plugin/agent-a',
                agent: {},
            },
        };
        sessionNamesState.recordOverridesBySessionId['same-session'] = { serverId: 'server-a' };
        sessionNamesState.rowsByServerId = {
            'server-a': {
                'same-session': {
                    id: 'same-session',
                    metadata: { name: 'Wrong Home row', path: '/a' },
                },
            },
            'server-b': {
                'same-session': {
                    id: 'same-session',
                    metadata: {
                        name: 'Exact Home title',
                        path: '/b',
                        machineId: 'machine-b',
                        runtimeDescriptorV1: {
                            v: 1,
                            agentId: 'acme.plugin/agent-b',
                            agent: {},
                        },
                    },
                },
            },
        };
        publishVisibleSessionOrder([
            { sessionId: 'anchor', serverId: 'server-a' },
            { sessionId: 'same-session', serverId: 'server-b' },
        ]);
        const { harness, screen } = await renderReadout('anchor', 'server-a');

        act(() => {
            steerTo(harness, 'next', -0.6);
        });

        expect(screen.findByTestId('session-cockpit-lateral-readout-title')?.props.children)
            .toBe('Exact Home title');
        expect(screen.findByType('SessionAgentCatalogIdentityIcon' as never)?.props).toMatchObject({
            agentId: 'acme.plugin/agent-b',
            machineId: 'machine-b',
            serverId: 'server-b',
        });
    });

    it('resolves a novel layout-1 external Agent through the canonical presentation identity', async () => {
        // Layout-1 sessions carry the open Agent identity in their shared
        // metadata, which the strict shared envelope holds without any legacy
        // flavor or flat vendor key. The target must read the exact qualified
        // identity through the canonical presentation view — falling back to a
        // default bundled Agent here would paint that Agent's brand on a
        // session it never ran.
        sessionNamesState.bySessionId = { 'session-2': 'Novel destination' };
        sessionNamesState.recordOverridesBySessionId['session-2'] = {
            metadataLayoutVersion: 1,
            metadata: { v: 1, agentPresentation: { agentId: 'novel.plugin/novel-agent' } },
            ownerMetadataView: { machineId: 'machine_novel' },
        };
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
        const { harness, screen } = await renderReadout('session-1');

        act(() => {
            steerTo(harness, 'next', -0.6);
        });

        expect(screen.findAllByType('AgentIcon' as never)).toHaveLength(0);
        expect(screen.findByType('SessionAgentCatalogIdentityIcon' as never)?.props).toMatchObject({
            agentId: 'novel.plugin/novel-agent',
            machineId: 'machine_novel',
            serverId: null,
            size: 18,
        });
    });

    it('names the previous session when the finger travels the other way', async () => {
        sessionNamesState.bySessionId = { 'session-0': 'Fix the flaky test' };
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
        const { harness, screen } = await renderReadout('session-1');

        act(() => {
            steerTo(harness, 'previous', 0.6);
        });

        expect(screen.findByTestId('session-cockpit-lateral-readout-title')?.props.children)
            .toBe('Fix the flaky test');
        expect(screen.getTextContent()).toContain('1 of 3');
    });

    it('overlays the tab row absolutely so the capsule cannot resize mid-gesture', async () => {
        sessionNamesState.bySessionId = { 'session-2': 'Refactor the parser' };
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2']);
        const { harness, screen } = await renderReadout('session-1');

        act(() => {
            steerTo(harness, 'next', -0.6);
        });

        const readout = screen.findHostByTestId('session-cockpit-lateral-readout');
        const styles = (Array.isArray(readout?.props.style) ? readout?.props.style : [readout?.props.style])
            .filter((style): style is Record<string, unknown> => Boolean(style) && typeof style === 'object');
        expect(styles.some((style) => style.position === 'absolute')).toBe(true);
        expect(readout?.props.pointerEvents).toBe('none');
    });

    it('promises nothing while rubber-banding against an end of the order', async () => {
        publishVisibleSessionOrder(['session-0', 'session-1']);
        const { harness, screen } = await renderReadout('session-1');

        act(() => {
            // At the last entry a further left-drag has no destination to name, so the
            // gesture locks the direction with nothing selected.
            steerTo(harness, 'next', -0.12, 0);
        });

        expect(screen.findAllHostsByTestId('session-cockpit-lateral-readout')).toHaveLength(0);
    });

    it('names the scrubbed row, not the immediate neighbour, once the picker is open', async () => {
        sessionNamesState.bySessionId = {
            'session-2': 'Refactor the parser',
            'session-3': 'Ship the release notes',
        };
        publishVisibleSessionOrder(['session-0', 'session-1', 'session-2', 'session-3']);
        const { harness, screen } = await renderReadout('session-1');

        act(() => {
            // Two rows into the picker: the capsule IS the picker's selection window, so
            // it must name the row that has descended into it.
            harness.picker!.browseProgress.value = 1;
            harness.picker!.rowOffset.value = 1;
            steerTo(harness, 'next', -0.2, 2);
        });

        expect(screen.findByTestId('session-cockpit-lateral-readout-title')?.props.children)
            .toBe('Ship the release notes');
        expect(screen.getTextContent()).toContain('4 of 4');
    });
});
