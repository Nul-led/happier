import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AutomationsGate } from '@/components/automations/gating/AutomationsGate';
import { WorkflowAutomationCreateScreen } from '@/components/workflows/screens/WorkflowAutomationCreateScreen';
import {
    adoptExactTurnAutomationPrefill,
    areExactTurnAutomationPrefillsEqual,
    buildExactTurnAutomationRouteParams,
    parseExactTurnAutomationPrefillRoute,
    readExactActiveParentTurn,
    type ExactTurnAutomationPrefill,
} from '@/components/automations/sessionLifecycle/exactTurnAutomationPrefill';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { useAutomationsSupport } from '@/hooks/server/useAutomationsSupport';
import { captureSessionAutomationAuthority } from '@/sync/domains/automations/sessionAutomationAuthority';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { readNewSessionAutomationHandoffSeed } from '@/sync/domains/workflows/newSessionAutomationHandoffSeed';
import { readWorkflowScheduleSeed } from '@/sync/domains/workflows/workflowScheduleSeed';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { isSessionRouteHydrationAvailable } from '@/sync/domains/session/sessionRouteHydrationState';
import { storage, useActiveServerAccountScope, useSession } from '@/sync/domains/state/storage';
import { t } from '@/text';
import type { AutomationTriggerDefinitionInput } from '@happier-dev/protocol';

/**
 * The one Automation create route.
 *
 * Ordinary creation, the New Session Automation handoff, exact-turn creation
 * and a reviewed Schedule copy all mount the same shared Workflow Automation
 * wrapper. This route owns only its preconditions — exact-turn source
 * currentness and the opaque seed reads — and never becomes a second authoring
 * owner.
 */
type RouteParams = Readonly<{
    sourceSessionId?: string;
    sourceTurnId?: string;
    sourceServerId?: string;
    sessionLifecycleEvents?: string;
    workflowSeedId?: string;
    newSessionDraftSeedId?: string;
}>;

function exactTurnTriggerInput(prefill: ExactTurnAutomationPrefill): AutomationTriggerDefinitionInput {
    return {
        kind: 'sessionLifecycle',
        enabled: true,
        sourceSessionId: prefill.sourceSessionId,
        events: [...prefill.events],
        policy: { kind: 'currentTurn', sourceTurnId: prefill.sourceTurnId },
    };
}

