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
    const token = firstRouteParam(params.token);
    const homeTarget = firstRouteParam(params.target) || null;
    // Expo Router updates a mounted dynamic route's params in place, so a second
    // invitation link arrives without a remount. The screen's selected action,
    // identity recovery and completed admission are all bound to ONE invitation
    // on ONE Home, so the screen is keyed by that authority instead of being
    // reset field by field — the same rule the Team sign-in route already applies.
    return (
        <TeamJoinScreen
            key={`${token}\u0000${homeTarget ?? ''}`}
            token={token}
            homeTarget={homeTarget}
            targetBinding={firstRouteParam(params.targetBinding) || null}
        />
    );
}
