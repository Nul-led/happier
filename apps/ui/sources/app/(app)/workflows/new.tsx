import * as React from 'react';
import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';
import { useLocalSearchParams } from 'expo-router';

import { WorkflowEditorHostScreen } from '@/components/workflows/screens/WorkflowEditorHostScreen';

/** Thin neutral create route; the host owns draft identity and the explicit effects. */
export default function NewWorkflowRoute(): React.ReactElement {
    const params = useLocalSearchParams<{ importJson?: string; reviewedRunSeedId?: string }>();
    // Only the opaque seed handle travels in the URL; the reviewed definition,
    // placement and accepted inputs stay in the temporary-data store.
    const reviewedRunSeedId = typeof params.reviewedRunSeedId === 'string' && params.reviewedRunSeedId.length > 0
        ? params.reviewedRunSeedId
        : undefined;
    return <WorkflowsGate><WorkflowEditorHostScreen source={{
        kind: 'new',
        ...(params.importJson === '1' ? { requestImport: true } : {}),
        ...(reviewedRunSeedId === undefined ? {} : { reviewedRunSeedId }),
    }} /></WorkflowsGate>;
}
