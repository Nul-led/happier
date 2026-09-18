import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ManagedGitHubAppEditorScreen } from '@/components/settings/home/githubApps/ManagedGitHubAppEditorScreen';

export default function ManagedGitHubAppCreateRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    return <ManagedGitHubAppEditorScreen serverId={serverId} />;
}
