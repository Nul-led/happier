import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ManagedIdentityProviderEditorScreen } from '@/components/settings/home/identity/ManagedIdentityProviderEditorScreen';

export default function ManagedIdentityProviderCreateRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    return <ManagedIdentityProviderEditorScreen serverId={serverId} />;
}
