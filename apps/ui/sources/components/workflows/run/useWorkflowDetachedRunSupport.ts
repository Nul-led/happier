import * as React from 'react';

import {
    detectDetachedExecutionRunSupport,
    type DetachedExecutionRunSupport,
} from '@/sync/ops/actions/executionRunDetachedSupport';

/**
 * The selected machine's detached Execution Run support, for **Run as**.
 *
 * One probe per exact machine, started only when a machine is actually
 * selected, and retired with it: the editor never carries a stale answer from a
 * machine the author has since changed. While the probe is in flight the result
 * is `unknown`, which the control renders as a truthful "checking" reason
 * rather than as a refusal.
 */
export function useWorkflowDetachedRunSupport(
    machineId: string | null,
    serverId?: string | null,
): DetachedExecutionRunSupport {
    const [support, setSupport] = React.useState<DetachedExecutionRunSupport>(
        machineId === null ? 'machine_not_selected' : 'unknown',
    );

    React.useEffect(() => {
        if (machineId === null || machineId.trim().length === 0) {
            setSupport('machine_not_selected');
            return;
        }
        setSupport('unknown');
        const controller = new AbortController();
        let cancelled = false;
        void (async () => {
            const result = await detectDetachedExecutionRunSupport({
                machineId,
                serverId: serverId ?? null,
                signal: controller.signal,
            });
            if (cancelled) return;
            setSupport(result);
        })();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [machineId, serverId]);

    return support;
}
