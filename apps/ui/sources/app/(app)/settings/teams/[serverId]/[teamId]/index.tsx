import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamOverviewScreen } from '@/components/settings/teams/TeamOverviewScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamOverviewRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamOverviewScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
