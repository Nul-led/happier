import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { HomeAdministrationOverviewScreen } from '@/components/settings/home/governance/HomeAdministrationOverviewScreen';

export default function HomeAdministrationOverviewRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    return <HomeAdministrationOverviewScreen serverId={serverId} />;
}
