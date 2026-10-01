import * as React from 'react';
import { useRouter, type Href } from '@/components/appShell/workspace/destinationRoute';

import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { buildSessionExecutionRunRouteHref } from '@/components/sessions/agents/navigation/buildSessionExecutionRunRouteHref';
import { createSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import { useDestinationPaneScopeId } from '@/components/appShell/workspace/DestinationInstanceHost';
import {
    createExecutionRunDetailsTab,
    createInteractiveExecutionRunDraftDetailsTab,
} from '@/components/sessions/runs/launcher/executionRunLauncherModel';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { useDeviceType } from '@/utils/platform/responsive';

/**
 * The one responsive Agent-conversation navigation command (Lane 05).
 *
 * Conversations mode lists Agent conversations beside human ones, and both
 * kinds must land on the destination the rest of the app already uses: the
 * canonical interactive Run draft for a new conversation and the canonical Run
 * Details resource for an existing one. Desktop and tablet open the typed
 * Details resource as a sibling tab so the human conversation tab stays
 * retained; phones push the equivalent route.
 */
export function useOpenSessionAgentConversation(input: Readonly<{
    address: SessionAddress;
}>): Readonly<{
    /** Opens a Run's conversation; `title` names its tab by intent when the caller knows it. */
    openAgentConversation: (runId: string, title?: string | null) => void;
    openNewAgentConversation: () => void;
}> {
    const router = useRouter();
    const deviceType = useDeviceType();
    const pane = useAppPaneScope(useDestinationPaneScopeId(createSessionPaneScopeId(input.address.sessionId, input.address.serverId)));
    const { sessionId, serverId } = input.address;

    return React.useMemo(() => ({
        openAgentConversation: (runId: string, title?: string | null) => {
            if (deviceType === 'phone') {
                const href = buildSessionExecutionRunRouteHref({ sessionId, serverId, runId });
                if (href) router.push(href as Href);
                return;
            }
            pane.openDetailsTab(createExecutionRunDetailsTab(runId, undefined, title), { intent: 'preview' });
        },
        openNewAgentConversation: () => {
            if (deviceType === 'phone') {
                router.push(buildScopedSessionRouteHref({ sessionId, serverId, suffix: '/runs/new' }) as Href);
                return;
            }
            pane.openDetailsTab(createInteractiveExecutionRunDraftDetailsTab(), { intent: 'preview' });
        },
    }), [deviceType, pane, router, serverId, sessionId]);
}
