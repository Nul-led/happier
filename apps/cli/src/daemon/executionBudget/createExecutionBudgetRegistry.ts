import { configuration } from '@/configuration';
import { ExecutionBudgetRegistry } from './ExecutionBudgetRegistry';

/** One configuration owner for Session and detached daemon execution budgets. */
export function createExecutionBudgetRegistry(): ExecutionBudgetRegistry | undefined {
    const hasBudgetCaps =
        configuration.executionRunsMaxConcurrentPerSession !== null
        || configuration.oneShotTasksMaxConcurrentPerSession !== null
        || typeof configuration.executionBudgetMaxConcurrentTotalPerSession === 'number'
        || (configuration.executionBudgetMaxConcurrentByClass && Object.keys(configuration.executionBudgetMaxConcurrentByClass).length > 0);
    if (!hasBudgetCaps) return undefined;

    return new ExecutionBudgetRegistry({
        maxConcurrentExecutionRuns: configuration.executionRunsMaxConcurrentPerSession,
        maxConcurrentOneShotTasks: configuration.oneShotTasksMaxConcurrentPerSession,
        ...(typeof configuration.executionBudgetMaxConcurrentTotalPerSession === 'number'
            ? { maxConcurrentTotal: configuration.executionBudgetMaxConcurrentTotalPerSession }
            : {}),
        ...(configuration.executionBudgetMaxConcurrentByClass
            && Object.keys(configuration.executionBudgetMaxConcurrentByClass).length > 0
            ? { maxConcurrentByClass: configuration.executionBudgetMaxConcurrentByClass }
            : {}),
    });
}
