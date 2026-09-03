import * as React from 'react';
import { useRouter } from 'expo-router';
import type { AutomationSessionLifecycleEvent } from '@happier-dev/protocol';

import { SelectionListScreen, type SelectionListOption, type SelectionListStep } from '@/components/ui/selectionList';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { useNativeBackLayerBackHandler } from '@/components/ui/overlays/NativeBackLayerBoundary';
import { RouteRemovalStepConsumer } from '@/utils/navigation/RouteRemovalStepConsumer';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useAutomationsSupport } from '@/hooks/server/useAutomationsSupport';
import { useActiveServerAccountScope, useAutomations, useSession } from '@/sync/domains/state/storage';
import { storage } from '@/sync/domains/state/storage';
import { captureSessionAutomationAuthority } from '@/sync/domains/automations/sessionAutomationAuthority';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { navigateWithBlurOnWeb } from '@/utils/platform/deferOnWeb';
import { useAutomationDefinitionPagination } from '@/components/automations/list/useAutomationDefinitionPagination';
import { useResolveExistingSessionAutomationDetails } from '@/components/automations/list/useResolveExistingSessionAutomationDetails';

import {
    areExactTurnAutomationPrefillsEqual,
    buildExactTurnAutomationRouteParams,
    readExactActiveParentTurn,
    type ExactTurnAutomationPrefill,
} from './exactTurnAutomationPrefill';

const CREATE_NEW_OPTION_ID = 'create-new';
const EXISTING_OPTION_PREFIX = 'existing:';
/** Pushed destination steps carry their selected Event in the machine-readable id suffix. */
const DESTINATION_STEP_ID_PREFIX = 'exact-turn-automation-destination:';
const DESTINATION_STEP_ID = 'exact-turn-automation-destination';
const EVENT_STEP_ID = 'exact-turn-automation-event';
const RETRY_UNAVAILABLE_OPTION_ID = 'retry-unavailable-details';
const RESOLVING_OPTION_ID = 'resolving-details';
const LIFECYCLE_EVENTS: readonly AutomationSessionLifecycleEvent[] = [
    'parentTurnCompleted',
    'parentTurnFailed',
    'parentTurnCancelled',
    'userActionRequired',
];

function lifecycleEventLabel(event: AutomationSessionLifecycleEvent): string {
    return t(`automations.pluralEditor.lifecycleEvent.${event}`);
}

function isCompatibleExistingAutomation(
    automation: Readonly<{ targetType: string; linkedExistingSessionId?: string | null }>,
    sourceSessionId: string,
): boolean {
    return automation.targetType !== 'existingSession'
        || (
            typeof automation.linkedExistingSessionId === 'string'
            && automation.linkedExistingSessionId.length > 0
            && automation.linkedExistingSessionId !== sourceSessionId
        );
}

