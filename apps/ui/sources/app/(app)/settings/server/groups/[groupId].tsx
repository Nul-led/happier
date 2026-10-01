import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { HomeGroupPage } from '@/components/settings/server/collection/HomeGroupPage';

export function HomeGroupRoute() {
    const params = useLocalSearchParams<{ groupId?: string | string[] }>();
    const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
    return <HomeGroupPage groupId={groupId ?? null} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { HomeGroupRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={HomeGroupRoute} />; }
