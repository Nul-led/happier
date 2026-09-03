import * as React from 'react';
import { act, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SelectionListOption, SelectionListStep } from '@/components/ui/selectionList';
import { createDeferred, renderScreen } from '@/dev/testkit';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { createPassThroughModule } from '@/dev/testkit/mocks/components';

const routerMock = vi.hoisted(() => ({
    push: vi.fn(),
    back: vi.fn(),
    setParams: vi.fn(),
}));
const refreshState = vi.hoisted(() => ({
    reject: false,
    deferred: null as null | ReturnType<typeof createDeferred<void>>,
}));
const refreshAutomationsSpy = vi.hoisted(() => vi.fn(async () => {
    if (refreshState.deferred) await refreshState.deferred.promise;
    if (refreshState.reject) throw new Error('offline');
}));
const loadMoreAutomationsSpy = vi.hoisted(() => vi.fn(async () => ({ nextCursor: null })));
const detailFailureState = vi.hoisted(() => ({ ids: new Set<string>() }));
const refreshAutomationDefinitionDetailSpy = vi.hoisted(() => vi.fn(async (automationId: string) => {
    const automation = state.automations.find((candidate) => candidate.id === automationId);
    if (!automation) throw new Error('missing automation');
    if (detailFailureState.ids.has(automationId)) throw new Error('offline');
    state.automations = state.automations.map((candidate) => candidate.id === automationId ? {
        ...candidate,
        linkedExistingSessionId: automationId === 'same-session-target'
            ? 'source-session'
            : 'different-session',
        detail: { kind: 'loaded' },
    } : candidate);
}));
// Lifetime- and scope-sensitive Account state: a same-server Account A→B
// switch retires the A-era lifetime exactly like the real scope owner.
const accountScopeState = vi.hoisted(() => ({
    value: { serverId: 'server-1', accountId: 'account-1' } as { serverId: string; accountId: string } | null,
}));
const routeRemovalState = vi.hoisted(() => ({
    active: false,
    consume: null as null | (() => boolean),
}));
const androidBackState = vi.hoisted(() => ({
    enabled: false,
    handler: null as null | (() => boolean),
}));
const state = vi.hoisted(() => ({
    session: {
        id: 'source-session',
        serverId: 'server-1',
        metadata: { flavor: 'acp:test-backend' },
        latestTurnId: 'turn-observed',
        latestTurnStatus: 'in_progress',
    } as any,
    automations: [] as any[],
    nextCursor: null as string | null,
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: {
            push: routerMock.push,
            back: routerMock.back,
            setParams: routerMock.setParams,
        },
    }).module;
});
vi.mock('@/components/ui/selectionList', () => createPassThroughModule(['SelectionListScreen']));
vi.mock('@/components/ui/surfaces/SurfaceStateCard', () => createPassThroughModule(['SurfaceStateCard']));
vi.mock('@/utils/navigation/RouteRemovalStepConsumer', () => ({
    RouteRemovalStepConsumer: (props: Readonly<{ active: boolean; consume: () => boolean }>) => {
        routeRemovalState.active = props.active;
        routeRemovalState.consume = props.consume;
        return null;
    },
}));
vi.mock('@/components/ui/overlays/NativeBackLayerBoundary', () => ({
    useNativeBackLayerBackHandler: (enabled: boolean, handler: () => boolean) => {
        androidBackState.enabled = enabled;
        androidBackState.handler = handler;
    },
}));
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useSession: () => state.session,
        useAutomations: () => state.automations,
        useAutomationDefinitionNextCursor: () => state.nextCursor,
        useActiveServerAccountScope: () => accountScopeState.value,
        storage: {
            getState: () => ({ sessions: { [state.session.id]: state.session } }),
        },
    });
});
vi.mock('@/sync/sync', () => ({
    sync: {
        refreshAutomations: refreshAutomationsSpy,
        refreshAutomationDefinitionDetail: refreshAutomationDefinitionDetailSpy,
        loadMoreAutomations: loadMoreAutomationsSpy,
    },
}));
vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'server-1' }),
}));
vi.mock('@/hooks/server/useAutomationsSupport', () => ({
    useAutomationsSupport: () => ({ enabled: true }),
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-1' }),
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
            onRetire: () => ({ dispose: () => undefined }),
        };
    },
}));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});
vi.mock('@/utils/platform/deferOnWeb', () => ({
    navigateWithBlurOnWeb: (action: () => void) => action(),
}));

