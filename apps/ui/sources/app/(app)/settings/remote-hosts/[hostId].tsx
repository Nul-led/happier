import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { RemoteHostPage } from '@/components/settings/remoteHosts/collection/RemoteHostPage';

export function RemoteHostRoute() {
    const params = useLocalSearchParams<{ hostId?: string | string[] }>();
    const hostId = Array.isArray(params.hostId) ? params.hostId[0] : params.hostId;
    return <RemoteHostPage hostId={hostId ?? ''} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { RemoteHostRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={RemoteHostRoute} />; }
