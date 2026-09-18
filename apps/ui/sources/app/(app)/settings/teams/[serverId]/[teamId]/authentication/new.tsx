import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamIdentityProviderSetupScreen } from '@/components/settings/teams/identity/TeamIdentityProviderSetupScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamIdentityProviderSetupRoute() {
    const params = useLocalSearchParams<{
        serverId?: string | string[];
        teamId?: string | string[];
        kind?: string | string[];
    }>();
    const kind = firstRouteParam(params.kind);
    return <TeamIdentityProviderSetupScreen
        serverId={firstRouteParam(params.serverId)}
        teamId={firstRouteParam(params.teamId)}
        providerKind={kind === 'github_app_identity' ? 'github_app_identity' : 'oidc'}
    />;
}
