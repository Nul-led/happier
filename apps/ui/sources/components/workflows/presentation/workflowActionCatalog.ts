import { listActionSpecs, type ActionSpec } from '@happier-dev/protocol/actions/actionSpecs';

/** The Action a block calls, from the one host Action catalog; `null` when this client does not know it. */
export function findWorkflowActionSpec(actionId: string): ActionSpec | null {
    return listActionSpecs().find((spec) => spec.id === actionId) ?? null;
}

/**
 * The Actions offered as workflow steps: host Actions an agent can call, minus
 * `workflow.run.*` (composition is the Run a workflow step, U4).
 */
export function listWorkflowStepActionSpecs(): readonly ActionSpec[] {
    return listActionSpecs().filter((spec) => spec.surfaces.agent && !spec.id.startsWith('workflow.run.'));
}
