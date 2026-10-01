import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamCreateScreen } from '@/components/settings/teams/TeamCreateScreen';

export function TeamCreateRoute() {
    const params = useLocalSearchParams<{ administrationServerId?: string | string[] }>();
    const administrationServerId = typeof params.administrationServerId === 'string'
        ? params.administrationServerId
        : undefined;
    return <TeamCreateScreen administrationServerId={administrationServerId} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamCreateRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamCreateRoute} />; }
