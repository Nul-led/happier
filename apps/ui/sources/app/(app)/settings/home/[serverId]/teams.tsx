import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { HomeAdministrationTeamsScreen } from '@/components/settings/home/governance/HomeAdministrationTeamsScreen';

export default function HomeAdministrationTeamsRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    return <HomeAdministrationTeamsScreen serverId={serverId} />;
}
