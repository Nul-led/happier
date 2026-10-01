import * as React from 'react';

import { Redirect } from '@/components/appShell/workspace/destinationRoute';

/** Retired: the Automations list is the Workflows destination's column (FIN 04 §3.2). */
export function AutomationsIndexRoute(): React.ReactElement {
    return <Redirect href="/workflows" />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { AutomationsIndexRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={AutomationsIndexRoute} />; }
