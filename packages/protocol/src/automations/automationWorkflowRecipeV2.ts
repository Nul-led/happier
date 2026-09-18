import { z } from 'zod';

import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import {
  WorkflowArtifactRevisionV1Schema,
  WorkflowDefinitionMetadataV1Schema,
} from '../workflows/workflowDefinitionV1.js';
import { WorkflowDefinitionIdV1Schema } from '../workflows/workflowIdsV1.js';
import { WorkflowDefinitionV1Schema } from '../workflows/workflowV1.js';
import { WorkflowProjectTargetV1Schema } from '../workflows/workflowWorkspaceV1.js';
import {
  addAutomationStoredEnvelopeUtf8LimitIssue,
  AutomationStoredContentEnvelopeV1Schema,
  MAX_AUTOMATION_STORED_ENVELOPE_UTF8_BYTES,
} from './automationStoredContentEnvelopeV1.js';

const UTF8_ENCODER = new TextEncoder();

export const AutomationStoredWorkflowDefinitionV2Schema = z.object({
  definition: WorkflowDefinitionV1Schema,
  metadata: WorkflowDefinitionMetadataV1Schema.optional(),
  /** Automation-bound target; the reusable Workflow definition stays portable. */
  project: WorkflowProjectTargetV1Schema,
  source: z.object({
    definitionId: WorkflowDefinitionIdV1Schema,
    revision: WorkflowArtifactRevisionV1Schema,
  }).strict().optional(),
}).strict();

/**
 * The explicit next Automation definition recipe epoch for managed workflows.
 *
 * `v: 1` remains the released one-shot recipe. This epoch has no synthetic
 * one-shot target: the reusable definition remains portable while the
 * Automation-bound project target is stored beside it. Occurrence evidence
 * and resolved machine-local workspace facts are frozen at Run admission.
 */
export const AutomationStoredWorkflowDefinitionRecipeV2Schema = z.object({
  v: z.literal(2),
  templateVersion: z.number().int().nonnegative().safe(),
  workflow: AutomationStoredContentEnvelopeV1Schema,
  triggerEvidence: z.null(),
}).strict().superRefine((value, context) => {
  addAutomationStoredEnvelopeUtf8LimitIssue(
    value,
    context,
    'Automation workflow definition recipe exceeds its UTF-8 byte limit',
  );
  if (
    value.workflow.t === 'plain'
    && !AutomationStoredWorkflowDefinitionV2Schema.safeParse(value.workflow.v).success
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflow'],
      message: 'Automation workflow definition is invalid',
    });
  }
});
export type AutomationStoredWorkflowDefinitionRecipeV2 = z.infer<
  typeof AutomationStoredWorkflowDefinitionRecipeV2Schema
>;

export type AutomationStoredWorkflowDefinitionRecipeV2Result =
  | Readonly<{
    kind: 'available';
    recipe: AutomationStoredWorkflowDefinitionRecipeV2;
    serialized: string;
  }>
  | Readonly<{ kind: 'contentInvalid' }>;

export function parseAutomationStoredWorkflowDefinitionRecipeV2(
  serialized: unknown,
): AutomationStoredWorkflowDefinitionRecipeV2Result {
  if (
    typeof serialized !== 'string'
    || UTF8_ENCODER.encode(serialized).byteLength > MAX_AUTOMATION_STORED_ENVELOPE_UTF8_BYTES
  ) return { kind: 'contentInvalid' };
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return { kind: 'contentInvalid' };
  }
  const parsed = AutomationStoredWorkflowDefinitionRecipeV2Schema.safeParse(value);
  return parsed.success
    ? { kind: 'available', recipe: parsed.data, serialized }
    : { kind: 'contentInvalid' };
}

export function serializeAutomationStoredWorkflowDefinitionRecipeV2(
  recipe: unknown,
): AutomationStoredWorkflowDefinitionRecipeV2Result {
  const parsed = AutomationStoredWorkflowDefinitionRecipeV2Schema.safeParse(recipe);
  if (!parsed.success) return { kind: 'contentInvalid' };
  const serialized = createCanonicalJsonSigningInput(parsed.data);
  return UTF8_ENCODER.encode(serialized).byteLength > MAX_AUTOMATION_STORED_ENVELOPE_UTF8_BYTES
    ? { kind: 'contentInvalid' }
    : { kind: 'available', recipe: parsed.data, serialized };
}
