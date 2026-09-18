import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamGroupCreateScreen } from '@/components/settings/teams/groups/TeamGroupCreateScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamGroupCreateScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamGroupCreateScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