const observed = {
    sourceSessionId: 'source-session',
    sourceTurnId: 'turn-observed',
    sourceServerId: 'server-1',
    events: ['parentTurnCompleted'] as const,
} as const;

function destinationStepFromEventPicker(eventPicker: { props: {
    rootStep: {
        sections: ReadonlyArray<{
            options: ReadonlyArray<Readonly<{ id: string; openStep?: SelectionListStep }>>;
        }>;
    };
} }): SelectionListStep {
    const option = eventPicker.props.rootStep.sections[0]!.options.find(
        (candidate) => candidate.id === 'parentTurnFailed',
    );
    if (!option || option.openStep === undefined) {
        throw new Error('the lifecycle Event row does not open a destination step');
    }
    return option.openStep;
}

async function activateDestination(
    screen: Awaited<ReturnType<typeof renderScreen>>,
): Promise<ReactTestInstance> {
    const eventPicker = screen.findByProps({ testID: 'exact-turn-automation-event-picker' });
    const destinationStep = destinationStepFromEventPicker(eventPicker);
    await act(async () => {
        eventPicker.props.onActiveStepChange(destinationStep);
    });
    return screen.findByProps({ testID: 'exact-turn-automation-destination' });
}

/**
 * The SelectionList owns the step stack: the destination is a pushed step, so
 * the mounted list keeps the Event step as its `rootStep` and republishes the
 * live destination content through the controlled active-step mirror.
 */
function activeDestinationStep(
    picker: { props: { syncActiveStep: SelectionListStep | null } },
): SelectionListStep {
    const step = picker.props.syncActiveStep;
    if (!step) throw new Error('no destination step is active');
    return step;
}

/** The destination step opens with the one static options section the screen authors. */
function staticDestinationSectionOptions(step: SelectionListStep): ReadonlyArray<SelectionListOption> {
    const section = step.sections[0];
    if (!section || section.kind !== 'static') {
        throw new Error('the destination step does not open a static options section');
    }
    return section.options;
}

