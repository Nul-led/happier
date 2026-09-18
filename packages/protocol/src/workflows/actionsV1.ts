import { z } from 'zod';

import { OPAQUE_CURSOR_SCHEMA } from '../automations/automationActionSpecsV1.js';
import {
  WORKFLOW_ACTION_IDS_V1,
  type WorkflowActionIdV1,
} from '../actions/actionIds.js';
import { StrictJsonValueSchema } from '../json/strictJsonValue.js';
import { preservedBoundedNfcString } from '../strings/preservedBoundedNfcString.js';
import {
  WorkflowDefinitionArtifactHeaderV1Schema,
  WorkflowDefinitionMetadataV1Schema,
  WorkflowArtifactRevisionV1Schema,
  WorkflowRunExecutionTargetV1Schema,
} from './workflowDefinitionV1.js';
import { WorkflowAcceptedWorkspaceTargetV1Schema } from './workflowWorkspaceV1.js';
import {
  WorkflowDefinitionV1Schema,
  WorkflowIngressSchema,
  WORKFLOW_VALIDATION_ISSUE_CODES,
} from './workflowV1.js';
import {
  WorkflowCheckpointEnvelopeV1Schema,
  WorkflowInvocationDetailV1Schema,
  WorkflowInvocationLifecycleV1Schema,
  WorkflowInvocationRecordIdSchema,
  WorkflowInvocationRetryInputV1Schema,
  WorkflowMachineIdV1Schema,
  WorkflowResumeInputV1Schema,
  WorkflowRunIdV1Schema,
  WorkflowRunInvocationIndexV1Schema,
  WorkflowRunOriginV1Schema,
  WorkflowRunStateV1Schema,
  WorkflowRunSummaryV1Schema,
  WorkflowUsageV1Schema,
} from './workflowProgressV1.js';
import {
  WorkflowDefinitionIdV1Schema,
  WorkflowDirectRunAdmissionIdV1Schema,
} from './workflowIdsV1.js';
import { WorkflowInputNameSchema } from './workflowReferenceV1.js';

const CursorSchema = OPAQUE_CURSOR_SCHEMA;
const PositivePagePreferenceSchema = z.number().int().positive().safe();
const RevisionSchema = z.number().int().nonnegative().safe();
const WorkflowInputsV1Schema = z.record(z.string(), StrictJsonValueSchema).superRefine(
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

export const WorkflowValidationIssueV1Schema = z.object({
  code: z.enum(WORKFLOW_VALIDATION_ISSUE_CODES),
  path: z.string(), message: z.string(), blockId: z.string().optional(),
  severity: z.enum(['error', 'warning']),
}).strict();

export const WorkflowValidateRequestV1Schema = z.object({
  definition: WorkflowIngressSchema,
  inputs: WorkflowInputsV1Schema.optional(),
  target: z.object({ machineId: WorkflowMachineIdV1Schema }).strict().optional(),
}).strict();
export const WorkflowValidateResultV1Schema = z.object({
  valid: z.boolean(), normalizedDefinition: WorkflowDefinitionV1Schema.optional(),
  issues: z.array(WorkflowValidationIssueV1Schema),
  targetValidation: z.enum(['not_requested', 'checked', 'unavailable']),
}).strict();

export const WorkflowRunSourceV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline'), definition: WorkflowIngressSchema }).strict(),
  z.object({ kind: z.literal('saved'), definitionId: WorkflowDefinitionIdV1Schema, revision: WorkflowArtifactRevisionV1Schema }).strict(),
]);
export const WorkflowRunStartRequestV1Schema = z.object({
  runId: WorkflowDirectRunAdmissionIdV1Schema,
  source: WorkflowRunSourceV1Schema,
  /** Private display metadata for this exact admission; older callers may omit it. */
  metadata: WorkflowDefinitionMetadataV1Schema.optional(),
  inputs: WorkflowInputsV1Schema.optional(),
  executionTarget: WorkflowRunExecutionTargetV1Schema.optional(),
  onComplete: z.object({ kind: z.literal('originating_session') }).strict().optional(),
}).strict();
export const WorkflowRunStartResultV1Schema = z.object({
  run: WorkflowRunSummaryV1Schema,
  admission: z.enum(['created', 'existing']),
}).strict();
export const WorkflowRunActionResultReferenceV1Schema = z.object({
  runId: WorkflowRunIdV1Schema,
  origin: WorkflowRunOriginV1Schema,
}).strict();

