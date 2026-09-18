import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TeamCreateScreen } from '@/components/settings/teams/TeamCreateScreen';

export default function TeamCreateRoute() {
    const params = useLocalSearchParams<{ administrationServerId?: string | string[] }>();
    const administrationServerId = typeof params.administrationServerId === 'string'
        ? params.administrationServerId
        : undefined;
    return <TeamCreateScreen administrationServerId={administrationServerId} />;
}
