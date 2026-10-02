import * as React from 'react';

import { useAppShellColumn } from '@/components/navigation/shell/appRail/appShellColumnContext';
import { WorkflowsColumn } from '@/components/workflows/column/WorkflowsColumn';
import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';
import { useWorkflowsDestinationAccess } from '@/components/workflows/gating/workflowsDestinationAccess';

import { WorkflowsLibraryHome } from './WorkflowsLibraryHome';

/**
 * `/workflows`. Beside the Workflows column, main shows the library home, which carries only what the
 * column lacks. Without the column — a phone, or a collapsed column — the column is the destination's
 * first screen, so Definitions, the shared Runs view and Account triggers remain reachable.
 */
export const WorkflowsDestinationIndex = React.memo(function WorkflowsDestinationIndex() {
    const columnVisible = useAppShellColumn().columnVisible;
    const access = useWorkflowsDestinationAccess();
    if (!columnVisible && (access.kind === 'workflows' || access.kind === 'triggersOnly')) {
        return <WorkflowsColumn surface="page" />;
    }
    return <WorkflowsGate surface="destination"><WorkflowsLibraryHome /></WorkflowsGate>;
});
