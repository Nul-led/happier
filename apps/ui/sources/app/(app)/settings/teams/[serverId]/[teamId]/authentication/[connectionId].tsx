import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { IdentityConnectionDetailScreen } from '@/components/settings/teams/identity/IdentityConnectionDetailScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function IdentityConnectionDetailRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        connectionId?: string | string[];
        purpose?: string | string[];
        resultHandle?: string | string[];
        error?: string | string[];
    }>();
    return (
        <IdentityConnectionDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            connectionId={firstRouteParam(params.connectionId)}
            workosPortalReturn={firstRouteParam(params.purpose) === 'workos_admin_portal'}
            testReturn={{
                purpose: firstRouteParam(params.purpose) || null,
                resultHandle: firstRouteParam(params.resultHandle) || null,
                error: firstRouteParam(params.error) || null,
            }}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { IdentityConnectionDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={IdentityConnectionDetailRoute} />; }