const WorkflowRunStartActionSuccessEnvelopeV1Schema = z.object({
  ok: z.literal(true),
  result: WorkflowRunStartResultV1Schema,
}).strict();

export function parseWorkflowRunStartActionResultReferenceV1(
  value: unknown,
): WorkflowRunActionResultReferenceV1 | null {
  const enveloped = WorkflowRunStartActionSuccessEnvelopeV1Schema.safeParse(value);
  const startResult = enveloped.success
    ? enveloped.data.result
    : WorkflowRunStartResultV1Schema.safeParse(value).data;
  return startResult
    ? { runId: startResult.run.id, origin: startResult.run.origin }
    : null;
}

export const WorkflowRunAttentionFilterV1Schema = z.literal('required');
export const WorkflowRunListRequestV1Schema = z.object({
  cursor: CursorSchema.optional(), limit: PositivePagePreferenceSchema.optional(),
  origin: z.enum(['automation', 'direct']).optional(),
  states: z.array(WorkflowRunStateV1Schema).min(1).optional(),
  attention: WorkflowRunAttentionFilterV1Schema.optional(),
  originSessionId: preservedBoundedNfcString(191, 'Session ids').optional(),
  automationId: preservedBoundedNfcString(191, 'Automation ids').optional(),
  machineId: WorkflowMachineIdV1Schema.optional(),
}).strict();
export const WorkflowRunPrivateMetadataV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), value: WorkflowDefinitionMetadataV1Schema }).strict(),
  z.object({ kind: z.literal('unavailable') }).strict(),
]);
export type WorkflowRunPrivateMetadataV1 = z.infer<typeof WorkflowRunPrivateMetadataV1Schema>;
export const WorkflowRunListResultV1Schema = z.object({
  runs: z.array(WorkflowRunSummaryV1Schema),
  /** Account-private metadata opened from the accepted snapshots for this page. */
  metadataByRunId: z.record(z.string(), WorkflowRunPrivateMetadataV1Schema).optional(),
  nextCursor: CursorSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.metadataByRunId === undefined) return;
  const pageRunIds = new Set(value.runs.map((run) => run.id));
  for (const runId of Object.keys(value.metadataByRunId)) {
    if (!pageRunIds.has(runId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadataByRunId', runId],
        message: 'Workflow Run metadata must belong to a Run in the same page',
      });
    }
  }
});
export const WorkflowRunGetRequestV1Schema = z.object({ runId: WorkflowRunIdV1Schema }).strict();
export const WorkflowRunAcceptedContextV1Schema = z.union([
  z.object({
    source: z.object({
      kind: z.literal('automation'),
      automationId: preservedBoundedNfcString(191, 'Automation ids'),
      definitionId: WorkflowDefinitionIdV1Schema.optional(),
      revision: WorkflowArtifactRevisionV1Schema.optional(),
    }).strict(),
    metadata: WorkflowDefinitionMetadataV1Schema.optional(),
    inputs: WorkflowInputsV1Schema,
    machineId: WorkflowMachineIdV1Schema,
    executionTarget: WorkflowRunExecutionTargetV1Schema,
    workspaceTarget: WorkflowAcceptedWorkspaceTargetV1Schema,
  }).strict(),
  z.object({
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('inline') }).strict(),
      z.object({ kind: z.literal('saved'), definitionId: WorkflowDefinitionIdV1Schema, revision: WorkflowArtifactRevisionV1Schema }).strict(),
    ]),
    metadata: WorkflowDefinitionMetadataV1Schema.optional(),
    inputs: WorkflowInputsV1Schema,
    machineId: WorkflowMachineIdV1Schema,
    executionTarget: WorkflowRunExecutionTargetV1Schema,
    workspaceTarget: WorkflowAcceptedWorkspaceTargetV1Schema,
    origin: z.object({
      kind: z.literal('direct'),
      originSessionId: preservedBoundedNfcString(191, 'Session ids').optional(),
    }).strict(),
  }).strict(),
]).superRefine((value, context) => {
  if (value.workspaceTarget.project.machineId !== value.machineId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workspaceTarget', 'project', 'machineId'],
      message: 'Project workspace must use the immutable Run Machine',
    });
  }
});
export type WorkflowRunAcceptedContextV1 = z.infer<typeof WorkflowRunAcceptedContextV1Schema>;
export const WorkflowRunGetResultV1Schema = z.object({
  run: WorkflowRunSummaryV1Schema,
  definition: WorkflowDefinitionV1Schema,
  acceptedContext: WorkflowRunAcceptedContextV1Schema,
  checkpoint: WorkflowCheckpointEnvelopeV1Schema.nullable(),
  result: StrictJsonValueSchema.optional(), usage: WorkflowUsageV1Schema.optional(),
  /** Authenticated exact producer record of `result`; neither field exists without the other. */
  finalOutputInvocationId: WorkflowInvocationRecordIdSchema.optional(),
  availability: WorkflowRunSummaryV1Schema.shape.availability,
}).strict().superRefine((value, context) => {
  const hasResult = value.result !== undefined;
  const hasProducer = value.finalOutputInvocationId !== undefined;
  if (hasResult === hasProducer) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path: [hasResult ? 'finalOutputInvocationId' : 'result'],
    message: hasResult
      ? 'Workflow Run result requires its exact producer invocation'
      : 'Workflow Run producer invocation requires a result',
  });
});
export const WorkflowRunWaitRequestV1Schema = z.object({ runId: WorkflowRunIdV1Schema, timeoutSeconds: z.number().positive().safe().optional() }).strict();
export const WorkflowRunWaitResultV1Schema = z.object({
  observation: z.enum(['terminal', 'paused', 'needs_attention', 'timeout']),
  run: WorkflowRunSummaryV1Schema, result: StrictJsonValueSchema.optional(),
}).strict();
export const WorkflowRunPauseRequestV1Schema = z.object({ runId: WorkflowRunIdV1Schema, expectedRevision: RevisionSchema }).strict();
export const WorkflowRunCancelRequestV1Schema = WorkflowRunPauseRequestV1Schema;
export const WorkflowRunControlResultV1Schema = z.object({
  run: WorkflowRunSummaryV1Schema,
  intent: z.enum(['pause_requested', 'paused', 'resumed', 'recovery_required', 'unavailable', 'cancel_requested', 'cancelled']),
}).strict();

