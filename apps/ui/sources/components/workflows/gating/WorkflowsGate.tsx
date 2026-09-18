import * as React from 'react';

import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { resolveWorkflowsUnavailablePresentation } from '@/components/workflows/presentation/workflowProblemPresentation';
import { t } from '@/text';

import { useWorkflowsAvailability } from './workflowsAvailability';

export function WorkflowsGate(props: Readonly<{ children: React.ReactNode }>): React.ReactElement {
    const workflows = useWorkflowsAvailability();

    if (workflows.resolving) {
        return (
            <SurfaceStateCard
                testID="workflows-gate-loading"
                kind="loading"
                title={t('workflows.editor.loadingTitle')}
                accessibilitySemantics="status"
            />
        );
    }

    if (!workflows.available) {
        // An unavailable capability is not a failed read: the canonical Workflow
        // problem mapping owns that state, its copy and the fact that there is
        // no repair to offer here.
        const unavailable = resolveWorkflowsUnavailablePresentation();
        return (
            <SurfaceStateCard
                testID="workflows-gate-disabled"
                kind="unavailable"
                title={unavailable.title}
                reason={unavailable.message}
                accessibilitySemantics={unavailable.accessibilitySemantics}
            />
        );
    }

    return <>{props.children}</>;
}
