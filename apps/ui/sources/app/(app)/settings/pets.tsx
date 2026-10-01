import * as React from 'react';

import { PetsSettingsScreen } from '@/components/settings/pets/PetsSettingsScreen';

export const WorkspaceRouteBody = React.memo(function PetsSettingsRoute() {
    return <PetsSettingsScreen />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
