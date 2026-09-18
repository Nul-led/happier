import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { HomeAdministrationAccountScreen } from '@/components/settings/home/governance/HomeAdministrationAccountScreen';

export default function HomeAdministrationAccountRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; accountId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const accountId = Array.isArray(params.accountId) ? params.accountId[0] ?? '' : params.accountId ?? '';
    return <HomeAdministrationAccountScreen serverId={serverId} accountId={accountId} />;
}
