import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialDetailScreen } from '@/components/settings/teams/credentials/TeamCredentialDetailScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialDetailScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        resourceId?: string | string[];
    }>();
    return (
        <TeamCredentialDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            resourceId={firstRouteParam(params.resourceId)}
        />
    );
}
