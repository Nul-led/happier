import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamInvitationsScreen } from '@/components/settings/teams/invitations/TeamInvitationsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamInvitationsScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamInvitationsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
