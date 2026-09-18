import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { DirectorySourceDetailScreen } from '@/components/settings/teams/identity/DirectorySourceDetailScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamDirectorySourceRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        sourceId?: string | string[];
    }>();
    return (
        <DirectorySourceDetailScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            sourceId={firstRouteParam(params.sourceId)}
        />
    );
}
