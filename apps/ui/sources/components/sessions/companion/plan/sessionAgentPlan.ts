import type { Session } from '@/sync/domains/state/storageTypes';

/**
 * The agent's Plan: a read-only projection of the latest to-do list the
 * transcript reducer already keeps on the Session (`session.todos`, from the
 * agent's own TodoWrite calls). It owns no state and adds no source of truth —
 * the Companion's Plan card and the Summary's "step N of M" line both read it.
 */

export type SessionAgentPlanStepStatus = 'done' | 'current' | 'todo';

export type SessionAgentPlanStep = Readonly<{
    id: string;
    text: string;
    status: SessionAgentPlanStepStatus;
}>;

export type SessionAgentPlan = Readonly<{
    steps: readonly SessionAgentPlanStep[];
    doneCount: number;
    total: number;
    /** 1-based step the agent marked in progress, if any. */
    currentStep: number | null;
    /** 1-based first step not yet done, if any. */
    nextStep: number | null;
}>;

type SessionTodos = NonNullable<Session['todos']>;

// The reducer replaces the list only when it changes, so the list's identity is
// the projection's cache key: an unchanged list keeps the same plan object.
const projected = new WeakMap<SessionTodos, SessionAgentPlan>();

function stepStatus(status: SessionTodos[number]['status']): SessionAgentPlanStepStatus {
    if (status === 'completed') return 'done';
    if (status === 'in_progress') return 'current';
    return 'todo';
}

export function projectSessionAgentPlan(todos: Session['todos'] | null | undefined): SessionAgentPlan | null {
    if (!todos || todos.length === 0) return null;
    const cached = projected.get(todos);
    if (cached) return cached;

    let doneCount = 0;
    let currentStep: number | null = null;
    let nextStep: number | null = null;
    const steps = todos.map((todo, index): SessionAgentPlanStep => {
        const status = stepStatus(todo.status);
        if (status === 'done') doneCount += 1;
        if (status === 'current' && currentStep === null) currentStep = index + 1;
        if (status !== 'done' && nextStep === null) nextStep = index + 1;
        return Object.freeze({ id: todo.id || `step-${index}`, text: todo.content, status });
    });
    const plan: SessionAgentPlan = Object.freeze({
        steps: Object.freeze(steps),
        doneCount,
        total: steps.length,
        currentStep,
        nextStep,
    });
    projected.set(todos, plan);
    return plan;
}
