import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamAuthenticationSettingsScreen } from '@/components/settings/teams/identity/TeamAuthenticationSettingsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamAuthenticationRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamAuthenticationSettingsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamAuthenticationRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamAuthenticationRoute} />; }