export function ExactTurnAutomationDestinationScreen(props: Readonly<{
    observed: ExactTurnAutomationPrefill;
}>) {
    const router = useRouter();
    const sourceSession = useSession(props.observed.sourceSessionId);
    const activeServer = useActiveServerSnapshot();
    const activeAccountScope = useActiveServerAccountScope();
    const support = useAutomationsSupport({ scopeKind: 'spawn', serverId: props.observed.sourceServerId });
    const supportRef = React.useRef(support.enabled);
    supportRef.current = support.enabled;
    const automations = useAutomations();
    const pagination = useAutomationDefinitionPagination();
    const [loading, setLoading] = React.useState(true);
    const [refreshFailed, setRefreshFailed] = React.useState(false);
    const [refreshGeneration, setRefreshGeneration] = React.useState(0);
    // The Event choice is a real pushed SelectionList step: the list's own step
    // stack owns the destination step, so its header back chip, Escape, the
    // browser Back button, and Android hardware Back all return to the Event
    // choice through their incumbent owners instead of leaving the route. This
    // state mirrors which step is active, recovered from the pushed step id.
    const [selectedEvent, setSelectedEvent] = React.useState<AutomationSessionLifecycleEvent | null>(null);
    const selectedEventRef = React.useRef(selectedEvent);
    selectedEventRef.current = selectedEvent;
    const current = readExactActiveParentTurn(sourceSession);
    const observedIsCurrent = areExactTurnAutomationPrefillsEqual(current, props.observed);
    const accountScopeKey = activeAccountScope ? serverAccountScopeKeySuffix(activeAccountScope) : null;
    const authority = React.useMemo(() => captureSessionAutomationAuthority({
        // Capture-time identity facts only; isCurrent() re-reads live store
        // truth, so the memo must not depend on the render-phase Session
        // object whose identity churns on every transcript update of the
        // running source turn. The Account-scope key (serverId+accountId) is
        // the semantic Account identity: a same-server Account switch rebinds
        // the authority instead of holding the retired lifetime forever.
        session: storage.getState().sessions[props.observed.sourceSessionId] ?? null,
        routeSessionId: props.observed.sourceSessionId,
        routeServerId: props.observed.sourceServerId,
        activeServerId: activeServer.serverId,
        automationsEnabled: support.enabled,
        accountSettings: storage.getState().settings,
        accountLifetime: captureActiveServerAccountScopeLifetime(),
        readCurrent: () => ({
            session: storage.getState().sessions[props.observed.sourceSessionId] ?? null,
            routeSessionId: props.observed.sourceSessionId,
            routeServerId: props.observed.sourceServerId,
            activeServerId: getActiveServerSnapshot().serverId,
            automationsEnabled: supportRef.current,
            accountSettings: storage.getState().settings,
        }),
    }), [
        accountScopeKey,
        activeServer.serverId,
        props.observed.sourceServerId,
        props.observed.sourceSessionId,
        support.enabled,
    ]);
    const directDetailResolution = useResolveExistingSessionAutomationDetails({
        automations,
        accountScopeKey: accountScopeKey ?? 'unscoped',
        enabled: Boolean(authority) && observedIsCurrent && !loading && !refreshFailed,
    });

    React.useEffect(() => {
        if (!authority) return;
        let alive = true;
        setLoading(true);
        setRefreshFailed(false);
        void sync.refreshAutomations().catch(() => {
            if (alive && authority.isCurrent()) setRefreshFailed(true);
        }).finally(() => {
            if (alive && authority.isCurrent()) setLoading(false);
        });
        return () => { alive = false; };
    }, [authority, refreshGeneration]);

    const compatible = React.useMemo(() => automations.filter((automation) => (
        isCompatibleExistingAutomation(automation, props.observed.sourceSessionId)
    )), [automations, props.observed.sourceSessionId]);

    // Existing-Session automations whose private link could not be proven — a
    // permanently unavailable stored definition or a failed direct read — stay
    // visible as disabled recoverable rows instead of being silently omitted:
    // any of them may well be a compatible destination, but selecting one is
    // refused until its details can be read again.
    const unverifiedAutomations = React.useMemo(() => {
        const detailPending = loading || directDetailResolution.resolving;
        return automations.filter((automation) => {
            if (automation.targetType !== 'existingSession') return false;
            if (automation.linkedExistingSessionId !== null) return false;
            if (automation.detail.kind === 'unavailable') return true;
            if (directDetailResolution.failedAutomationIds.has(automation.id)) return true;
            return automation.detail.kind === 'unloaded' && !detailPending;
        });
    }, [automations, directDetailResolution.failedAutomationIds, directDetailResolution.resolving, loading]);

    const destinationOptions = React.useMemo<ReadonlyArray<SelectionListOption>>(() => {
        const options: SelectionListOption[] = [
            {
                id: CREATE_NEW_OPTION_ID,
                label: t('automations.exactTurn.createNew'),
                subtitle: t('automations.exactTurn.createNewSubtitle'),
                testID: 'exact-turn-automation-create-new',
            },
        ];
        for (const automation of compatible) {
            options.push({
                id: `${EXISTING_OPTION_PREFIX}${automation.id}`,
                label: automation.name,
                subtitle: t('automations.exactTurn.addToExistingSubtitle'),
                testID: `exact-turn-automation-existing-${automation.id}`,
            });
        }
        for (const automation of unverifiedAutomations) {
            options.push({
                id: `${EXISTING_OPTION_PREFIX}${automation.id}`,
                label: automation.name,
                subtitle: t('automations.exactTurn.unavailableRowSubtitle'),
                disabled: true,
                testID: `exact-turn-automation-unavailable-${automation.id}`,
            });
        }
        // Page and detail hydration progress stays inline so the mounted picker
        // (and its uncontrolled query and focus) is never torn down for a load.
        if (loading || directDetailResolution.resolving) {
            options.push({
                id: RESOLVING_OPTION_ID,
                label: t('common.loading'),
                subtitle: t('automations.exactTurn.resolvingRowSubtitle'),
                disabled: true,
                loading: true,
                testID: 'exact-turn-automation-resolving',
            });
        }
        if (directDetailResolution.hasFailure) {
            options.push({
                id: RETRY_UNAVAILABLE_OPTION_ID,
                label: t('common.retry'),
                subtitle: t('automations.exactTurn.incompleteNoticeTitle'),
                testID: 'exact-turn-automation-retry-unavailable',
                accessibilityLabel: `${t('automations.exactTurn.incompleteNoticeTitle')}. ${t('common.retry')}`,
                // Option-level activation re-admits the failed reads; the
                // orchestrator's top-level onSelect intentionally ignores this
                // id (it is not a destination).
                onSelect: () => directDetailResolution.retry(),
            });
        }
        return options;
    }, [compatible, directDetailResolution, loading, unverifiedAutomations]);

    const buildDestinationStep = React.useCallback((event: AutomationSessionLifecycleEvent): SelectionListStep => ({
        id: `${DESTINATION_STEP_ID_PREFIX}${event}`,
        title: lifecycleEventLabel(event),
        inputPlaceholder: t('automations.exactTurn.searchPlaceholder'),
        sections: [{
            kind: 'static',
            id: 'destinations',
            options: destinationOptions,
            virtualization: 'force',
        }],
    }), [destinationOptions]);

    const rootStep = React.useMemo<SelectionListStep>(() => ({
        id: EVENT_STEP_ID,
        title: t('automations.exactTurn.actionTitle'),
        // SelectionList gates its search header on the consumer's root step so
        // the header cannot vanish mid-flow. The Event root must therefore
        // declare search intent too, otherwise the pushed destination step —
        // the one that actually needs to filter a paged Automation catalog —
        // renders with no input despite its own placeholder.
        inputPlaceholder: t('automations.exactTurn.eventSearchPlaceholder'),
        sections: [{
            kind: 'static',
            id: 'events',
            options: LIFECYCLE_EVENTS.map((event) => ({
                id: event,
                label: lifecycleEventLabel(event),
                openStep: buildDestinationStep(event),
            })),
        }],
    }), [buildDestinationStep]);

    // The mounted destination step is a snapshot; republishing its latest
    // content through the controlled active-step mirror keeps hydration and
    // pagination flowing into it while it stays mounted.
    const syncedActiveStep = React.useMemo<SelectionListStep | null>(
        () => (selectedEvent === null ? null : buildDestinationStep(selectedEvent)),
        [buildDestinationStep, selectedEvent],
    );

    const handleActiveStepChange = React.useCallback((step: SelectionListStep) => {
        if (!step.id.startsWith(DESTINATION_STEP_ID_PREFIX)) {
            setSelectedEvent(null);
            return;
        }
        const event = step.id.slice(DESTINATION_STEP_ID_PREFIX.length) as AutomationSessionLifecycleEvent;
        setSelectedEvent(LIFECYCLE_EVENTS.includes(event) ? event : null);
    }, []);

    const revalidate = React.useCallback(() => {
        if (!authority?.isCurrent()) return false;
        const fresh = readExactActiveParentTurn(
            storage.getState().sessions[props.observed.sourceSessionId],
        );
        return areExactTurnAutomationPrefillsEqual(fresh, props.observed);
    }, [authority, props.observed]);

    if (!authority) {
        return (
            <SurfaceStateCard
                kind="error"
                title={t('common.error')}
                reason={t('automations.exactTurn.unavailable')}
                accessibilitySemantics="alert"
            />
        );
    }

    if (!observedIsCurrent) {
        return (
            <SurfaceStateCard
                testID="exact-turn-automation-stale"
                kind="warning"
                title={t('automations.exactTurn.staleTitle')}
                reason={t('automations.exactTurn.staleBody')}
                {...(current ? {
                    action: {
                        label: t('automations.exactTurn.useCurrentTurn'),
                        onPress: () => router.setParams(buildExactTurnAutomationRouteParams({
                            ...current,
                            events: props.observed.events,
                        })),
                    },
                } : {})}
                accessibilitySemantics="alert"
            />
        );
    }

    if (refreshFailed) {
        return (
            <SurfaceStateCard
                testID="exact-turn-automation-refresh-failed"
                kind="warning"
                title={t('common.error')}
                reason={t('automations.exactTurn.unavailable')}
                action={{
                    label: t('common.retry'),
                    onPress: () => {
                        directDetailResolution.retry();
                        setRefreshGeneration((value) => value + 1);
                    },
                }}
                accessibilitySemantics="alert"
            />
        );
    }

    // Route removal (browser Back, iOS header Back, edge swipe) and Android
    // hardware Back spend the pushed destination step through the incumbent
    // public navigation owners before they may leave the route; at the Event
    // root both decline and the removal proceeds unchanged.
    const consumeDestinationStep = (): boolean => {
        if (selectedEventRef.current === null) return false;
        setSelectedEvent(null);
        return true;
    };

    return (
        <>
            <RouteRemovalStepConsumer
                active={selectedEvent !== null}
                consume={consumeDestinationStep}
            />
            <AndroidHardwareBackBridge
                enabled={selectedEvent !== null}
                consume={consumeDestinationStep}
            />
            <SelectionListScreen
                rootStep={rootStep}
                syncActiveStep={syncedActiveStep}
                onActiveStepChange={handleActiveStepChange}
                listAccessibilityLabel={selectedEvent
                    ? t('automations.exactTurn.destinationA11y')
                    : t('automations.exactTurn.eventListA11y')}
                selectedOptionId={null}
                onSelect={(optionId) => {
                    if (selectedEvent === null) return;
                    if (!revalidate()) return;
                    const destinationId = optionId;
                    const routeParams = buildExactTurnAutomationRouteParams({
                        ...props.observed,
                        events: [selectedEvent],
                    });
                    if (destinationId === CREATE_NEW_OPTION_ID) {
                        navigateWithBlurOnWeb(() => router.push({ pathname: '/automations/new', params: routeParams }));
                        return;
                    }
                    if (!destinationId.startsWith(EXISTING_OPTION_PREFIX)) return;
                    const automationId = destinationId.slice(EXISTING_OPTION_PREFIX.length);
                    if (!compatible.some((automation) => automation.id === automationId)) return;
                    navigateWithBlurOnWeb(() => router.push({
                        pathname: '/automations/edit',
                        params: { id: automationId, ...routeParams },
                    }));
                }}
                onRequestClose={() => {
                    // Only reachable from the Event root: a pushed destination
                    // step is popped by the list's own step stack first, and
                    // its change is reported through onActiveStepChange.
                    router.back();
                }}
                keyboardHintsEnabled
                autoFocusInputOnWeb
                {...(selectedEvent ? { pagination: {
                    hasMore: pagination.hasMore,
                    loadingMore: pagination.loadingMore,
                    requestKey: pagination.nextCursor,
                    error: pagination.loadMoreFailed ? t('common.requestFailed') : null,
                    onEndReached: pagination.requestPage,
                    onRetry: pagination.requestPage,
                    loadingLabel: t('common.loading'),
                    moreLabel: t('common.more'),
                    retryLabel: t('common.retry'),
                    endReachedLabel: t('common.done'),
                } } : {})}
                testID={selectedEvent
                    ? DESTINATION_STEP_ID
                    : 'exact-turn-automation-event-picker'}
            />
        </>
    );
}

/**
 * Android hardware Back joins the same public back-layer owner used by the
 * plugin page surfaces. The bridge mounts whenever the route is live; the
 * back-layer hook itself gates the raw Android listener and is inert on
 * platforms without hardware Back. The shared consume callback keeps hardware
 * Back identical to browser Back.
 */
function AndroidHardwareBackBridge(props: Readonly<{
    enabled: boolean;
    consume: () => boolean;
}>): null {
    useNativeBackLayerBackHandler(props.enabled, props.consume);
    return null;
}
