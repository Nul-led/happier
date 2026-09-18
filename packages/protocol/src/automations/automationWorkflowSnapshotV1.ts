import type { WorkflowValidationIssue } from '../workflows/workflowV1.js';
import { validateWorkflowDefinition } from '../workflows/workflowValidationV1.js';
import {
  WorkflowAcceptedSnapshotV1Schema,
  deriveWorkflowAcceptedPermissionCeilingV1,
  type WorkflowAcceptedSnapshotV1,
  type WorkflowArtifactRevisionV1,
  type WorkflowResolvedInputsV1,
  type WorkflowRunExecutionTargetV1,
  type WorkflowDefinitionMetadataV1,
} from '../workflows/workflowDefinitionV1.js';
import type { WorkflowAcceptedWorkspaceTargetV1 } from '../workflows/workflowWorkspaceV1.js';

export type CreateAutomationWorkflowAcceptedSnapshotV1Result =
  | Readonly<{ kind: 'available'; snapshot: WorkflowAcceptedSnapshotV1 }>
  | Readonly<{ kind: 'contentInvalid'; issues?: readonly WorkflowValidationIssue[] }>;

/**
 * Thin Automation-origin adapter into the canonical workflow snapshot owner.
 *
 * Automation keeps trigger/source/currentness and its legacy one-shot recipe.
 * This adapter only validates and freezes the normalized workflow definition
 * that the shared Run admission service persists; it defines no Automation
 * workflow dialect, serializer, or mutable Artifact lookup.
 */
export function createAutomationWorkflowAcceptedSnapshotV1(params: Readonly<{
  automationId: string;
  definition: unknown;
  metadata?: WorkflowDefinitionMetadataV1;
  inputs: WorkflowResolvedInputsV1;
  machineId: string;
  executionTarget?: WorkflowRunExecutionTargetV1;
  workspaceTarget: WorkflowAcceptedWorkspaceTargetV1;
  source?: Readonly<{
    definitionId: string;
    revision: WorkflowArtifactRevisionV1;
  }>;
}>): CreateAutomationWorkflowAcceptedSnapshotV1Result {
  const validated = validateWorkflowDefinition(params.definition);
  if (!validated.valid || !validated.normalizedDefinition) {
    return validated.issues.length > 0
      ? { kind: 'contentInvalid', issues: validated.issues }
      : { kind: 'contentInvalid' };
  }

  const snapshot = WorkflowAcceptedSnapshotV1Schema.safeParse({
    definition: validated.normalizedDefinition,
    ...(params.metadata ? { metadata: params.metadata } : {}),
    inputs: params.inputs,
    machineId: params.machineId,
    executionTarget: params.executionTarget ?? { kind: 'session' },
    workspaceTarget: params.workspaceTarget,
    authorization: {
      admittedPermissionCeiling: deriveWorkflowAcceptedPermissionCeilingV1(
        validated.normalizedDefinition,
      ),
      principal: { kind: 'host' },
    },
    source: {
      kind: 'automation',
      automationId: params.automationId,
      ...(params.source ?? {}),
    },
  });
  return snapshot.success
    ? { kind: 'available', snapshot: snapshot.data }
    : { kind: 'contentInvalid' };
}
