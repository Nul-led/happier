import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamManagedIdentityProviderEditorScreen } from '@/components/settings/teams/identity/TeamIdentityProviderSetupScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamManagedIdentityProviderEditorRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        connectionId?: string | string[];
        providerId?: string | string[];
    }>();
    return <TeamManagedIdentityProviderEditorScreen
        serverId={firstRouteParam(params.serverId)}
        teamId={firstRouteParam(params.teamId)}
        connectionId={firstRouteParam(params.connectionId)}
        providerId={firstRouteParam(params.providerId)}
    />;
}