export const WorkflowInvocationListRequestV1Schema = z.object({
  runId: WorkflowRunIdV1Schema, cursor: CursorSchema.optional(), limit: PositivePagePreferenceSchema.optional(),
  parentRecordId: WorkflowInvocationRecordIdSchema.optional(),
  lifecycles: z.array(WorkflowInvocationLifecycleV1Schema).min(1).optional(),
}).strict();
export const WorkflowInvocationListResultV1Schema = z.object({
  invocations: z.array(WorkflowRunInvocationIndexV1Schema), nextCursor: CursorSchema.optional(), parentRevision: RevisionSchema,
}).strict();
export const WorkflowInvocationGetRequestV1Schema = z.object({ runId: WorkflowRunIdV1Schema, invocationId: WorkflowInvocationRecordIdSchema }).strict();
export const WorkflowInvocationGetResultV1Schema = z.object({ invocation: WorkflowInvocationDetailV1Schema }).strict();
export const WorkflowInvocationRetryResultV1Schema = z.object({
  run: WorkflowRunSummaryV1Schema, invocation: WorkflowRunInvocationIndexV1Schema,
  disposition: z.enum(['accepted', 'ineligible', 'conflict']),
}).strict();
export const WorkflowRunDeleteRequestV1Schema = WorkflowRunPauseRequestV1Schema;
export const WorkflowRunDeleteResultV1Schema = z.object({ deleted: z.literal(true), runId: WorkflowRunIdV1Schema }).strict();