function ExactTurnNewAutomationRoute(props: Readonly<{
    observed: ExactTurnAutomationPrefill;
}>) {
    const router = useRouter();
    const hydration = useHydrateSessionForRoute(
        props.observed.sourceSessionId,
        'NewAutomationRoute.hydrateExactTurnSource',
        { serverId: props.observed.sourceServerId },
    );
    const sourceSession = useSession(props.observed.sourceSessionId);
    const activeAccountScope = useActiveServerAccountScope();
    const support = useAutomationsSupport({ scopeKind: 'spawn', serverId: props.observed.sourceServerId });
    const supportRef = React.useRef(support.enabled);
    supportRef.current = support.enabled;
    const [retired, setRetired] = React.useState(false);
    // The mounted exact-turn binding is established at mount and changes only
    // through the explicit adopt-current-turn action. Route params remain URL
    // truth but are never the mutation owner for the mounted draft.
    const [binding, setBinding] = React.useState<ExactTurnAutomationPrefill>(props.observed);
    const accountScopeKey = activeAccountScope ? serverAccountScopeKeySuffix(activeAccountScope) : null;
    const authority = React.useMemo(() => captureSessionAutomationAuthority({
        // Capture-time identity facts only; isCurrent() re-reads live store
        // truth. Keying the memo on the render-phase Session object would
        // rebuild the authority (and resubscribe its retire binding) on every
        // transcript update of the running source turn. The Account-scope key
        // (serverId+accountId) is the semantic Account identity, so a
        // same-server Account switch rebinds instead of staying retired.
        session: storage.getState().sessions[props.observed.sourceSessionId] ?? null,
        routeSessionId: props.observed.sourceSessionId,
        routeServerId: props.observed.sourceServerId,
        activeServerId: getActiveServerSnapshot().serverId,
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
        props.observed.sourceServerId,
        props.observed.sourceSessionId,
        support.enabled,
    ]);
    React.useEffect(() => {
        setRetired(false);
        return authority?.accountLifetime.onRetire(() => setRetired(true)).dispose;
    }, [authority]);
    if (!isSessionRouteHydrationAvailable(hydration)) return <ActivitySpinner size="small" />;
    const current = readExactActiveParentTurn(sourceSession);
    const serverMatches = sourceSession?.serverId === props.observed.sourceServerId
        && getActiveServerSnapshot().serverId === props.observed.sourceServerId;
    if (!serverMatches || !authority?.isCurrent() || retired) {
        return (
            <SurfaceStateCard
                kind="error"
                title={t('common.error')}
                reason={t('automations.exactTurn.unavailable')}
                accessibilitySemantics="alert"
            />
        );
    }
    const bindingIsCurrent = areExactTurnAutomationPrefillsEqual(binding, current);
    return (
        <>
            {!bindingIsCurrent ? (
                <SurfaceStateCard
                    testID="new-automation-exact-turn-stale"
                    kind="warning"
                    title={t('automations.exactTurn.staleTitle')}
                    reason={t('automations.exactTurn.staleBody')}
                    {...(current ? {
                        action: {
                            label: t('automations.exactTurn.useCurrentTurn'),
                            onPress: () => {
                                // Explicit adoption retargets the turn without
                                // discarding the author's chosen lifecycle events;
                                // params are updated as URL truth only.
                                const adopted = adoptExactTurnAutomationPrefill(binding, current);
                                setBinding(adopted);
                                router.setParams(buildExactTurnAutomationRouteParams(adopted));
                            },
                        },
                    } : {})}
                    accessibilitySemantics="alert"
                />
            ) : null}
            <WorkflowAutomationCreateScreen initialTriggers={[exactTurnTriggerInput(binding)]} />
        </>
    );
}

export default function NewAutomationRoute() {
    const params = useLocalSearchParams<RouteParams>();
    const route = parseExactTurnAutomationPrefillRoute(params);
    const [workflowSeed] = React.useState(() => (
        typeof params.workflowSeedId === 'string'
            ? readWorkflowScheduleSeed(params.workflowSeedId)
            : null
    ));
    const [handoffSeed] = React.useState(() => (
        typeof params.newSessionDraftSeedId === 'string'
            ? readNewSessionAutomationHandoffSeed(params.newSessionDraftSeedId)
            : null
    ));
    if (route.kind === 'invalid') {
        // A partial exact-turn intent must surface explicitly instead of
        // silently composing a plain automation without the requested trigger.
        return (
            <AutomationsGate>
                <SurfaceStateCard
                    testID="new-automation-exact-turn-invalid"
                    kind="error"
                    title={t('common.error')}
                    reason={t('automations.exactTurn.unavailable')}
                    accessibilitySemantics="alert"
                />
            </AutomationsGate>
        );
    }
    if (typeof params.workflowSeedId === 'string') {
        return (
            <AutomationsGate>
                {workflowSeed ? (
                    <WorkflowAutomationCreateScreen seed={workflowSeed} />
                ) : (
                    <SurfaceStateCard
                        testID="new-automation-workflow-seed-unavailable"
                        kind="error"
                        title={t('common.error')}
                        reason={t('automations.create.createFailed')}
                        accessibilitySemantics="alert"
                    />
                )}
            </AutomationsGate>
        );
    }
    if (route.kind === 'valid') {
        return (
            <AutomationsGate>
                <ExactTurnNewAutomationRoute observed={route.prefill} />
            </AutomationsGate>
        );
    }
    return (
        <AutomationsGate>
            {/* A handoff that expired still opens the editor: the person keeps
                authoring here rather than losing the route to an error. */}
            <WorkflowAutomationCreateScreen handoff={handoffSeed} />
        </AutomationsGate>
    );
}
