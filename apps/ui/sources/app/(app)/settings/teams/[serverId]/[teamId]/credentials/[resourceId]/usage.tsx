import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialUsageScreen } from '@/components/settings/teams/credentials/TeamCredentialUsageScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialUsageScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        resourceId?: string | string[];
    }>();
    return (
        <TeamCredentialUsageScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            resourceId={firstRouteParam(params.resourceId)}
        />
    );
}
