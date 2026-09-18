import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamInvitationCreateScreen } from '@/components/settings/teams/invitations/TeamInvitationCreateScreen';
import { firstRouteParam } from '@/components/settings/teams/teamRouteParams';

export default function TeamInvitationCreateScreenRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; teamId?: string | string[] }>();
    return (
        <TeamInvitationCreateScreen
            serverId={firstRouteParam(params.serverId)}
            teamId={firstRouteParam(params.teamId)}
        />
    );
}
