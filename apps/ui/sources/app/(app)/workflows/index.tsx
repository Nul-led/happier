import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { WorkflowsHostScreen } from '@/components/workflows/screens/WorkflowsHostScreen';
import type { WorkflowsCollectionView } from '@/components/workflows/screens/WorkflowsScreen';
import { WorkflowsGate } from '@/components/workflows/gating/WorkflowsGate';

/**
 * The Workflows collection route.
 *
 * `view` is an optional route intent that selects the initial tab only when the
 * route explicitly names one; it carries no private content.
 */
export default function WorkflowsRoute(): React.ReactElement {
    const params = useLocalSearchParams<{ view?: string | string[] }>();
    const requested = Array.isArray(params.view) ? params.view[0] : params.view;
    const initialView: WorkflowsCollectionView | undefined = requested === 'runs'
        ? 'runs'
        : requested === 'saved' ? 'saved' : undefined;

    return <WorkflowsGate><WorkflowsHostScreen {...(initialView === undefined ? {} : { initialView })} /></WorkflowsGate>;
}
