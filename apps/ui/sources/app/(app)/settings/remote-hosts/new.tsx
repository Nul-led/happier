import * as React from 'react';

import { RemoteHostPage } from '@/components/settings/remoteHosts/collection/RemoteHostPage';

export function NewRemoteHostRoute() {
    return <RemoteHostPage hostId={null} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { NewRemoteHostRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={NewRemoteHostRoute} />; }
