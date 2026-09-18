import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamGitHubAppEditorScreen } from '@/components/settings/teams/identity/TeamGitHubAppScreens';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamGitHubAppEditRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        registrationId?: string | string[];
    }>();
    return (
        <TeamGitHubAppEditorScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
            registrationId={firstRouteParam(params.registrationId)}
        />
    );
}
