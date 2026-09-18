import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import type { ExpoRouterParams } from '@/dev/testkit/mocks/router';

const routeState = vi.hoisted(() => ({ params: {} as ExpoRouterParams }));
const setParams = vi.hoisted(() => vi.fn((next: ExpoRouterParams) => {
    Object.assign(routeState.params, next);
}));
const newSessionMounted = vi.hoisted(() => vi.fn());
const surfaceStateCardProps = vi.hoisted(() => ({ value: null as any }));
// Lifetime- and scope-sensitive Account state: a same-server Account A→B
// switch retires the A-era authority exactly like the real scope owner.
const accountScopeState = vi.hoisted(() => ({
    value: { serverId: 'server-1', accountId: 'account-1' } as { serverId: string; accountId: string } | null,
}));
const authorityCaptures = vi.hoisted(() => ({ list: [] as Array<{ serverId: string; accountId: string }> }));
// Live source-turn truth, independent of route params, so staleness can be
// simulated while the mounted binding keeps the observed identity.
const liveTurn = vi.hoisted(() => ({ value: 'turn-7' }));
const workflowScheduleSeedState = vi.hoisted(() => ({
    value: null as null | Readonly<Record<string, unknown>>,
}));
const handoffSeedState = vi.hoisted(() => ({
    value: null as null | Readonly<Record<string, unknown>>,
}));
const automationWrapperMounts = vi.hoisted(() => vi.fn());
const automationWrapperLifetime = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const harness = createExpoRouterMock({
        router: { setParams },
        params: () => routeState.params,
    });
    return {
        ...harness.module,
        useRouter: () => ({ ...harness.state.router, setParams }),
    };
});
// The New Session screen must no longer be an Automation authoring surface.
vi.mock('@/app/(app)/new/index', () => ({ default: () => {
    newSessionMounted(routeState.params);
    return React.createElement('NewSessionScreen');
} }));
vi.mock('@/components/automations/gating/AutomationsGate', () => ({
    AutomationsGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/ui/surfaces/SurfaceStateCard', () => ({
    SurfaceStateCard: (props: any) => {
        surfaceStateCardProps.value = props;
        return React.createElement('SurfaceStateCard', props);
    },
}));
vi.mock('@/sync/domains/workflows/workflowScheduleSeed', () => ({
    readWorkflowScheduleSeed: () => workflowScheduleSeedState.value,
}));
vi.mock('@/sync/domains/workflows/newSessionAutomationHandoffSeed', () => ({
    readNewSessionAutomationHandoffSeed: () => handoffSeedState.value,
}));
vi.mock('@/components/workflows/screens/WorkflowAutomationCreateScreen', () => ({
    WorkflowAutomationCreateScreen: (props: Readonly<Record<string, unknown>>) => {
        automationWrapperMounts(props);
        React.useEffect(() => {
            automationWrapperLifetime.mounts += 1;
            return () => { automationWrapperLifetime.unmounts += 1; };
        }, []);
        return React.createElement('WorkflowAutomationCreateScreen');
    },
}));
vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({ useHydrateSessionForRoute: () => ({ kind: 'ready' }) }));
vi.mock('@/hooks/server/useAutomationsSupport', () => ({ useAutomationsSupport: () => ({ enabled: true }) }));
vi.mock('@/sync/domains/session/sessionRouteHydrationState', () => ({ isSessionRouteHydrationAvailable: () => true }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: routeState.params.sourceServerId ?? 'server-1' }),
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => {
        const scope = accountScopeState.value;
        if (!scope) return null;
        return {
            scope,
            isCurrent: () => {
                const current = accountScopeState.value;
                return !!current
                    && current.serverId === scope.serverId
                    && current.accountId === scope.accountId;
            },
            onRetire: () => ({ dispose: () => {} }),
        };
    },
}));
vi.mock('@/sync/domains/automations/sessionAutomationAuthority', () => ({
    captureSessionAutomationAuthority: () => {
        const scope = accountScopeState.value;
        if (!scope) return null;
        authorityCaptures.list.push({ ...scope });
        return {
            serverId: scope.serverId,
            accountLifetime: { onRetire: () => ({ dispose: () => {} }) },
            isCurrent: () => {
                const current = accountScopeState.value;
                return !!current
                    && current.serverId === scope.serverId
                    && current.accountId === scope.accountId;
            },
        };
    },
}));
vi.mock('@/sync/domains/state/storage', () => ({
    storage: { getState: () => ({ sessions: routeState.params.sourceSessionId ? {
        [routeState.params.sourceSessionId as string]: {
            id: routeState.params.sourceSessionId,
            serverId: routeState.params.sourceServerId,
            latestTurnId: liveTurn.value,
            latestTurnStatus: 'in_progress',
        },
    } : {} }) },
    useSession: () => routeState.params.sourceSessionId ? ({
        id: routeState.params.sourceSessionId,
        serverId: routeState.params.sourceServerId,
        latestTurnId: liveTurn.value,
        latestTurnStatus: 'in_progress',
    }) : null,
    useActiveServerAccountScope: () => accountScopeState.value,
}));

