import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { HomeAdministrationActivityScreen } from '@/components/settings/home/governance/HomeAdministrationActivityScreen';

export function HomeAdministrationActivityRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; targetId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const targetId = Array.isArray(params.targetId) ? params.targetId[0] ?? '' : params.targetId ?? '';
    return <HomeAdministrationActivityScreen serverId={serverId} targetId={targetId} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { HomeAdministrationActivityRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={HomeAdministrationActivityRoute} />; }
