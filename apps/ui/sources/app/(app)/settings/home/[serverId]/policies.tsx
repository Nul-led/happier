import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { HomeAdministrationPoliciesScreen } from '@/components/settings/home/governance/HomeAdministrationPoliciesScreen';

export default function HomeAdministrationPoliciesRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    return <HomeAdministrationPoliciesScreen serverId={serverId} />;
}
