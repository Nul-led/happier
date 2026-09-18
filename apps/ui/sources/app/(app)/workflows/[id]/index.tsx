import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import {
    WorkflowEditorHostScreen,
    type WorkflowSavedEntryIntent,
} from '@/components/workflows/screens/WorkflowEditorHostScreen';
import { WorkflowMissingDefinitionState } from '@/components/workflows/screens/WorkflowMissingDefinitionState';
import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';

/**
 * Saved workflow detail. The row, this detail and the edit route share one
 * Artifact identity, scope and Action owner, so opening from either place shows
 * the same revision.
 *
 * `intent` is the optional entry intent a saved row's Run now or Schedule
 * carries. It is a closed vocabulary and contains no definition content; the
 * editor host consumes it once, after this revision is reviewed.
 */
function readSavedEntryIntent(raw: string | string[] | undefined): WorkflowSavedEntryIntent | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value === 'run' || value === 'schedule' ? value : undefined;
}

export default function SavedWorkflowRoute(): React.ReactElement {
    const params = useLocalSearchParams<{ id?: string | string[]; intent?: string | string[] }>();
    const definitionId = Array.isArray(params.id) ? params.id[0] : params.id;
    const intent = readSavedEntryIntent(params.intent);
    if (definitionId === undefined || definitionId.length === 0) {
        return <WorkflowsGate><WorkflowMissingDefinitionState testID="workflow-detail-invalid" /></WorkflowsGate>;
    }
    return (
        <WorkflowsGate>
            <WorkflowEditorHostScreen source={{
                kind: 'saved',
                definitionId,
                ...(intent === undefined ? {} : { intent }),
            }} />
        </WorkflowsGate>
    );
}
