import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamGroupCreateScreen } from '@/components/settings/teams/groups/TeamGroupCreateScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamGroupCreateScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamGroupCreateScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamGroupCreateScreenRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamGroupCreateScreenRoute} />; }
