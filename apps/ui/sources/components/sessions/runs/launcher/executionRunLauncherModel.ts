import type { DetailsTab } from '@/components/appShell/panes/model/appPaneReducer';
import { resolveExecutionRunAvailableBackends, type ExecutionRunBackendCapabilityMap } from '@/sync/domains/executionRuns/resolveExecutionRunAvailableBackends';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import { t } from '@/text';
import {
    ExecutionRunIntentSchema,
    type SessionDiscussionSelectionSourceV1,
} from '@happier-dev/protocol';

export const EXECUTION_RUN_LAUNCH_INTENTS = ['review', 'plan', 'delegate'] as const;

export type ExecutionRunIntent = (typeof EXECUTION_RUN_LAUNCH_INTENTS)[number];

export function resolveExecutionRunLauncherIntent(value: unknown): ExecutionRunIntent | null {
    const normalized = Array.isArray(value) ? value[0] : value;
    const parsed = ExecutionRunIntentSchema.safeParse(normalized);
    if (!parsed.success) return null;
    return EXECUTION_RUN_LAUNCH_INTENTS.includes(parsed.data as ExecutionRunIntent)
        ? (parsed.data as ExecutionRunIntent)
        : null;
}

export function resolveExecutionRunLauncherIntents(
    executionRunsBackends: ExecutionRunBackendCapabilityMap,
): readonly ExecutionRunIntent[] {
    return EXECUTION_RUN_LAUNCH_INTENTS.filter((intent) => resolveExecutionRunAvailableBackends(executionRunsBackends, intent).length > 0);
}

export function resolveExecutionRunLauncherActionId(intent: ExecutionRunIntent): 'review.start' | 'subagents.plan.start' | 'subagents.delegate.start' {
    switch (intent) {
        case 'review':
            return 'review.start';
        case 'plan':
            return 'subagents.plan.start';
        case 'delegate':
            return 'subagents.delegate.start';
    }
}

export function defaultPermissionModeForExecutionRunIntent(intent: ExecutionRunIntent): PermissionMode {
    if (intent === 'review') return 'read-only';
    if (intent === 'plan') return 'read-only';
    return 'safe-yolo';
}

export function createExecutionRunLauncherDetailsTab(intent?: ExecutionRunIntent): DetailsTab {
    return {
        key: intent ? `execution-run-launcher:${intent}` : 'execution-run-launcher',
        kind: 'executionRunLauncher',
        title: intent === 'plan'
            ? t('executionRuns.newRun.intents.plan')
            : intent === 'delegate'
                ? t('executionRuns.newRun.intents.delegate')
                : intent === 'review'
                    ? t('executionRuns.newRun.intents.review')
                    : t('executionRuns.newRun.headerTitle'),
        resource: {
            kind: 'executionRunLauncher',
            ...(intent ? { intent } : {}),
        },
    };
}

/**
 * An empty Agent conversation draft. Unlike the bounded launcher above, this
 * resource does not create a Run until the canonical composer hands off its
 * first outbound message.
 */
export function createInteractiveExecutionRunDraftDetailsTab(): DetailsTab {
    return {
        key: 'execution-run-conversation-draft',
        kind: 'executionRunLauncher',
        title: t('session.subagents.panel.newAgentConversation'),
        resource: {
            kind: 'executionRunLauncher',
            mode: 'conversation',
        },
    };
}

export function createDiscussionSelectionInteractiveExecutionRunDraftDetailsTab(input: Readonly<{
    source: SessionDiscussionSelectionSourceV1 & Readonly<{ draftCorrelationId: string }>;
    initialText: string;
}>): DetailsTab {
    return {
        key: `execution-run-conversation-draft:discussion:${input.source.draftCorrelationId}`,
        kind: 'executionRunLauncher',
        title: t('session.subagents.panel.newAgentConversation'),
        resource: {
            kind: 'executionRunLauncher',
            mode: 'conversation',
            source: input.source,
            initialInstructions: input.initialText,
        },
    };
}

/** A stable Details resource for a materialized execution Run. */
export function createExecutionRunDetailsTab(runId: string, recovery?: Readonly<{ retryInputLocalId: string }>): DetailsTab {
    return {
        key: `execution-run:${runId}`,
        kind: 'executionRun',
        title: t('runs.runLabel', { runId }),
        resource: { kind: 'executionRun', runId, ...(recovery ?? {}) },
    };
}
