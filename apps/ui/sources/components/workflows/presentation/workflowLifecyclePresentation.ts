import type {
    WorkflowInvocationLifecycleV1,
    WorkflowRunStateV1,
} from '@happier-dev/protocol/workflows/workflowProgressV1';

import type { IconName } from '@/components/ui/icons/Icon';
import type { StatusPillVariant } from '@/components/ui/status/StatusPill';
import { t } from '@/text';

/**
 * The one neutral presenter for the managed Workflow invocation lifecycle.
 *
 * Parent Run state and per-invocation lifecycle are two different closed
 * contracts (UX §3.4). This module owns the second one only, and it owns it
 * completely: label, semantic colour and the visual marker are decided here so
 * Run detail, Flow and the Workflows collection cannot drift apart or render
 * every lifecycle identically.
 *
 * Two rules are structural rather than stylistic:
 *
 * 1. **Colour is never the sole carrier.** Every lifecycle pairs its semantic
 *    colour with a distinct marker, so the difference survives monochrome,
 *    increased contrast and colour-blind reading.
 * 2. **Nothing here decides a lifecycle.** The value always comes from the
 *    canonical server projection; this module only describes it.
 *
 * Observed native-agent activity keeps its own separate owners
 * (`workflowStatusIcon.tsx` / `workflowStatusLabel.ts`): those render
 * `SessionWorkflowRunStatusV1`, an observation contract that deliberately
 * cannot represent managed lifecycle. They are not a competing mapping for this
 * one, and merging them would be exactly the status guesser plan 04 §3.1
 * forbids.
 */

/** The lifecycles the server's `attention: 'required'` predicate treats as actionable. */
export const WORKFLOW_ATTENTION_LIFECYCLES: readonly WorkflowInvocationLifecycleV1[] = [
    'waiting_for_approval', 'needs_attention', 'cancel_requested', 'outcome_uncertain',
];

/**
 * What leads the status.
 *
 * `activity` means the canonical spinner: work this Run owns is genuinely in
 * flight right now. Everything else is a static glyph, because a spinner beside
 * settled or queued work claims motion that is not happening.
 */
export type WorkflowLifecycleMarker =
    | Readonly<{ kind: 'activity' }>
    | Readonly<{ kind: 'icon'; icon: IconName }>;

export type WorkflowLifecyclePresentation = Readonly<{
    lifecycle: WorkflowInvocationLifecycleV1;
    label: string;
    variant: StatusPillVariant;
    marker: WorkflowLifecycleMarker;
    /** Mirrors the server predicate; it is not a second attention decision. */
    attention: boolean;
    /** Settled: this row will not change again without an explicit new attempt. */
    terminal: boolean;
}>;

type WorkflowLifecycleShape = Readonly<{
    variant: StatusPillVariant;
    marker: WorkflowLifecycleMarker;
    terminal: boolean;
}>;

const ACTIVITY: WorkflowLifecycleMarker = { kind: 'activity' };

function icon(name: IconName): WorkflowLifecycleMarker {
    return { kind: 'icon', icon: name };
}

/**
 * The complete 13-value table. It is a record rather than a switch so a
 * Protocol addition fails to compile here — at the one owner — instead of
 * silently falling through to a neutral circle in three screens.
 */
const WORKFLOW_LIFECYCLE_SHAPES: Readonly<Record<WorkflowInvocationLifecycleV1, WorkflowLifecycleShape>> = {
    pending: { variant: 'info', marker: icon('clock'), terminal: false },
    waiting_for_capacity: { variant: 'info', marker: icon('hourglass'), terminal: false },
    admitting: { variant: 'info', marker: ACTIVITY, terminal: false },
    running: { variant: 'success', marker: ACTIVITY, terminal: false },
    waiting_for_approval: { variant: 'warning', marker: icon('hand'), terminal: false },
    needs_attention: { variant: 'warning', marker: icon('warning-circle'), terminal: false },
    completed: { variant: 'success', marker: icon('check-circle'), terminal: true },
    failed: { variant: 'danger', marker: icon('x-circle'), terminal: true },
    skipped: { variant: 'neutral', marker: icon('minus-circle'), terminal: true },
    // Stopping is not stopped: a durable stop request is not proof the work ended.
    cancel_requested: { variant: 'info', marker: icon('stop-circle'), terminal: false },
    cancelled: { variant: 'neutral', marker: icon('stop'), terminal: true },
    outcome_uncertain: { variant: 'warning', marker: icon('question'), terminal: false },
    superseded: { variant: 'neutral', marker: icon('arrow-clockwise'), terminal: true },
};

