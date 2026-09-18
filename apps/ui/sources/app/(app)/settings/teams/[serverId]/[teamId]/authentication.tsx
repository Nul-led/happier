import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamAuthenticationSettingsScreen } from '@/components/settings/teams/identity/TeamAuthenticationSettingsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamAuthenticationRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamAuthenticationSettingsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
