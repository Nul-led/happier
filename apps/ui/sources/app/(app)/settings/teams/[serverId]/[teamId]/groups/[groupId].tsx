import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamGroupDetailScreen } from '@/components/settings/teams/groups/TeamGroupDetailScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamGroupDetailScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[]; groupId?: string | string[] }>();
    return (
        <TeamGroupDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            groupId={firstRouteParam(params.groupId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamGroupDetailScreenRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamGroupDetailScreenRoute} />; }
