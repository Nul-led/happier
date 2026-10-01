import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamCredentialEditScreen } from '@/components/settings/teams/credentials/TeamCredentialEditScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamCredentialEditScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        resourceId?: string | string[];
        section?: string | string[];
    }>();
    return (
        <TeamCredentialEditScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            resourceId={firstRouteParam(params.resourceId)}
            section={(() => {
                const section = firstRouteParam(params.section);
                if (section === 'access' || section === 'limits') return section;
                return section === 'request-policy' ? 'request_policy' : undefined;
            })()}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamCredentialEditScreenRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamCredentialEditScreenRoute} />; }
