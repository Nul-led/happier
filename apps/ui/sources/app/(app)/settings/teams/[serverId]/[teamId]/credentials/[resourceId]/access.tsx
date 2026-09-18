import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialEditScreen } from '@/components/settings/teams/credentials/TeamCredentialEditScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialAudienceScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        resourceId?: string | string[];
    }>();
    return (
        <TeamCredentialEditScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            resourceId={firstRouteParam(params.resourceId)}
            section="access"
        />
    );
}
