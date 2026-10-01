import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';
import { useUnistyles } from 'react-native-unistyles';

import { useOpenSessionAgents } from '@/components/sessions/agents/navigation/useOpenSessionAgents';
import { SessionInvalidLinkFallback } from '@/components/sessions/shell/SessionInvalidLinkFallback';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { readSessionRouteServerId } from '@/hooks/session/sessionRouteServerScope';
import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';

/**
 * The released `/session/:id/runs` link, reduced to a scope-preserving redirect.
 *
 * This page used to be the phone's own list of a Session's runs, read through its own RPC beside the
 * Agents roster every other surface shows: a second list of the same agents (agents lab, adopted Q2).
 * The Agents roster is now the one list on desktop and phone, so the route only forwards to it. It
 * does not hydrate the Session: the Session root is the one hydration and authorization owner.
 */
export function SessionRunsCompatibilityRoute() {
    const { theme } = useUnistyles();
    const params = useLocalSearchParams<{ id: string; serverId?: string }>();
    const sessionId = normalizeSessionId(params.id);
    const serverId = readSessionRouteServerId(params);
    const target = React.useMemo(
        () => (sessionId ? { sessionId, serverId } : null),
        [sessionId, serverId],
    );
    const openAgents = useOpenSessionAgents({ target, replace: true });

    React.useEffect(() => {
        if (!target) return;
        openAgents();
    }, [openAgents, target]);

    if (!sessionId) return <SessionInvalidLinkFallback />;

    return (
        <View testID="session-runs-redirect" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivitySpinner size="small" color={theme.colors.text.secondary} />
        </View>
    );
}

export { SessionRunsCompatibilityRoute as WorkspaceRouteBody };

export default function RouteEntry() { return <WorkspaceRouteEntry Body={SessionRunsCompatibilityRoute} />; }
