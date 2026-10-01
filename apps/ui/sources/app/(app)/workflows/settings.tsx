import * as React from 'react';

import { AutomationsGate } from '@/components/automations/gating/AutomationsGate';
import { AutomationSettingsScreen } from '@/components/automations/screens/AutomationSettingsScreen';

/** Run settings: capacity and retention, under the one Workflows destination (FIN 04 §3.5, 07 S6). */
export function WorkflowRunSettingsRoute(): React.ReactElement {
    return (
        <AutomationsGate>
            <AutomationSettingsScreen />
        </AutomationsGate>
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { WorkflowRunSettingsRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={WorkflowRunSettingsRoute} />; }
