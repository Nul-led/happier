import React from 'react';

import { AutomationsGate } from '@/components/automations/gating/AutomationsGate';
import { AutomationDetailScreen } from '@/components/automations/screens/AutomationDetailScreen';

export function AutomationDetailRoute() {
    return (
        <AutomationsGate>
            <AutomationDetailScreen />
        </AutomationsGate>
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { AutomationDetailRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={AutomationDetailRoute} />; }
