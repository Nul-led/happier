import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamSettingsScreen } from '@/components/settings/teams/TeamSettingsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamSettingsRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamSettingsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
