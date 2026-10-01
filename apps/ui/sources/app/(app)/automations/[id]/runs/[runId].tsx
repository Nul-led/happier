import React from 'react';

import { AutomationsGate } from '@/components/automations/gating/AutomationsGate';
import { AutomationRunDetailScreen } from '@/components/automations/screens/AutomationRunDetailScreen';

export function AutomationRunDetailRoute() {
    return (
        <AutomationsGate>
            <AutomationRunDetailScreen />
        </AutomationsGate>
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { AutomationRunDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={AutomationRunDetailRoute} />; }
