import React from 'react';

import { AcpCatalogSettingsScreen } from '@/components/settings/acpCatalog/AcpCatalogSettingsScreen';

export const WorkspaceRouteBody = React.memo(function AcpCatalogSettingsRoute() {
    return <AcpCatalogSettingsScreen />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