export function describeWorkflowInvocationLifecycle(
    lifecycle: WorkflowInvocationLifecycleV1,
): WorkflowLifecyclePresentation {
    const shape = WORKFLOW_LIFECYCLE_SHAPES[lifecycle];
    return {
        lifecycle,
        label: t(`workflows.invocationState.${lifecycle}`),
        variant: shape.variant,
        marker: shape.marker,
        attention: WORKFLOW_ATTENTION_LIFECYCLES.includes(lifecycle),
        terminal: shape.terminal,
    };
}

/**
 * The parent Run state — a different closed contract, mapped separately.
 *
 * It lives beside the invocation table rather than merged into it so both stay
 * exhaustive and neither can be used where the other belongs. Callers that
 * compose a terminal outcome sentence ("Done with failures") pass their own
 * label; this owner never invents a terminal state the server did not report.
 */
export type WorkflowRunStatePresentation = Readonly<{
    state: WorkflowRunStateV1;
    label: string;
    variant: StatusPillVariant;
    marker: WorkflowLifecycleMarker;
    terminal: boolean;
}>;

const TERMINAL_RUN_STATES: ReadonlySet<WorkflowRunStateV1> = new Set([
    'succeeded', 'failed', 'cancelled', 'outcome_uncertain',
    'expired', 'missed', 'dispatch_failed', 'skipped',
]);

export function isTerminalWorkflowRunState(state: WorkflowRunStateV1): boolean {
    return TERMINAL_RUN_STATES.has(state);
}

const WORKFLOW_RUN_STATE_SHAPES: Readonly<Record<
    WorkflowRunStateV1,
    Readonly<{ variant: StatusPillVariant; marker: WorkflowLifecycleMarker }>
>> = {
    queued: { variant: 'info', marker: icon('clock') },
    claimed: { variant: 'info', marker: ACTIVITY },
    running: { variant: 'success', marker: ACTIVITY },
    succeeded: { variant: 'success', marker: icon('check-circle') },
    failed: { variant: 'danger', marker: icon('x-circle') },
    cancelled: { variant: 'neutral', marker: icon('stop') },
    pause_requested: { variant: 'info', marker: icon('pause-circle') },
    paused: { variant: 'neutral', marker: icon('pause-circle') },
    interrupted: { variant: 'warning', marker: icon('warning-circle') },
    expired: { variant: 'warning', marker: icon('hourglass') },
    dispatch_failed: { variant: 'danger', marker: icon('warning') },
    skipped: { variant: 'neutral', marker: icon('minus-circle') },
    missed: { variant: 'warning', marker: icon('minus-circle') },
    outcome_uncertain: { variant: 'warning', marker: icon('question') },
};

export function describeWorkflowRunState(state: WorkflowRunStateV1): WorkflowRunStatePresentation {
    const shape = WORKFLOW_RUN_STATE_SHAPES[state];
    return {
        state,
        label: t(`workflows.runState.${state}`),
        variant: shape.variant,
        marker: shape.marker,
        terminal: TERMINAL_RUN_STATES.has(state),
    };
}

/**
 * How a physical attempt counter reads to a person.
 *
 * The index counts attempts from zero as a canonical decimal string; people
 * count from one. Activity rows, Flow occurrences, the selected detail and
 * their accessible names all read this one owner, so a retried step is
 * "Attempt 2" everywhere. The counter is 64-bit on the server, so it is
 * incremented as a BigInt and never passed through a JS number.
 */
export function describeWorkflowInvocationAttempt(attempt: string): Readonly<{
    label: string;
    /** True for every attempt after the first, which is the only one worth calling out. */
    retried: boolean;
}> {
    const ordinal = /^\d+$/.test(attempt) ? (BigInt(attempt) + 1n).toString() : attempt;
    return {
        label: t('workflows.run.attempt', { attempt: ordinal }),
        retried: attempt !== '0',
    };
}

/** Real child coverage read from loaded rows; `superseded` attempts never double-count a step. */
export type WorkflowRunCoverage = Readonly<{
    completed: number;
    failed: number;
    attention: number;
}>;

export function summarizeWorkflowInvocationCoverage(
    invocations: readonly Readonly<{ lifecycle: WorkflowInvocationLifecycleV1 }>[],
): WorkflowRunCoverage {
    let completed = 0;
    let failed = 0;
    let attention = 0;
    for (const invocation of invocations) {
        if (invocation.lifecycle === 'superseded') continue;
        if (invocation.lifecycle === 'completed') completed += 1;
        if (invocation.lifecycle === 'failed') failed += 1;
        if (WORKFLOW_ATTENTION_LIFECYCLES.includes(invocation.lifecycle)) attention += 1;
    }
    return { completed, failed, attention };
}
