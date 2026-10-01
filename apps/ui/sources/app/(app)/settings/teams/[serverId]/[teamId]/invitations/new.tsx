import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { TeamInvitationCreateScreen } from '@/components/settings/teams/invitations/TeamInvitationCreateScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export function TeamInvitationCreateScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamInvitationCreateScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamInvitationCreateScreenRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamInvitationCreateScreenRoute} />; }
