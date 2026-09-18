import { z } from 'zod';

import {
  WorkflowDefinitionV1Schema,
  type WorkflowBlock,
  type WorkflowDefinitionV1,
} from './workflowV1.js';
import { WorkflowDefinitionIdV1Schema } from './workflowIdsV1.js';
import { preservedBoundedNfcString } from '../strings/preservedBoundedNfcString.js';
import { StrictJsonValueSchema } from '../json/strictJsonValue.js';
import { AgentPermissionIntentV1Schema } from '../runtime/permissionIntentV1.js';
import { resolvePermissionPrivilegeOrdinal } from '../actions/permissionPrivilege.js';
import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import { SessionInputSourceAuthorityV1Schema } from '../sessions/messages/sessionInputAdmission.js';
import { WorkflowInputNameSchema } from './workflowReferenceV1.js';
import { WorkflowAcceptedWorkspaceTargetV1Schema } from './workflowWorkspaceV1.js';

export const WorkflowArtifactRevisionV1Schema = z.object({
  headerVersion: z.number().int().nonnegative().safe(),
  bodyVersion: z.number().int().nonnegative().safe(),
}).strict();
export type WorkflowArtifactRevisionV1 = z.infer<typeof WorkflowArtifactRevisionV1Schema>;

export const WorkflowDefinitionMetadataV1Schema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
}).strict();
export type WorkflowDefinitionMetadataV1 = z.infer<typeof WorkflowDefinitionMetadataV1Schema>;

export const WorkflowDefinitionArtifactHeaderV1Schema = z.object({
  kind: z.literal('workflow-definition.v1'),
  definitionId: WorkflowDefinitionIdV1Schema,
  revision: WorkflowArtifactRevisionV1Schema,
  metadata: WorkflowDefinitionMetadataV1Schema,
}).strict();
export type WorkflowDefinitionArtifactHeaderV1 = z.infer<typeof WorkflowDefinitionArtifactHeaderV1Schema>;

export const WorkflowDefinitionArtifactBodyV1Schema = z.object({
  kind: z.literal('workflow-definition.v1'),
  definition: WorkflowDefinitionV1Schema,
}).strict();
export type WorkflowDefinitionArtifactBodyV1 = z.infer<typeof WorkflowDefinitionArtifactBodyV1Schema>;

export const WorkflowResolvedInputsV1Schema = z.record(z.string(), StrictJsonValueSchema).superRefine(
  (inputs, context) => {
    for (const inputName of Object.keys(inputs)) {
      if (!WorkflowInputNameSchema.safeParse(inputName).success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [inputName],
          message: 'Invalid Workflow input name',
        });
      }
    }
  },
);
export type WorkflowResolvedInputsV1 = z.infer<typeof WorkflowResolvedInputsV1Schema>;

/**
 * Execution runtime selected once for the admitted Run. Definitions and
 * individual steps never carry this selector, and the accepted snapshot stores
 * no runtime identity beyond the selected kind.
 */
export const WorkflowRunExecutionTargetV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }).strict(),
  z.object({ kind: z.literal('attached_run') }).strict(),
  z.object({ kind: z.literal('detached_run') }).strict(),
]);
export type WorkflowRunExecutionTargetV1 = z.infer<typeof WorkflowRunExecutionTargetV1Schema>;

const WorkflowAcceptedSnapshotAutomationV1Schema = z.object({
  definition: WorkflowDefinitionV1Schema,
  /** Account-private display metadata frozen with the accepted program. */
  metadata: WorkflowDefinitionMetadataV1Schema.optional(),
  inputs: WorkflowResolvedInputsV1Schema,
  machineId: preservedBoundedNfcString(191, 'Machine ids'),
  executionTarget: WorkflowRunExecutionTargetV1Schema,
  workspaceTarget: WorkflowAcceptedWorkspaceTargetV1Schema,
  authorization: z.lazy((): typeof WorkflowAcceptedAuthorizationV1Schema => WorkflowAcceptedAuthorizationV1Schema),
  source: z.object({
    kind: z.literal('automation'),
    automationId: preservedBoundedNfcString(191, 'Automation ids'),
    definitionId: WorkflowDefinitionIdV1Schema.optional(),
    revision: WorkflowArtifactRevisionV1Schema.optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.workspaceTarget.project.machineId !== value.machineId) {
    context.addIssue({
      code: 'custom',
      path: ['workspaceTarget', 'project', 'machineId'],
      message: 'Project workspace must use the immutable Run Machine',
    });
  }
});

export const WorkflowAcceptedAuthorizationV1Schema = z.object({
  admittedPermissionCeiling: asProtocolZod(AgentPermissionIntentV1Schema),
  principal: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('host') }).strict(),
    z.object({
      kind: z.literal('plugin'),
      pluginId: preservedBoundedNfcString(191, 'Plugin ids'),
      contributionLocalId: preservedBoundedNfcString(191, 'Plugin contribution ids').optional(),
      immutableGenerationId: preservedBoundedNfcString(191, 'Plugin generation ids').optional(),
    }).strict(),
    z.object({
      kind: z.literal('api'),
      accountId: preservedBoundedNfcString(191, 'Account ids'),
      principalId: preservedBoundedNfcString(191, 'API principal ids'),
      credentialId: preservedBoundedNfcString(191, 'API credential ids'),
    }).strict(),
  ]),
  sourceAuthority: SessionInputSourceAuthorityV1Schema.optional(),
}).strict();
export type WorkflowAcceptedAuthorizationV1 = z.infer<typeof WorkflowAcceptedAuthorizationV1Schema>;

