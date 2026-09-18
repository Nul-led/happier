import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamMemberAddScreen } from '@/components/settings/teams/members/TeamMemberAddScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamMemberAddRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamMemberAddScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