export const WorkflowDefinitionListRequestV1Schema = z.object({ cursor: CursorSchema.optional(), limit: PositivePagePreferenceSchema.optional() }).strict();
export const WorkflowDefinitionListResultV1Schema = z.object({ definitions: z.array(WorkflowDefinitionArtifactHeaderV1Schema), nextCursor: CursorSchema.optional() }).strict();
export const WorkflowDefinitionGetRequestV1Schema = z.object({ definitionId: WorkflowDefinitionIdV1Schema }).strict();
export const WorkflowDefinitionGetResultV1Schema = z.object({ definitionId: WorkflowDefinitionIdV1Schema, revision: WorkflowArtifactRevisionV1Schema, definition: WorkflowDefinitionV1Schema, metadata: WorkflowDefinitionMetadataV1Schema }).strict();
export const WorkflowDefinitionCreateRequestV1Schema = z.object({ definitionId: WorkflowDefinitionIdV1Schema, definition: WorkflowIngressSchema, metadata: WorkflowDefinitionMetadataV1Schema }).strict();
export const WorkflowDefinitionCreateResultV1Schema = WorkflowDefinitionGetResultV1Schema;
export const WorkflowDefinitionUpdateRequestV1Schema = z.object({ definitionId: WorkflowDefinitionIdV1Schema, expectedRevision: WorkflowArtifactRevisionV1Schema, definition: WorkflowIngressSchema, metadata: WorkflowDefinitionMetadataV1Schema }).strict();
export const WorkflowDefinitionUpdateResultV1Schema = WorkflowDefinitionGetResultV1Schema;
export const WorkflowDefinitionDeleteRequestV1Schema = z.object({ definitionId: WorkflowDefinitionIdV1Schema }).strict();
export const WorkflowDefinitionDeleteResultV1Schema = z.object({ deleted: z.literal(true), definitionId: WorkflowDefinitionIdV1Schema }).strict();

export { WORKFLOW_ACTION_IDS_V1, type WorkflowActionIdV1 };

export const WorkflowActionInputSchemasV1 = {
  'workflow.validate': WorkflowValidateRequestV1Schema,
  'workflow.run.start': WorkflowRunStartRequestV1Schema,
  'workflow.run.list': WorkflowRunListRequestV1Schema,
  'workflow.run.get': WorkflowRunGetRequestV1Schema,
  'workflow.run.wait': WorkflowRunWaitRequestV1Schema,
  'workflow.run.pause': WorkflowRunPauseRequestV1Schema,
  'workflow.run.resume': WorkflowResumeInputV1Schema,
  'workflow.run.cancel': WorkflowRunCancelRequestV1Schema,
  'workflow.run.invocations.list': WorkflowInvocationListRequestV1Schema,
  'workflow.run.invocations.get': WorkflowInvocationGetRequestV1Schema,
  'workflow.run.invocations.retry': WorkflowInvocationRetryInputV1Schema,
  'workflow.run.delete': WorkflowRunDeleteRequestV1Schema,
  'workflow.definition.list': WorkflowDefinitionListRequestV1Schema,
  'workflow.definition.get': WorkflowDefinitionGetRequestV1Schema,
  'workflow.definition.create': WorkflowDefinitionCreateRequestV1Schema,
  'workflow.definition.update': WorkflowDefinitionUpdateRequestV1Schema,
  'workflow.definition.delete': WorkflowDefinitionDeleteRequestV1Schema,
} as const satisfies Record<WorkflowActionIdV1, z.ZodTypeAny>;

export const WorkflowActionOutputSchemasV1 = {
  'workflow.validate': WorkflowValidateResultV1Schema,
  'workflow.run.start': WorkflowRunStartResultV1Schema,
  'workflow.run.list': WorkflowRunListResultV1Schema,
  'workflow.run.get': WorkflowRunGetResultV1Schema,
  'workflow.run.wait': WorkflowRunWaitResultV1Schema,
  'workflow.run.pause': WorkflowRunControlResultV1Schema,
  'workflow.run.resume': WorkflowRunControlResultV1Schema,
  'workflow.run.cancel': WorkflowRunControlResultV1Schema,
  'workflow.run.invocations.list': WorkflowInvocationListResultV1Schema,
  'workflow.run.invocations.get': WorkflowInvocationGetResultV1Schema,
  'workflow.run.invocations.retry': WorkflowInvocationRetryResultV1Schema,
  'workflow.run.delete': WorkflowRunDeleteResultV1Schema,
  'workflow.definition.list': WorkflowDefinitionListResultV1Schema,
  'workflow.definition.get': WorkflowDefinitionGetResultV1Schema,
  'workflow.definition.create': WorkflowDefinitionCreateResultV1Schema,
  'workflow.definition.update': WorkflowDefinitionUpdateResultV1Schema,
  'workflow.definition.delete': WorkflowDefinitionDeleteResultV1Schema,
} as const satisfies Record<WorkflowActionIdV1, z.ZodTypeAny>;

