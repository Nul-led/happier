import * as React from 'react';
import { useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

import { HomeSettingsPage } from '@/components/settings/server/collection/HomeSettingsPage';

export function HomeSettingsRoute() {
    const params = useLocalSearchParams<{ homeId?: string | string[] }>();
    const homeId = Array.isArray(params.homeId) ? params.homeId[0] : params.homeId;
    return <HomeSettingsPage homeId={homeId ?? ''} />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { HomeSettingsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={HomeSettingsRoute} />; }
