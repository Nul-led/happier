import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamJoinScreen } from '@/components/teams/join/TeamJoinScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

/**
 * The public join destination. The bearer travels in the path so the shared
 * capability redactor can template it wherever a URL is logged; it is handed
 * straight to the screen and never stored.
 */
export default function TeamJoinRoute() {
    const params = useLocalSearchParams<{
        token?: string | string[];
        target?: string | string[];
        targetBinding?: string | string[];
    }>();
    return (
        <TeamJoinScreen
            token={firstRouteParam(params.token)}
            homeTarget={firstRouteParam(params.target) || null}
            targetBinding={firstRouteParam(params.targetBinding) || null}
        />
    );
}