const WORKFLOW_PERMISSION_CEILING_BY_ORDINAL = [
  'read-only',
  'default',
  'safe-yolo',
  'yolo',
] as const;

/**
 * Derives the least privileged canonical ceiling that admits every effective
 * leaf in one normalized frozen Workflow program. Omission has the same
 * canonical `default` meaning used by Session and Execution Run admission.
 * Same-privilege aliases (`plan`, `acceptEdits`, `bypassPermissions`) collapse
 * to one stable admitted intent rather than making definition order authority.
 */
export function deriveWorkflowAcceptedPermissionCeilingV1(
  definition: WorkflowDefinitionV1,
): z.infer<typeof AgentPermissionIntentV1Schema> {
  const defaultOrdinal = resolvePermissionPrivilegeOrdinal(
    definition.defaults.permissionMode ?? 'default',
  );
  if (defaultOrdinal === null) {
    throw new TypeError('Workflow default permission mode is invalid');
  }
  let maximumOrdinal: number = defaultOrdinal;

  const visit = (blocks: readonly WorkflowBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === 'step') {
        const ordinal = resolvePermissionPrivilegeOrdinal(
          block.execution?.permissionMode
            ?? definition.defaults.permissionMode
            ?? 'default',
        );
        if (ordinal === null) throw new TypeError('Workflow step permission mode is invalid');
        maximumOrdinal = Math.max(maximumOrdinal, ordinal);
        continue;
      }
      if (block.kind === 'parallel') {
        for (const branch of block.branches) visit(branch.blocks);
        continue;
      }
      if (block.kind === 'if') {
        visit(block.then);
        visit(block.otherwise);
        continue;
      }
      visit(block.body);
      if (block.repetition.kind === 'evaluate') visit([block.repetition.evaluator]);
    }
  };
  visit(definition.blocks);
  return WORKFLOW_PERMISSION_CEILING_BY_ORDINAL[maximumOrdinal];
}

const WorkflowAcceptedDirectSourceV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline') }).strict(),
  z.object({
    kind: z.literal('saved'),
    definitionId: WorkflowDefinitionIdV1Schema,
    revision: WorkflowArtifactRevisionV1Schema,
  }).strict(),
]);

const WorkflowAcceptedSnapshotDirectV1Schema = z.object({
  definition: WorkflowDefinitionV1Schema,
  /** Optional only so current readers can open snapshots admitted before this field existed. */
  metadata: WorkflowDefinitionMetadataV1Schema.optional(),
  source: WorkflowAcceptedDirectSourceV1Schema,
  inputs: WorkflowResolvedInputsV1Schema,
  machineId: preservedBoundedNfcString(191, 'Machine ids'),
  executionTarget: WorkflowRunExecutionTargetV1Schema,
  workspaceTarget: WorkflowAcceptedWorkspaceTargetV1Schema,
  origin: z.object({
    kind: z.literal('direct'),
    originSessionId: preservedBoundedNfcString(191, 'Session ids').optional(),
  }).strict(),
  authorization: WorkflowAcceptedAuthorizationV1Schema,
  resultDelivery: z.object({
    kind: z.literal('originating_session'),
    originSessionId: preservedBoundedNfcString(191, 'Session ids'),
    localInputId: preservedBoundedNfcString(191, 'Session input local ids'),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (value.workspaceTarget.project.machineId !== value.machineId) {
    context.addIssue({
      code: 'custom',
      path: ['workspaceTarget', 'project', 'machineId'],
      message: 'Project workspace must use the immutable Run Machine',
    });
  }
  if (value.resultDelivery && value.origin.originSessionId !== value.resultDelivery.originSessionId) {
    context.addIssue({
      code: 'custom',
      path: ['resultDelivery', 'originSessionId'],
      message: 'Result delivery must target the frozen originating Session',
    });
  }
});

/** Immutable admitted program; Artifact edits and caller-turn lifetime cannot alter it. */
export const WorkflowAcceptedSnapshotV1Schema = z.union([
  WorkflowAcceptedSnapshotAutomationV1Schema,
  WorkflowAcceptedSnapshotDirectV1Schema,
]);
export type WorkflowAcceptedSnapshotV1 = z.infer<typeof WorkflowAcceptedSnapshotV1Schema>;
