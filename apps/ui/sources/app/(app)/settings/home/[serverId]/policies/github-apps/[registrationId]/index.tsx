import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ManagedGitHubAppDetailScreen } from '@/components/settings/home/githubApps/ManagedGitHubAppDetailScreen';

export default function ManagedGitHubAppDetailRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; registrationId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const registrationId = Array.isArray(params.registrationId) ? params.registrationId[0] ?? '' : params.registrationId ?? '';
    return <ManagedGitHubAppDetailScreen serverId={serverId} registrationId={registrationId} />;
}
