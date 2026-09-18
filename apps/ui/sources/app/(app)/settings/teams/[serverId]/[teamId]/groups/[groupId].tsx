import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamGroupDetailScreen } from '@/components/settings/teams/groups/TeamGroupDetailScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamGroupDetailScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[]; groupId?: string | string[] }>();
    return (
        <TeamGroupDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            groupId={firstRouteParam(params.groupId)}
        />
    );
}
