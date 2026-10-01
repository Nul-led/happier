import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { DirectorySourceDetailScreen } from '@/components/settings/teams/identity/DirectorySourceDetailScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamDirectorySourceRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        sourceId?: string | string[];
    }>();
    return (
        <DirectorySourceDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            sourceId={firstRouteParam(params.sourceId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamDirectorySourceRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamDirectorySourceRoute} />; }
