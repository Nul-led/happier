import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { DirectorySyncSettingsScreen } from '@/components/settings/teams/identity/DirectorySyncSettingsScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamDirectoryRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <DirectorySyncSettingsScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
