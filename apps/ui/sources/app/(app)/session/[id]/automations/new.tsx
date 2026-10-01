import * as React from 'react';

import { SessionTriggersRedirect } from '@/components/workflows/triggers/SessionTriggersRedirect';

/** Retired: session triggers are the Work tab's Triggers section (FIN 04 §3.2, §5.5). */
export function RetiredSessionAutomationsRoute(): React.ReactElement {
    return <SessionTriggersRedirect />;
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { RetiredSessionAutomationsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={RetiredSessionAutomationsRoute} />; }
