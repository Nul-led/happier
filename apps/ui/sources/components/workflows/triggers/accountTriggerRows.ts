import type { WorkflowTriggerSetV1 } from '@happier-dev/protocol';

import { formatTriggerSetSummary } from './formatTriggerSummary';
import { describeLegacyTriggerSet, describeTriggerTarget } from './sessionTriggerGroups';

export type AccountTriggerRow = Readonly<{
    automationId: string;
    /** "{when}": the set's one summary (07 S1, 04 §3.3). */
    title: string;
    /** "{then}": what it runs, or "Workflow deleted" when its source is gone. */
    subtitle: string;
    /** Turned off: the row says "Off". */
    off: boolean;
    legacy?: NonNullable<ReturnType<typeof describeLegacyTriggerSet>>;
}>;

/**
 * The column's Triggers rows (F1): the Account's trigger sets that hold their own steps, exactly as
 * `workflow.trigger.list {scope:'account_inline'}` returns them — the same membership agents read.
 * A saved workflow's triggers and a session's triggers are not in that list.
 */
export function projectAccountTriggerRows(params: Readonly<{
    sets: readonly WorkflowTriggerSetV1[];
    resolveWorkflowTitle: (ref: string) => string | null;
    resolveMachineTitle?: (id: string) => string | null;
}>): readonly AccountTriggerRow[] {
    return params.sets.map((set) => {
        const legacy = describeLegacyTriggerSet(set, params.resolveMachineTitle);
        return {
            automationId: set.automationId,
            title: formatTriggerSetSummary(set.triggers),
            subtitle: legacy ? `${legacy.title}\n${legacy.qualifier}` : describeTriggerTarget(set.health === 'available' ? set.target : undefined, params.resolveWorkflowTitle),
            off: !set.enabled || (set.triggers.length > 0 && set.triggers.every((trigger) => !trigger.enabled)),
            ...(legacy ? { legacy } : {}),
        };
    });
}
