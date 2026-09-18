import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { IdentityConnectionDetailScreen } from '@/components/settings/teams/identity/IdentityConnectionDetailScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function IdentityConnectionDetailRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        connectionId?: string | string[];
        purpose?: string | string[];
        resultHandle?: string | string[];
        error?: string | string[];
    }>();
    return (
        <IdentityConnectionDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            connectionId={firstRouteParam(params.connectionId)}
            testReturn={{
                purpose: firstRouteParam(params.purpose) || null,
                resultHandle: firstRouteParam(params.resultHandle) || null,
                error: firstRouteParam(params.error) || null,
            }}
        />
    );
}
