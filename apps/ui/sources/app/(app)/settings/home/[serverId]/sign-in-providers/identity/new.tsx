import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { ManagedIdentityProviderEditorScreen } from '@/components/settings/home/identity/ManagedIdentityProviderEditorScreen';

export function ManagedIdentityProviderCreateRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    return <ManagedIdentityProviderEditorScreen serverId={serverId} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ManagedIdentityProviderCreateRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ManagedIdentityProviderCreateRoute} />; }
