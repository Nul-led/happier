import * as React from 'react';
import type { TriggerTargetV1 } from '@happier-dev/protocol';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { buildTriggerWorkflowSeed, storeTriggerWorkflowSeed, type TriggerRetarget } from './triggerWorkflowSeed';

/** Save as workflow: opens a trigger's own steps as an unsaved workflow draft (`/workflows/new`). */
export function useOpenTriggerAsWorkflow(): (target: TriggerTargetV1, retarget: TriggerRetarget) => void {
    const router = useRouter();
    return React.useCallback((target, retarget) => {
        const seed = buildTriggerWorkflowSeed(target, retarget);
        if (seed === null) return;
        router.push({ pathname: '/workflows/new', params: { triggerWorkflowSeedId: storeTriggerWorkflowSeed(seed) } } as never);
    }, [router]);
}
