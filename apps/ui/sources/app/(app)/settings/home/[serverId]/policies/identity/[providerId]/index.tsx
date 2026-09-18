import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ManagedIdentityProviderDetailScreen } from '@/components/settings/home/identity/ManagedIdentityProviderDetailScreen';

export default function ManagedIdentityProviderDetailRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; providerId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const providerId = Array.isArray(params.providerId) ? params.providerId[0] ?? '' : params.providerId ?? '';
    return <ManagedIdentityProviderDetailScreen serverId={serverId} providerId={providerId} />;
}