export type WorkflowValidateRequestV1 = z.infer<typeof WorkflowValidateRequestV1Schema>;
export type WorkflowValidateResultV1 = z.infer<typeof WorkflowValidateResultV1Schema>;
export type WorkflowRunStartRequestV1 = z.infer<typeof WorkflowRunStartRequestV1Schema>;
export type WorkflowRunStartResultV1 = z.infer<typeof WorkflowRunStartResultV1Schema>;
export type WorkflowRunActionResultReferenceV1 = z.infer<typeof WorkflowRunActionResultReferenceV1Schema>;
export type WorkflowRunListRequestV1 = z.infer<typeof WorkflowRunListRequestV1Schema>;
export type WorkflowRunListResultV1 = z.infer<typeof WorkflowRunListResultV1Schema>;
export type WorkflowRunGetRequestV1 = z.infer<typeof WorkflowRunGetRequestV1Schema>;
export type WorkflowRunGetResultV1 = z.infer<typeof WorkflowRunGetResultV1Schema>;
export type WorkflowRunWaitRequestV1 = z.infer<typeof WorkflowRunWaitRequestV1Schema>;
export type WorkflowRunWaitResultV1 = z.infer<typeof WorkflowRunWaitResultV1Schema>;
export type WorkflowRunPauseRequestV1 = z.infer<typeof WorkflowRunPauseRequestV1Schema>;
export type WorkflowRunCancelRequestV1 = z.infer<typeof WorkflowRunCancelRequestV1Schema>;
export type WorkflowRunControlResultV1 = z.infer<typeof WorkflowRunControlResultV1Schema>;
export type WorkflowInvocationListRequestV1 = z.infer<typeof WorkflowInvocationListRequestV1Schema>;
export type WorkflowInvocationListResultV1 = z.infer<typeof WorkflowInvocationListResultV1Schema>;
export type WorkflowInvocationGetRequestV1 = z.infer<typeof WorkflowInvocationGetRequestV1Schema>;
export type WorkflowInvocationGetResultV1 = z.infer<typeof WorkflowInvocationGetResultV1Schema>;
export type WorkflowInvocationRetryResultV1 = z.infer<typeof WorkflowInvocationRetryResultV1Schema>;
export type WorkflowRunDeleteRequestV1 = z.infer<typeof WorkflowRunDeleteRequestV1Schema>;
export type WorkflowRunDeleteResultV1 = z.infer<typeof WorkflowRunDeleteResultV1Schema>;
export type WorkflowDefinitionListRequestV1 = z.infer<typeof WorkflowDefinitionListRequestV1Schema>;
export type WorkflowDefinitionListResultV1 = z.infer<typeof WorkflowDefinitionListResultV1Schema>;
export type WorkflowDefinitionGetRequestV1 = z.infer<typeof WorkflowDefinitionGetRequestV1Schema>;
export type WorkflowDefinitionGetResultV1 = z.infer<typeof WorkflowDefinitionGetResultV1Schema>;
export type WorkflowDefinitionCreateRequestV1 = z.infer<typeof WorkflowDefinitionCreateRequestV1Schema>;
export type WorkflowDefinitionCreateResultV1 = z.infer<typeof WorkflowDefinitionCreateResultV1Schema>;
export type WorkflowDefinitionUpdateRequestV1 = z.infer<typeof WorkflowDefinitionUpdateRequestV1Schema>;
export type WorkflowDefinitionUpdateResultV1 = z.infer<typeof WorkflowDefinitionUpdateResultV1Schema>;
export type WorkflowDefinitionDeleteRequestV1 = z.infer<typeof WorkflowDefinitionDeleteRequestV1Schema>;
export type WorkflowDefinitionDeleteResultV1 = z.infer<typeof WorkflowDefinitionDeleteResultV1Schema>;