describe('/automations/new', () => {
    beforeEach(() => {
        routeState.params = {};
        setParams.mockClear();
        newSessionMounted.mockClear();
        surfaceStateCardProps.value = null;
        accountScopeState.value = { serverId: 'server-1', accountId: 'account-1' };
        authorityCaptures.list.length = 0;
        liveTurn.value = 'turn-7';
        workflowScheduleSeedState.value = null;
        handoffSeedState.value = null;
        automationWrapperMounts.mockClear();
        automationWrapperLifetime.mounts = 0;
        automationWrapperLifetime.unmounts = 0;
    });

    it('mounts the one shared Automation editor for ordinary creation', async () => {
        const { default: Route } = await import('@/app/(app)/automations/new');
        await renderScreen(<Route />);

        expect(automationWrapperMounts).toHaveBeenCalledWith({ handoff: null });
        // The New Session screen is no longer a second Automation authoring
        // surface, so ordinary creation never mounts it.
        expect(newSessionMounted).not.toHaveBeenCalled();
    });

    it('consumes a reviewed workflow Schedule seed', async () => {
        const seed = {
            name: 'Release check',
            project: { machineId: 'machine-1', directory: '/repo' },
            definition: { version: 1, inputs: [], defaults: {}, blocks: [] },
            origin: null,
        };
        workflowScheduleSeedState.value = seed;
        routeState.params = { workflowSeedId: 'reviewed-seed' };

        const { default: Route } = await import('@/app/(app)/automations/new');
        await renderScreen(<Route />);

        expect(automationWrapperMounts).toHaveBeenCalledWith({ seed });
        expect(newSessionMounted).not.toHaveBeenCalled();
    });

    it('opens the composed New Session draft handed over by the Automation chip', async () => {
        const handoff = {
            name: 'Nightly notes',
            description: null,
            enabled: true,
            draft: { draftId: 'handoff', name: 'Nightly notes', inputs: [], defaults: {}, blocks: [] },
            project: { machineId: 'machine-1', directory: '/repo' },
            triggers: [],
        };
        handoffSeedState.value = handoff;
        routeState.params = { newSessionDraftSeedId: 'composed-draft' };

        const { default: Route } = await import('@/app/(app)/automations/new');
        await renderScreen(<Route />);

        expect(automationWrapperMounts).toHaveBeenCalledWith({ handoff });
        expect(newSessionMounted).not.toHaveBeenCalled();
    });

    it('still opens the editor when an expired handoff can no longer be read', async () => {
        routeState.params = { newSessionDraftSeedId: 'expired' };

        const { default: Route } = await import('@/app/(app)/automations/new');
        await renderScreen(<Route />);

        expect(automationWrapperMounts).toHaveBeenCalledWith({ handoff: null });
        expect(surfaceStateCardProps.value).toBeNull();
    });

    it('fails a partial exact-turn tuple closed instead of composing generically', async () => {
        routeState.params = {
            sourceSessionId: 'source-session',
            sourceServerId: 'server-1',
        };
        const { default: Route } = await import('@/app/(app)/automations/new');
        await renderScreen(<Route />);

        expect(surfaceStateCardProps.value).toMatchObject({
            testID: 'new-automation-exact-turn-invalid',
        });
        expect(automationWrapperMounts).not.toHaveBeenCalled();
    });

    it('seeds the exact observed Session and turn as the wrapper trigger', async () => {
        routeState.params = {
            sourceSessionId: 'source-session',
            sourceTurnId: 'turn-7',
            sourceServerId: 'server-1',
        };
        const { default: Route } = await import('@/app/(app)/automations/new');
        await renderScreen(<Route />);

        expect(automationWrapperMounts).toHaveBeenCalledWith(expect.objectContaining({
            initialTriggers: [{
                kind: 'sessionLifecycle',
                enabled: true,
                sourceSessionId: 'source-session',
                events: ['parentTurnCompleted'],
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-7' },
            }],
        }));
        expect(newSessionMounted).not.toHaveBeenCalled();
    });

    it('rebinds the exact-turn authority under the new Account instead of staying retired', async () => {
        routeState.params = {
            sourceSessionId: 'source-session',
            sourceTurnId: 'turn-7',
            sourceServerId: 'server-1',
        };
        const { default: Route } = await import('@/app/(app)/automations/new');
        const screen = await renderScreen(<Route />);
        expect(automationWrapperLifetime).toEqual({ mounts: 1, unmounts: 0 });
        await act(async () => {});

        expect(surfaceStateCardProps.value).toBeNull();

        // Same server, Account B mounts: the A-era authority retires; the
        // route must rebind under B instead of rendering a permanent error.
        accountScopeState.value = { serverId: 'server-1', accountId: 'account-2' };
        await screen.update(<Route />);
        await act(async () => {});

        expect(authorityCaptures.list.at(-1)).toMatchObject({ serverId: 'server-1', accountId: 'account-2' });
        expect(surfaceStateCardProps.value).toBeNull();
    });

    it('keeps the chosen lifecycle events when explicitly adopting the current turn', async () => {
        routeState.params = {
            sourceSessionId: 'source-session',
            sourceTurnId: 'turn-7',
            sourceServerId: 'server-1',
            sessionLifecycleEvents: 'parentTurnFailed,userActionRequired',
        };
        const { default: Route } = await import('@/app/(app)/automations/new');
        const screen = await renderScreen(<Route />);

        // The source turn advances while composing: typed stale truth is
        // offered instead of silently retargeting.
        liveTurn.value = 'turn-8';
        await screen.update(<Route />);
        await act(async () => {});

        const stale = screen.findByProps({ testID: 'new-automation-exact-turn-stale' });
        expect(stale.props.kind).toBe('warning');
        // Staleness is a review state over the mounted draft, not a reason to
        // discard the person's Automation metadata, Workflow or extra triggers.
        expect(automationWrapperLifetime).toEqual({ mounts: 1, unmounts: 0 });
        await act(async () => stale.props.action.onPress());
        await act(async () => {});

        // Adoption retargets the turn only. The event selection is the
        // author's, so neither URL truth nor the seeded trigger may fall back
        // to the observation default.
        expect(setParams).toHaveBeenCalledWith(expect.objectContaining({
            sourceTurnId: 'turn-8',
            sessionLifecycleEvents: 'parentTurnFailed,userActionRequired',
        }));
        expect(automationWrapperMounts).toHaveBeenLastCalledWith(expect.objectContaining({
            initialTriggers: [expect.objectContaining({
                events: ['parentTurnFailed', 'userActionRequired'],
                policy: { kind: 'currentTurn', sourceTurnId: 'turn-8' },
            })],
        }));
        expect(automationWrapperLifetime).toEqual({ mounts: 1, unmounts: 0 });
    });
});
