import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { DirectorySyncSettingsScreen } from '@/components/settings/teams/identity/DirectorySyncSettingsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamDirectoryRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <DirectorySyncSettingsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamDirectoryRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamDirectoryRoute} />; }
