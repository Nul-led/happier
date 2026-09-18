import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialActivityScreen } from '@/components/settings/teams/credentials/TeamCredentialActivityScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialActivityScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        resourceId?: string | string[];
    }>();
    return (
        <TeamCredentialActivityScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            resourceId={firstRouteParam(params.resourceId)}
        />
    );
}
