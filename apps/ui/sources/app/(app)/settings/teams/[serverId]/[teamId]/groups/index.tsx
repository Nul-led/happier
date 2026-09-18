import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamGroupsScreen } from '@/components/settings/teams/groups/TeamGroupsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamGroupsScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamGroupsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
