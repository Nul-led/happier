import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { WorkflowEditorHostScreen } from '@/components/workflows/screens/WorkflowEditorHostScreen';
import { WorkflowMissingDefinitionState } from '@/components/workflows/screens/WorkflowMissingDefinitionState';
import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';

/** Thin Artifact edit route. Identity only — no private definition in the URL. */
export default function EditWorkflowRoute(): React.ReactElement {
    const params = useLocalSearchParams<{ id?: string | string[] }>();
    const definitionId = Array.isArray(params.id) ? params.id[0] : params.id;
    if (definitionId === undefined || definitionId.length === 0) {
        return <WorkflowsGate><WorkflowMissingDefinitionState testID="workflow-edit-invalid" /></WorkflowsGate>;
    }
    return <WorkflowsGate><WorkflowEditorHostScreen source={{ kind: 'saved', definitionId }} /></WorkflowsGate>;
}
