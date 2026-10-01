import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { HomeAdministrationAccountScreen } from '@/components/settings/home/governance/HomeAdministrationAccountScreen';

export function HomeAdministrationAccountRoute() {
    const params = useLocalSearchParams<{ serverId?: string | string[]; accountId?: string | string[] }>();
    const serverId = Array.isArray(params.serverId) ? params.serverId[0] ?? '' : params.serverId ?? '';
    const accountId = Array.isArray(params.accountId) ? params.accountId[0] ?? '' : params.accountId ?? '';
    return <HomeAdministrationAccountScreen serverId={serverId} accountId={accountId} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { HomeAdministrationAccountRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={HomeAdministrationAccountRoute} />; }
