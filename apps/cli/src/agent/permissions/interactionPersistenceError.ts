export const WORKFLOW_INTERACTION_CAPACITY_EXCEEDED = 'workflow_interaction_capacity_exceeded';

export type WorkflowInteractionCapacityError = Error & Readonly<{
    code: typeof WORKFLOW_INTERACTION_CAPACITY_EXCEEDED;
    recoverable: true;
}>;

export function createWorkflowInteractionCapacityError(): WorkflowInteractionCapacityError {
    return Object.assign(
        new Error('Workflow interaction exceeds the durable invocation content capacity'),
        { code: WORKFLOW_INTERACTION_CAPACITY_EXCEEDED as typeof WORKFLOW_INTERACTION_CAPACITY_EXCEEDED, recoverable: true as const },
    );
}

export function isWorkflowInteractionCapacityError(error: unknown): error is WorkflowInteractionCapacityError {
    return error instanceof Error
        && (error as { code?: unknown }).code === WORKFLOW_INTERACTION_CAPACITY_EXCEEDED
        && (error as { recoverable?: unknown }).recoverable === true;
}
