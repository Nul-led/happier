import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialExternalApiScreen } from '@/components/settings/teams/credentials/TeamCredentialExternalApiScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialExternalApiScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[]; resourceId?: string | string[] }>();
    return <TeamCredentialExternalApiScreen
        serverId={firstRouteParam(params.serverId)}
        teamId={firstRouteParam(params.teamId)}
        resourceId={firstRouteParam(params.resourceId)}
    />;
}
