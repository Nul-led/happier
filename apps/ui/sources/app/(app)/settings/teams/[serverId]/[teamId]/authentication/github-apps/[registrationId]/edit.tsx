import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamGitHubAppEditorScreen } from '@/components/settings/teams/identity/TeamGitHubAppScreens';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamGitHubAppEditRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        registrationId?: string | string[];
    }>();
    return (
        <TeamGitHubAppEditorScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            registrationId={firstRouteParam(params.registrationId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamGitHubAppEditRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamGitHubAppEditRoute} />; }
