import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCredentialEditScreen } from '@/components/settings/teams/credentials/TeamCredentialEditScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamCredentialEditScreenRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        resourceId?: string | string[];
        section?: string | string[];
    }>();
    return (
        <TeamCredentialEditScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            resourceId={firstRouteParam(params.resourceId)}
            section={(() => {
                const section = firstRouteParam(params.section);
                if (section === 'access' || section === 'limits') return section;
                return section === 'request-policy' ? 'request_policy' : undefined;
            })()}
        />
    );
}
