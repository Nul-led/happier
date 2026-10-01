import * as React from 'react';

import { TeamsDirectoryScreen } from '@/components/settings/teams/TeamsDirectoryScreen';

export function TeamsDirectoryRoute() {
    return <TeamsDirectoryScreen />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { TeamsDirectoryRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={TeamsDirectoryRoute} />; }
