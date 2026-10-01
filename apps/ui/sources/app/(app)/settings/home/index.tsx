import * as React from 'react';

import { HomeAdministrationHomesScreen } from '@/components/settings/home/governance/HomeAdministrationHomesScreen';

export function HomeAdministrationHomesRoute() {
    return <HomeAdministrationHomesScreen />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { HomeAdministrationHomesRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={HomeAdministrationHomesRoute} />; }
