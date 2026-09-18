import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialsScreen } from '@/components/settings/teams/credentials/TeamCredentialsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialsScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamCredentialsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
