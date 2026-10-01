import * as React from 'react';
import { useRouter, type Href } from '@/components/appShell/workspace/destinationRoute';

import type { AppPaneScopeApi } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { useSessionCockpitSurfaceNavigation } from '@/components/workspaceCockpit/session/SessionCockpitSurfaceNavigation';
import { buildSessionDestinationRouteHref } from '@/components/workspaceCockpit/session/sessionCockpitNavigation';
import { useMobileWorkspaceExperienceState } from '@/components/workspaceCockpit/useMobileWorkspaceExperienceState';

/**
 * Opens the one Agents roster for a Session: the phone cockpit's Agents surface, the sidebar's
 * Agents tab beside a mounted Session, or a link that lands on either. The retired phone "Runs" list
 * (`/session/:id/runs`) redirects here, so desktop and phone watch agents through one owner.
 */
export function buildSessionAgentsRouteHref(input: Readonly<{
    sessionId: string;
    serverId?: string | null;
    cockpitEnabled: boolean;
}>): string {
    return buildSessionDestinationRouteHref({ ...input, surface: 'agents', rightTabId: 'agents' });
}

export function useOpenSessionAgents(input: Readonly<{
    target: Readonly<{ serverId?: string | null; sessionId: string }> | null;
    /** Only supply the pane when this exact Session is the mounted source. */
    pane?: Pick<AppPaneScopeApi, 'openRight' | 'setRightTab'>;
    replace?: boolean;
}>): () => void {
    const router = useRouter();
    const cockpitNavigation = useSessionCockpitSurfaceNavigation();
    const { cockpitEnabled } = useMobileWorkspaceExperienceState();
    const serverId = input.target?.serverId;
    const sessionId = input.target?.sessionId;
    const openRight = input.pane?.openRight;
    const setRightTab = input.pane?.setRightTab;
    const replace = input.replace === true;

    return React.useCallback(() => {
        if (!sessionId) return;
        if (openRight && cockpitNavigation) {
            cockpitNavigation.switchSurface('agents');
            return;
        }
        if (openRight && setRightTab) {
            openRight({ tabId: 'agents' });
            setRightTab('agents');
            return;
        }
        const href = buildSessionAgentsRouteHref({ sessionId, serverId, cockpitEnabled });
        if (replace) router.replace(href as Href);
        else router.push(href as Href);
    }, [cockpitEnabled, cockpitNavigation, openRight, replace, router, serverId, sessionId, setRightTab]);
}
