import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamCredentialEditScreen } from '@/components/settings/teams/credentials/TeamCredentialEditScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamCredentialRequestPolicyScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        resourceId?: string | string[];
    }>();
    return (
        <TeamCredentialEditScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            resourceId={firstRouteParam(params.resourceId)}
            section="request_policy"
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamCredentialRequestPolicyScreenRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamCredentialRequestPolicyScreenRoute} />; }
