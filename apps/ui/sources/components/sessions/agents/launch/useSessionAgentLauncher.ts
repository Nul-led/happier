import * as React from 'react';
import type { WorkflowPluginSourceV1 } from '@happier-dev/protocol';
import { useRouter, type Href } from '@/components/appShell/workspace/destinationRoute';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import {
    createExecutionRunLauncherDetailsTab,
    createInteractiveExecutionRunDraftDetailsTab,
    type ExecutionRunStartPreset,
    resolveExecutionRunLauncherIntents,
    EXECUTION_RUN_LAUNCH_INTENTS,
    type ExecutionRunIntent,
} from '@/components/sessions/runs/launcher/executionRunLauncherModel';
import { resolveSessionRoutePathForSurface } from '@/components/workspaceCockpit/session/sessionCockpitState';
import { useSessionCockpitSurfaceNavigation } from '@/components/workspaceCockpit/session/SessionCockpitSurfaceNavigation';
import { createSessionSubagentLaunchDetailsTab } from '@/agents/registry/sessionSubagentUiBehavior';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import {
    useSessionExecutionRunLaunchability,
    type SessionExecutionRunLaunchUnavailableReason,
} from '@/hooks/session/useSessionExecutionRunLaunchability';
import { resolveExecutionRunAvailableBackends } from '@/sync/domains/executionRuns/resolveExecutionRunAvailableBackends';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { DetailsTab } from '@/components/appShell/panes/model/appPaneReducer';
import { useDeviceType } from '@/utils/platform/responsive';

import { useSessionBuiltinWorkflowStart } from './useSessionBuiltinWorkflowStart';

export type SessionAgentLauncher = Readonly<{
    /** `null` when agents can start here; otherwise why they cannot (said, never silently hidden). */
    unavailableReason: SessionExecutionRunLaunchUnavailableReason | null;
    /** The asks this Session's backends can take (all three while they are still loading). */
    intents: readonly ExecutionRunIntent[];
    /** The Agents that can take work here, for their marks (empty while backends load). */
    agentIds: readonly string[];
    openConversation: () => void;
    /**
     * The composer-first start for an ask; no intent is "Advanced…" (a review with every choice). A
     * preset starts it with a role (Second opinion: a review run by `second_opinion`).
     */
    openRun: (intent?: ExecutionRunIntent, preset?: ExecutionRunStartPreset) => void;
    /** Starts one of FIN's built-in workflows from this Session (its machine and folder). */
    startBuiltinWorkflow: (workflowId: string) => void;
    /** Starts a read-only plugin catalog source through that same Session start owner. */
    startPluginWorkflow: (source: WorkflowPluginSourceV1) => void;
    /** Shows a Details tab where the person will see it (beside the Session, or the phone's Details). */
    openDetails: (tab: DetailsTab) => void;
    /** The Agent's own launch surface (a team, a teammate), when it contributes one. */
    providerLaunch: Readonly<{ title: string; subtitle: string | null; open: () => void }> | null;
}>;

/**
 * One owner for how the Agents pane starts work, shared by its "+" menu and its empty state.
 *
 * Where a launch lands depends on the device: beside the Session a launcher opens as a Details tab;
 * on a phone, where a Details tab would open out of sight, it pushes the visible Run page (B18) or
 * shows the Details surface for an Agent-contributed launcher.
 */
export function useSessionAgentLauncher(params: Readonly<{
    sessionId: string;
    serverId?: string | null;
    scopeId: string;
    session: Session | null;
    subagents: readonly SessionSubagent[];
}>): SessionAgentLauncher {
    const router = useRouter();
    const deviceType = useDeviceType();
    const pane = useAppPaneScope(params.scopeId);
    const cockpitNavigation = useSessionCockpitSurfaceNavigation();
    const { launchUnavailableReason, executionRunsBackends } = useSessionExecutionRunLaunchability(
        params.sessionId,
        params.session,
        params.serverId,
    );
    const { sessionId, serverId } = params;
    const phone = deviceType === 'phone';

    const intents = React.useMemo(() => {
        const available = executionRunsBackends ? resolveExecutionRunLauncherIntents(executionRunsBackends) : [];
        // While the backends are still being read, offer every ask rather than none; the launcher
        // itself says which backend can take it.
        return available.length > 0 ? available : EXECUTION_RUN_LAUNCH_INTENTS;
    }, [executionRunsBackends]);

    const agentIds = React.useMemo(
        () => resolveExecutionRunAvailableBackends(executionRunsBackends, ''),
        [executionRunsBackends],
    );

    const pushRunRoute = React.useCallback((intent?: ExecutionRunIntent, roleId?: string) => {
        const query = {
            ...(intent ? { intent } : {}),
            ...(roleId ? { roleId } : {}),
        };
        const route = buildScopedSessionRouteHref({
            sessionId,
            serverId,
            suffix: '/runs/new',
            ...(intent || roleId ? { query } : {}),
        });
        if (route) router.push(route as Href);
    }, [router, serverId, sessionId]);

    const openDetails = React.useCallback((tab: DetailsTab) => {
        pane.openDetailsTab(tab, { intent: 'preview' });
        if (!phone) return;
        if (cockpitNavigation) {
            cockpitNavigation.switchSurface('tabs');
            return;
        }
        router.push(resolveSessionRoutePathForSurface(sessionId, 'tabs', { serverId }) as Href);
    }, [cockpitNavigation, pane, phone, router, serverId, sessionId]);

    const openConversation = React.useCallback(() => {
        if (phone) {
            pushRunRoute();
            return;
        }
        pane.openDetailsTab(createInteractiveExecutionRunDraftDetailsTab(), { intent: 'preview' });
    }, [pane, phone, pushRunRoute]);

    const openRun = React.useCallback((intent?: ExecutionRunIntent, preset?: ExecutionRunStartPreset) => {
        if (phone) {
            pushRunRoute(intent ?? 'review', preset?.roleId);
            return;
        }
        pane.openDetailsTab(createExecutionRunLauncherDetailsTab(intent, preset), { intent: 'preview' });
    }, [pane, phone, pushRunRoute]);

    const startCatalogWorkflow = useSessionBuiltinWorkflowStart({ sessionId, serverId });

    const providerTab = React.useMemo(
        () => createSessionSubagentLaunchDetailsTab({ session: params.session, subagents: params.subagents }),
        [params.session, params.subagents],
    );
    const providerLaunch = React.useMemo(() => (providerTab
        ? { title: providerTab.title, subtitle: providerTab.subtitle ?? null, open: () => openDetails(providerTab) }
        : null), [openDetails, providerTab]);

    return React.useMemo(() => ({
        unavailableReason: launchUnavailableReason,
        intents,
        agentIds,
        openConversation,
        openRun,
        openDetails,
        providerLaunch,
        startBuiltinWorkflow: startCatalogWorkflow,
        startPluginWorkflow: startCatalogWorkflow,
    }), [openDetails, agentIds, intents, launchUnavailableReason, openConversation, openRun, providerLaunch, startCatalogWorkflow]);
}
