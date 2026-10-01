import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { ManagedIdentityProviderEditorScreen } from '@/components/settings/home/identity/ManagedIdentityProviderEditorScreen';

export function ManagedIdentityProviderEditRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; providerId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const providerId = Array.isArray(params.providerId) ? params.providerId[0] ?? '' : params.providerId ?? '';
    return <ManagedIdentityProviderEditorScreen serverId={serverId} providerId={providerId} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ManagedIdentityProviderEditRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ManagedIdentityProviderEditRoute} />; }
