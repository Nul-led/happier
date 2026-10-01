import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamGitHubAppDetailScreen } from '@/components/settings/teams/identity/TeamGitHubAppScreens';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamGitHubAppRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        registrationId?: string | string[];
    }>();
    return (
        <TeamGitHubAppDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            registrationId={firstRouteParam(params.registrationId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamGitHubAppRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamGitHubAppRoute} />; }
