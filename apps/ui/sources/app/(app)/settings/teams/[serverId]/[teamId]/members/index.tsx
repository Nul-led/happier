import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamMembersScreen } from '@/components/settings/teams/members/TeamMembersScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamMembersRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamMembersScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