describe('ExactTurnAutomationDestinationScreen', () => {
    beforeEach(() => {
        routerMock.push.mockClear();
        routerMock.back.mockClear();
        routerMock.setParams.mockClear();
        refreshAutomationsSpy.mockClear();
        refreshAutomationDefinitionDetailSpy.mockClear();
        loadMoreAutomationsSpy.mockClear();
        refreshState.reject = false;
        refreshState.deferred = null;
        detailFailureState.ids = new Set();
        routeRemovalState.active = false;
        routeRemovalState.consume = null;
        androidBackState.enabled = false;
        androidBackState.handler = null;
        accountScopeState.value = { serverId: 'server-1', accountId: 'account-1' };
        state.nextCursor = null;
        state.session = {
            id: 'source-session',
            serverId: 'server-1',
            metadata: { flavor: 'acp:test-backend' },
            latestTurnId: 'turn-observed',
            latestTurnStatus: 'in_progress',
        };
        state.automations = Array.from({ length: 70 }, (_, index) => ({
            id: `automation-${index}`,
            name: `Automation ${index}`,
            targetType: 'executionRun',
            linkedExistingSessionId: null,
            detail: { kind: 'unloaded', templateVersion: 1 },
        }));
        state.automations.push({
            id: 'same-session-target',
            name: 'Must not target its source',
            targetType: 'existingSession',
            linkedExistingSessionId: 'source-session',
            detail: { kind: 'loaded' },
        });
        state.automations.push({
            id: 'missing-session-target',
            name: 'Target was not proven',
            targetType: 'existingSession',
            linkedExistingSessionId: null,
            templateVersion: 1,
            detail: { kind: 'unloaded' },
        });
    });

    it('opens the destination as a real SelectionList navigation step behind the Event choice', async () => {
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        // Step one: the Event rows are real navigation rows that push the
        // destination onto the list's own step stack; the Event step itself
        // never paginates.
        const eventPicker = screen.findByProps({ testID: 'exact-turn-automation-event-picker' });
        const eventOptions = eventPicker.props.rootStep.sections[0].options;
        expect(eventOptions.map((option: any) => option.id)).toEqual([
            'parentTurnCompleted',
            'parentTurnFailed',
            'parentTurnCancelled',
            'userActionRequired',
        ]);
        expect(eventOptions.map((option: any) => option.openStep?.id)).toEqual([
            'exact-turn-automation-destination:parentTurnCompleted',
            'exact-turn-automation-destination:parentTurnFailed',
            'exact-turn-automation-destination:parentTurnCancelled',
            'exact-turn-automation-destination:userActionRequired',
        ]);
        expect(eventPicker.props.listAccessibilityLabel).toBe('automations.exactTurn.eventListA11y');
        expect(eventPicker.props.pagination).toBeUndefined();
        expect(eventPicker.props.syncActiveStep).toBeNull();
        expect(screen.findAllByProps({ testID: 'exact-turn-automation-destination' })).toHaveLength(0);
        // SelectionList gates its search header on the consumer's `rootStep`
        // intent, so this screen must declare search at the Event root or the
        // pushed destination step silently renders without any input at all.
        expect(eventPicker.props.rootStep.inputPlaceholder).toBe('automations.exactTurn.eventSearchPlaceholder');

        const picker = await activateDestination(screen);

        // Step two: one shared searchable virtualized destination list for the
        // selected Event, carried by the pushed step and kept fresh through the
        // controlled active-step mirror. The list keeps owning the step stack,
        // so the mounted `rootStep` stays the Event step.
        expect(picker.props.rootStep.id).toBe('exact-turn-automation-event');
        const destination = activeDestinationStep(picker);
        expect(destination).toMatchObject({
            id: 'exact-turn-automation-destination:parentTurnFailed',
            title: 'automations.pluralEditor.lifecycleEvent.parentTurnFailed',
            inputPlaceholder: 'automations.exactTurn.searchPlaceholder',
        });
        expect(destination.sections[0].virtualization).toBe('force');
        const destinationOptions = staticDestinationSectionOptions(destination);
        expect(destinationOptions).toHaveLength(72);
        expect(destinationOptions).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'existing:same-session-target' }),
        ]));
        expect(destinationOptions).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'existing:missing-session-target' }),
        ]));
        expect(picker.props.listAccessibilityLabel).toBe('automations.exactTurn.destinationA11y');
        expect(picker.props.keyboardHintsEnabled).toBe(true);
        expect(picker.props.autoFocusInputOnWeb).toBe(true);

        await act(async () => picker.props.onSelect('create-new'));
        expect(routerMock.push).toHaveBeenNthCalledWith(1, {
            pathname: '/automations/new',
            params: {
                sourceSessionId: observed.sourceSessionId,
                sourceTurnId: observed.sourceTurnId,
                sourceServerId: observed.sourceServerId,
                sessionLifecycleEvents: 'parentTurnFailed',
            },
        });

        await act(async () => picker.props.onSelect('existing:automation-69'));
        expect(routerMock.push).toHaveBeenNthCalledWith(2, {
            pathname: '/automations/edit',
            params: {
                id: 'automation-69',
                sourceSessionId: observed.sourceSessionId,
                sourceTurnId: observed.sourceTurnId,
                sourceServerId: observed.sourceServerId,
                sessionLifecycleEvents: 'parentTurnFailed',
            },
        });
    });

    it('returns from the destination step to the Event step and only then leaves the route', async () => {
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        await activateDestination(screen);

        // The list's own stack pop is reported through onActiveStepChange: the
        // destination closes without leaving the route.
        const picker = screen.findByProps({ testID: 'exact-turn-automation-destination' });
        await act(async () => {
            picker.props.onActiveStepChange(picker.props.rootStep);
        });
        expect(routerMock.back).not.toHaveBeenCalled();
        const eventPicker = screen.findByProps({ testID: 'exact-turn-automation-event-picker' });
        expect(eventPicker.props.syncActiveStep).toBeNull();
        expect(screen.findAllByProps({ testID: 'exact-turn-automation-destination' })).toHaveLength(0);

        // Only closing from the Event root leaves the route.
        await act(async () => eventPicker.props.onRequestClose());
        expect(routerMock.back).toHaveBeenCalledTimes(1);
    });

    it('spends the destination step for browser and Android hardware Back before route removal', async () => {
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        // At the Event root neither back owner holds a step.
        expect(routeRemovalState.active).toBe(false);
        expect(routeRemovalState.consume?.()).toBe(false);
        expect(androidBackState.enabled).toBe(false);

        await activateDestination(screen);

        expect(routeRemovalState.active).toBe(true);
        expect(androidBackState.enabled).toBe(true);
        await act(async () => {
            expect(routeRemovalState.consume?.()).toBe(true);
            expect(androidBackState.handler?.()).toBe(true);
        });
        expect(routerMock.back).not.toHaveBeenCalled();
        expect(screen.findByProps({ testID: 'exact-turn-automation-event-picker' })).toBeDefined();
        expect(screen.findAllByProps({ testID: 'exact-turn-automation-destination' })).toHaveLength(0);

        await act(async () => {
            expect(routeRemovalState.consume?.()).toBe(false);
        });
    });

    it('keeps the picker mounted with inline progress during page and detail hydration', async () => {
        // The authoritative definition page has not arrived yet.
        refreshState.deferred = createDeferred<void>();
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);

        // The picker stays mounted during the page read instead of being
        // swapped for a loading card, so its query and focus survive.
        const eventPicker = screen.findByProps({ testID: 'exact-turn-automation-event-picker' });
        expect(eventPicker).toBeDefined();
        expect(screen.findAllByProps({ testID: 'exact-turn-automation-resolving' })).toHaveLength(0);

        // The private Session-association read for the one existing-session
        // row is held in flight while the page read settles.
        refreshAutomationDefinitionDetailSpy.mockImplementationOnce(() => new Promise(() => {}));
        await act(async () => {
            refreshState.deferred?.resolve();
            await Promise.resolve();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        // Detail hydration is in flight: the destination shows the
        // already-proven rows plus an inline pending row, and never an
        // unmounting loading state.
        const picker = await activateDestination(screen);
        const options = staticDestinationSectionOptions(activeDestinationStep(picker));
        expect(options).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'existing:automation-69' }),
            expect.objectContaining({ testID: 'exact-turn-automation-resolving' }),
        ]));
        expect(options.find((option: any) => option.testID === 'exact-turn-automation-resolving'))
            .toMatchObject({ disabled: true, loading: true });
    });

    it('shows unavailable private automations as disabled recoverable rows with an inline retry instead of omitting them', async () => {
        state.automations.push({
            id: 'sealed-private-target',
            name: 'Sealed private automation',
            targetType: 'existingSession',
            linkedExistingSessionId: null,
            templateVersion: 1,
            detail: {
                kind: 'unavailable',
                templateVersion: 1,
                code: 'automation_stored_content_unavailable',
            },
        });
        detailFailureState.ids = new Set(['missing-session-target']);
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        const picker = await activateDestination(screen);
        const options = staticDestinationSectionOptions(activeDestinationStep(picker));

        // The sealed definition keeps a visible row, disabled because its
        // compatibility with the source Session cannot be proven.
        const sealedRow = options.find((option: any) => option.testID === 'exact-turn-automation-unavailable-sealed-private-target');
        expect(sealedRow).toMatchObject({
            disabled: true,
            label: 'Sealed private automation',
        });
        // The failed read is recoverable: an explicit retry row re-admits it.
        const retryRow = options.find((option) => option.testID === 'exact-turn-automation-retry-unavailable');
        expect(retryRow).toBeDefined();
        expect(refreshAutomationDefinitionDetailSpy).toHaveBeenCalledWith('missing-session-target');

        // The transport recovers, then the explicit retry row re-admits the
        // failed read through the resolution hook's own owner. The production
        // retry row activates through the option-level select path; a pushed
        // step-branch option would navigate instead of re-admitting.
        detailFailureState.ids = new Set();
        const retryActivation = retryRow && retryRow.openStep === undefined
            ? retryRow.onSelect
            : null;
        expect(retryActivation).toBeDefined();
        await act(async () => {
            retryActivation?.();
        });
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(refreshAutomationDefinitionDetailSpy).toHaveBeenCalledTimes(2);

        const recoveredPicker = screen.findByProps({ testID: 'exact-turn-automation-destination' });
        const recoveredOptions = staticDestinationSectionOptions(activeDestinationStep(recoveredPicker));
        expect(recoveredOptions).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'existing:missing-session-target' }),
        ]));
        expect(recoveredOptions.find((option: any) => option.testID === 'exact-turn-automation-retry-unavailable'))
            .toBeUndefined();
    });

    it('passes the exact server continuation through the existing SelectionList pagination owner on the destination step only', async () => {
        state.nextCursor = 'definition-cursor-1';
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        const eventPicker = screen.findByProps({ testID: 'exact-turn-automation-event-picker' });
        expect(eventPicker.props.pagination).toBeUndefined();
        const picker = await activateDestination(screen);

        expect(picker.props.pagination).toMatchObject({
            hasMore: true,
            requestKey: 'definition-cursor-1',
        });
        await act(async () => picker.props.pagination.onEndReached());
        expect(loadMoreAutomationsSpy).toHaveBeenCalledWith('definition-cursor-1');
    });

    it('shows explicit current-turn recovery when the observed turn is stale without silently navigating', async () => {
        state.session = { ...state.session, latestTurnId: 'turn-current' };
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);

        const stale = screen.findByProps({ testID: 'exact-turn-automation-stale' });
        expect(stale.props.accessibilitySemantics).toBe('alert');
        expect(stale.props.action.label).toBe('automations.exactTurn.useCurrentTurn');
        expect(routerMock.push).not.toHaveBeenCalled();
        expect(routerMock.setParams).not.toHaveBeenCalled();

        await act(async () => stale.props.action.onPress());
        expect(routerMock.setParams).toHaveBeenCalledWith({
            sourceSessionId: 'source-session',
            sourceTurnId: 'turn-current',
            sourceServerId: 'server-1',
            sessionLifecycleEvents: 'parentTurnCompleted',
        });
        expect(routerMock.push).not.toHaveBeenCalled();
    });

    it('refuses a changed turn before any destination can be chosen or navigated', async () => {
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        const eventPicker = screen.findByProps({ testID: 'exact-turn-automation-event-picker' });

        state.session = { ...state.session, latestTurnId: 'turn-raced' };
        await act(async () => {
            eventPicker.props.onActiveStepChange(destinationStepFromEventPicker(eventPicker));
        });

        // The typed stale recovery owns the screen: no destination list, no
        // create/edit navigation with a stale exact-turn identity.
        expect(screen.findByProps({ testID: 'exact-turn-automation-stale' })).toBeDefined();
        expect(screen.findAllByProps({ testID: 'exact-turn-automation-destination' })).toHaveLength(0);
        expect(routerMock.push).not.toHaveBeenCalled();
    });

    it('does not refresh automations again when the running source session emits live updates', async () => {
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(refreshAutomationsSpy).toHaveBeenCalledTimes(1);

        // Live transcript churn replaces the Session object while the exact
        // turn is unchanged; the semantic authority binding has not changed,
        // so the hydrated destination list must not be torn down and refetched.
        state.session = { ...state.session };
        await screen.update(<ExactTurnAutomationDestinationScreen observed={{ ...observed }} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(refreshAutomationsSpy).toHaveBeenCalledTimes(1);
    });

    it('shows a typed retry state instead of presenting cached destinations as current after refresh fails', async () => {
        refreshState.reject = true;
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await act(async () => {});

        const failed = screen.findByProps({ testID: 'exact-turn-automation-refresh-failed' });
        expect(failed.props.accessibilitySemantics).toBe('alert');
        expect(failed.props.action.label).toBe('common.retry');
        expect(screen.findAllByProps({ testID: 'exact-turn-automation-destination' })).toHaveLength(0);

        refreshState.reject = false;
        await act(async () => failed.props.action.onPress());
        await act(async () => {});
        expect(refreshAutomationsSpy).toHaveBeenCalledTimes(2);
    });

    it('rebinds the Account-scoped authority when the active Account changes on the same server', async () => {
        const { ExactTurnAutomationDestinationScreen } = await import('./ExactTurnAutomationDestinationScreen');
        const screen = await renderScreen(<ExactTurnAutomationDestinationScreen observed={observed} />);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(screen.findByProps({ testID: 'exact-turn-automation-event-picker' })).toBeDefined();
        expect(refreshAutomationsSpy).toHaveBeenCalledTimes(1);

        // Same server, Account B mounts: the A-era authority must retire and a
        // B authority must establish exactly once, refreshing under B.
        accountScopeState.value = { serverId: 'server-1', accountId: 'account-2' };
        await screen.update(<ExactTurnAutomationDestinationScreen observed={{ ...observed }} />);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(refreshAutomationsSpy).toHaveBeenCalledTimes(2);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(refreshAutomationsSpy).toHaveBeenCalledTimes(2);

        // The destination list is current again and selections are authorized
        // under B instead of being silently refused by a retired A authority,
        // carrying the Event chosen at step one rather than the observation
        // default.
        const picker = await activateDestination(screen);
        await act(async () => picker.props.onSelect('create-new'));
        expect(routerMock.push).toHaveBeenCalledWith({
            pathname: '/automations/new',
            params: {
                sourceSessionId: observed.sourceSessionId,
                sourceTurnId: observed.sourceTurnId,
                sourceServerId: observed.sourceServerId,
                sessionLifecycleEvents: 'parentTurnFailed',
            },
        });
    });
});
