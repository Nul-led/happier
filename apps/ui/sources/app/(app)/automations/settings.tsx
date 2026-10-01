import * as React from 'react';

import { Redirect } from '@/components/appShell/workspace/destinationRoute';

/** Retired: run settings live under Workflows (FIN 04 §3.5). */
export function AutomationSettingsRoute(): React.ReactElement {
    return <Redirect href="/workflows/settings" />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { AutomationSettingsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={AutomationSettingsRoute} />; }
