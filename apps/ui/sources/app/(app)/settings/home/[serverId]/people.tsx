import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { HomeAdministrationPeopleScreen } from '@/components/settings/home/governance/HomeAdministrationPeopleScreen';

export default function HomeAdministrationPeopleRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    return <HomeAdministrationPeopleScreen serverId={serverId} />;
}
