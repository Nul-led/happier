import * as React from 'react';

import { DesktopAppSettingsScreen } from '@/components/settings/desktop/DesktopAppSettingsScreen';

export const WorkspaceRouteBody = React.memo(function DesktopSettingsRoute() {
    return <DesktopAppSettingsScreen />;
});
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkspaceRouteBody} />; }
