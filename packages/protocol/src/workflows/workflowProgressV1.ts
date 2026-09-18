import { z } from 'zod';

import { createCanonicalJsonSigningInput } from '../crypto/canonicalJson.js';
import { StrictJsonValueSchema } from '../json/strictJsonValue.js';
import { AutomationRunStateV3Schema } from '../automations/automationRunStateV3.js';
import { ExecutionRunResumeHandleProviderSessionV1Schema } from '../execution/runs/startRequest.js';
import { preservedBoundedNfcString } from '../strings/preservedBoundedNfcString.js';
import {
  WorkflowDefinitionIdV1Schema,
  WorkflowInvocationRecordIdSchema,
  WorkflowMachineIdV1Schema,
  WorkflowRunIdV1Schema,
} from './workflowIdsV1.js';
import {
  WorkflowAuthoredResultReferenceSchema,
  WorkflowBlockIdSchema,
  WorkflowInputNameSchema,
  WorkflowResultPathSchema,
} from './workflowReferenceV1.js';
import { WorkflowStepComposerDocumentSchema } from './workflowComposerDocumentV1.js';
import {
  WorkflowSessionAuthoringSelectionSchema,
  type WorkflowSessionAuthoringSelection,
  type WorkflowStepExecutionSelection,
} from './workflowV1.js';
import { WorkflowWorkspaceProgressV1Schema } from './workflowWorkspaceV1.js';

export {
  WorkflowDefinitionIdV1Schema,
  WorkflowInvocationRecordIdSchema,
  WorkflowMachineIdV1Schema,
  WorkflowRunIdV1Schema,
} from './workflowIdsV1.js';
export const WorkflowDecimalV1Schema = z.string().regex(/^(0|[1-9][0-9]*)$/, 'Expected a canonical nonnegative decimal string');
export type WorkflowDecimalV1 = z.infer<typeof WorkflowDecimalV1Schema>;

export function projectWorkflowBigIntV1(value: bigint): WorkflowDecimalV1 {
  if (value < 0n) throw new TypeError('Workflow counters must be nonnegative');
  return WorkflowDecimalV1Schema.parse(value.toString(10));
}

export const WORKFLOW_INVOCATION_LIFECYCLES_V1 = [
  'pending', 'waiting_for_capacity', 'admitting', 'running', 'waiting_for_approval',
  'needs_attention', 'completed', 'failed', 'skipped', 'cancel_requested',
  'cancelled', 'outcome_uncertain', 'superseded',
] as const;
export const WorkflowInvocationLifecycleV1Schema = z.enum(WORKFLOW_INVOCATION_LIFECYCLES_V1);
export type WorkflowInvocationLifecycleV1 = z.infer<typeof WorkflowInvocationLifecycleV1Schema>;

export const WORKFLOW_RUN_STATES_V1 = [
  ...AutomationRunStateV3Schema.options,
  'pause_requested', 'paused', 'interrupted',
] as const;
export const WorkflowRunStateV1Schema = z.enum(WORKFLOW_RUN_STATES_V1);
export type WorkflowRunStateV1 = z.infer<typeof WorkflowRunStateV1Schema>;

export const WorkflowControlV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('running') }).strict(),
  z.object({ kind: z.literal('pause_requested') }).strict(),
  z.object({ kind: z.literal('paused'), reason: z.literal('boundary') }).strict(),
  z.object({
    kind: z.literal('interrupted'),
    reason: z.enum(['invocation_failed', 'runtime_interrupted', 'outcome_uncertain']),
  }).strict(),
  z.object({ kind: z.literal('terminal') }).strict(),
]);
export type WorkflowControlV1 = z.infer<typeof WorkflowControlV1Schema>;

export const WorkflowRunAutomationOriginV1Schema = z.object({
  kind: z.literal('automation'),
  automationId: preservedBoundedNfcString(191, 'Automation ids'),
}).strict();
export const WorkflowRunDirectOriginV1Schema = z.object({
  kind: z.literal('direct'),
  originSessionId: preservedBoundedNfcString(191, 'Session ids').optional(),
}).strict();
export const WorkflowRunOriginV1Schema = z.discriminatedUnion('kind', [
  WorkflowRunAutomationOriginV1Schema,
  WorkflowRunDirectOriginV1Schema,
]);
export type WorkflowRunOriginV1 = z.infer<typeof WorkflowRunOriginV1Schema>;

export const WorkflowRunCustodyStateV1Schema = z.enum(['pending', 'settled']);
export type WorkflowRunCustodyStateV1 = z.infer<typeof WorkflowRunCustodyStateV1Schema>;

const WorkflowResultDeliveryUnavailableStateV1Schema = z.object({
  kind: z.literal('unavailable'),
  reason: z.literal('workflow_outcome_unresolved').optional(),
}).strict();

export const WorkflowResultDeliveryStateV1Schema = z.union([
  z.literal('pending'),
  z.literal('accepted'),
  WorkflowResultDeliveryUnavailableStateV1Schema,
]);
export type WorkflowResultDeliveryStateV1 = z.infer<typeof WorkflowResultDeliveryStateV1Schema>;

export function isWorkflowResultDeliveryUnavailableV1(
  state: WorkflowResultDeliveryStateV1 | null,
): state is z.infer<typeof WorkflowResultDeliveryUnavailableStateV1Schema> {
  return typeof state === 'object' && state?.kind === 'unavailable';
}

export const WorkflowRunAvailabilityV1Schema = z.object({
  pause: z.boolean(),
  resumeBoundary: z.boolean(),
  recoverSameConversation: z.boolean(),
  recoverFreshAgent: z.boolean(),
  retry: z.boolean(),
  restoreWorkspace: z.boolean(),
  cancel: z.boolean(),
  inspectExecution: z.boolean(),
  disabledReasons: z.array(z.object({ operation: z.enum([
    'pause', 'resume_boundary', 'recover_same_conversation', 'recover_fresh_agent',
    'retry', 'restore_workspace', 'cancel', 'inspect_execution',
  ]), code: z.string().min(1) }).strict()),
}).strict();
export type WorkflowRunAvailabilityV1 = z.infer<typeof WorkflowRunAvailabilityV1Schema>;

export const WorkflowRunSummaryV1Schema = z.object({
  id: WorkflowRunIdV1Schema,
  origin: WorkflowRunOriginV1Schema,
  state: WorkflowRunStateV1Schema,
  revision: z.number().int().nonnegative().safe(),
  machineId: WorkflowMachineIdV1Schema,
  workflowCustodyState: WorkflowRunCustodyStateV1Schema.nullable(),
  workflowResultDeliveryState: WorkflowResultDeliveryStateV1Schema.nullable(),
  availability: WorkflowRunAvailabilityV1Schema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type WorkflowRunSummaryV1 = z.infer<typeof WorkflowRunSummaryV1Schema>;

/** Public-index-only parent witness used by the exact-machine recovery reader. */
export const WorkflowRunRecoveryCandidateV1Schema = z.object({
  run: WorkflowRunSummaryV1Schema,
  parentAttempt: z.number().int().nonnegative().safe(),
}).strict();
export type WorkflowRunRecoveryCandidateV1 = z.infer<typeof WorkflowRunRecoveryCandidateV1Schema>;

export const WorkflowRunInvocationIndexV1Schema = z.object({
  id: WorkflowInvocationRecordIdSchema,
  runId: WorkflowRunIdV1Schema,
  sequence: WorkflowDecimalV1Schema,
  parentRecordId: WorkflowInvocationRecordIdSchema.nullable(),
  memberOrdinal: WorkflowDecimalV1Schema,
  attempt: WorkflowDecimalV1Schema,
  lifecycle: WorkflowInvocationLifecycleV1Schema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type WorkflowRunInvocationIndexV1 = z.infer<typeof WorkflowRunInvocationIndexV1Schema>;

export const WorkflowInvocationPathV1Schema = z.object({
  blockId: z.union([WorkflowBlockIdSchema, z.literal('$root')]),
  scope: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('branch'), blockId: WorkflowBlockIdSchema, branchId: WorkflowBlockIdSchema }).strict(),
    z.object({ kind: z.literal('iteration'), blockId: WorkflowBlockIdSchema, index: z.number().int().nonnegative().safe() }).strict(),
  ])),
}).strict();
export type WorkflowInvocationPathV1 = z.infer<typeof WorkflowInvocationPathV1Schema>;

const WorkflowExecutionCorrespondenceBaseV1Schema = z.object({
  localInputId: preservedBoundedNfcString(191, 'Execution input local ids'),
  turnId: preservedBoundedNfcString(191, 'Turn ids').optional(),
});

/**
 * Secret-free immutable runtime selection retained with a Workflow conversation.
 *
 * This deliberately reuses the portable Session-authoring selection owner. Its
 * schema excludes workspace/conversation identity and raw environment or
 * credential material, while preserving exact Agent/model/profile/permission,
 * config, MCP and Connected Service intent. The workflow execution adapter
 * supplies the effective selection that it actually admitted.
 */
export const WorkflowRetainedRuntimeSelectionV1Schema = WorkflowSessionAuthoringSelectionSchema;
export type WorkflowRetainedRuntimeSelectionV1 = WorkflowSessionAuthoringSelection;

export function projectWorkflowRetainedRuntimeSelectionV1(
  selection: WorkflowStepExecutionSelection,
): WorkflowRetainedRuntimeSelectionV1 {
  const { conversation: _conversation, workspace: _workspace, ...runtimeSelection } = selection;
  return WorkflowRetainedRuntimeSelectionV1Schema.parse(runtimeSelection);
}

/**
 * Exact, key-order-independent equality for retained conversation reuse.
 * Invalid or legacy-missing witnesses fail closed instead of being interpreted
 * as a compatible default selection.
 */
export function areWorkflowRetainedRuntimeSelectionsEqualV1(
  retained: unknown,
  requested: unknown,
): boolean {
  const retainedSelection = WorkflowRetainedRuntimeSelectionV1Schema.safeParse(retained);
  const requestedSelection = WorkflowRetainedRuntimeSelectionV1Schema.safeParse(requested);
  if (!retainedSelection.success || !requestedSelection.success) return false;
  try {
    return createCanonicalJsonSigningInput(retainedSelection.data)
      === createCanonicalJsonSigningInput(requestedSelection.data);
  } catch {
    // Optional object members may be explicitly present as `undefined` in
    // process-local callers even though that is not strict JSON. Such a witness
    // cannot prove retained runtime compatibility.
    return false;
  }
}

export const WorkflowExecutionCorrespondenceV1Schema = z.discriminatedUnion('kind', [
  WorkflowExecutionCorrespondenceBaseV1Schema.extend({
    kind: z.literal('session'),
    sessionId: preservedBoundedNfcString(191, 'Session ids'),
  }).strict(),
  WorkflowExecutionCorrespondenceBaseV1Schema.extend({
    kind: z.literal('attached_run'),
    sessionId: preservedBoundedNfcString(191, 'Session ids'),
    runId: preservedBoundedNfcString(191, 'Execution Run ids'),
  }).strict(),
  WorkflowExecutionCorrespondenceBaseV1Schema.extend({
    kind: z.literal('detached_run'),
    runId: preservedBoundedNfcString(191, 'Execution Run ids'),
    runtimeSelection: WorkflowRetainedRuntimeSelectionV1Schema,
    /**
     * First provider-owned resumable identity validated by the Execution Run
     * host for this exact detached invocation. This private correspondence is
     * the durable owner; public Run projections and activity markers are not
     * restart authority.
     */
    providerResumeIdentity: ExecutionRunResumeHandleProviderSessionV1Schema.optional(),
  }).strict(),
]);
export type WorkflowExecutionCorrespondenceV1 = z.infer<typeof WorkflowExecutionCorrespondenceV1Schema>;

export const WorkflowInvocationFrameV1Schema = z.object({
  ownerBlockId: WorkflowBlockIdSchema,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('branch'), branchId: WorkflowBlockIdSchema }).strict(),
    z.object({ kind: z.literal('item'), index: WorkflowDecimalV1Schema }).strict(),
    z.object({ kind: z.literal('iteration'), index: WorkflowDecimalV1Schema }).strict(),
  ]),
}).strict();
export type WorkflowInvocationFrameV1 = z.infer<typeof WorkflowInvocationFrameV1Schema>;

export const WorkflowContainerClosingV1Schema = z.object({
  code: preservedBoundedNfcString(191, 'Workflow container closing codes'),
  causeInvocationRecordId: WorkflowInvocationRecordIdSchema.optional(),
}).strict();
export type WorkflowContainerClosingV1 = z.infer<typeof WorkflowContainerClosingV1Schema>;

export const WorkflowLoopSourceSelectionV1Schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('definition'),
    reference: z.union([
      z.object({ kind: z.literal('literal'), value: StrictJsonValueSchema }).strict(),
      z.object({ kind: z.literal('input'), name: WorkflowInputNameSchema }).strict(),
    ]),
  }).strict(),
  z.object({
    kind: z.literal('result'),
    recordId: WorkflowInvocationRecordIdSchema,
    path: WorkflowResultPathSchema,
  }).strict(),
]);
export type WorkflowLoopSourceSelectionV1 = z.infer<typeof WorkflowLoopSourceSelectionV1Schema>;

const WorkflowContainerBodyProgressV1Schema = z.object({
  kind: z.literal('body'),
  nextBlockOrdinal: WorkflowDecimalV1Schema,
  closing: WorkflowContainerClosingV1Schema.optional(),
}).strict();
const WorkflowContainerParallelProgressV1Schema = z.object({
  kind: z.literal('parallel'),
  nextBranchOrdinal: WorkflowDecimalV1Schema,
  closing: WorkflowContainerClosingV1Schema.optional(),
}).strict();
const WorkflowContainerIfProgressV1Schema = z.object({
  kind: z.literal('if'),
  selected: z.enum(['then', 'otherwise']),
  nextBlockOrdinal: WorkflowDecimalV1Schema,
  closing: WorkflowContainerClosingV1Schema.optional(),
}).strict();
const WorkflowContainerLoopBaseV1Schema = z.object({
  kind: z.literal('loop'),
  nextMemberIndex: WorkflowDecimalV1Schema,
  nextBodyBlockOrdinal: WorkflowDecimalV1Schema,
  closing: WorkflowContainerClosingV1Schema.optional(),
});
export const WorkflowContainerProgressV1Schema = z.union([
  WorkflowContainerBodyProgressV1Schema,
  WorkflowContainerParallelProgressV1Schema,
  WorkflowContainerIfProgressV1Schema,
  WorkflowContainerLoopBaseV1Schema.extend({
    mode: z.literal('count'),
    source: WorkflowLoopSourceSelectionV1Schema,
    count: WorkflowDecimalV1Schema,
  }).strict(),
  WorkflowContainerLoopBaseV1Schema.extend({
    mode: z.literal('items'),
    source: WorkflowLoopSourceSelectionV1Schema,
    itemCount: WorkflowDecimalV1Schema,
  }).strict(),
  WorkflowContainerLoopBaseV1Schema.extend({ mode: z.literal('until') }).strict(),
  WorkflowContainerLoopBaseV1Schema.extend({ mode: z.literal('evaluate') }).strict(),
]);
export type WorkflowContainerProgressV1 = z.infer<typeof WorkflowContainerProgressV1Schema>;

export const WorkflowContainerResultSelectorV1Schema = z.object({
  kind: z.literal('container'),
  containerRecordId: WorkflowInvocationRecordIdSchema,
}).strict();
export type WorkflowContainerResultSelectorV1 = z.infer<typeof WorkflowContainerResultSelectorV1Schema>;

export const WorkflowInvocationRecoveryV1Schema = z.object({
  conversation: z.enum(['same_conversation', 'fresh_agent']),
  input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('original') }).strict(),
    z.object({
      kind: z.literal('replacement'),
      value: z.object({
        document: WorkflowStepComposerDocumentSchema,
        input: z.array(StrictJsonValueSchema).default([]),
      }).strict(),
    }).strict(),
  ]),
  acknowledgeUncertainPriorEffects: z.literal(true).optional(),
}).strict();
export type WorkflowInvocationRecoveryV1 = z.infer<typeof WorkflowInvocationRecoveryV1Schema>;

/**
 * Exact provider-reported usage attributable to one Workflow leaf invocation.
 * Missing members mean the execution owner did not report that dimension.
 */
export const WorkflowUsageV1Schema = z.object({
  inputTokens: z.number().int().safe().nonnegative().optional(),
  outputTokens: z.number().int().safe().nonnegative().optional(),
  costUsd: z.number().finite().nonnegative().optional(),
}).strict();
export type WorkflowUsageV1 = z.infer<typeof WorkflowUsageV1Schema>;

export const WorkflowProgressEnvelopeV1Schema = z.object({
  kind: z.literal('happier.workflow-progress.v1'),
  invocationPath: WorkflowInvocationPathV1Schema,
  frame: WorkflowInvocationFrameV1Schema.optional(),
  blockKind: z.enum(['root', 'step', 'parallel', 'loop', 'if']),
  container: WorkflowContainerProgressV1Schema.optional(),
  attempt: WorkflowDecimalV1Schema,
  input: StrictJsonValueSchema.optional(),
  result: StrictJsonValueSchema.optional(),
  usage: WorkflowUsageV1Schema.optional(),
  /**
   * Private request-state projection for this exact invocation. The incumbent
   * permission owner writes this independently from the selected step result;
   * it is not a Workflow decision or a generic execution-result ledger.
   */
  interaction: StrictJsonValueSchema.optional(),
  containerResult: WorkflowContainerResultSelectorV1Schema.optional(),
  resultContract: StrictJsonValueSchema.optional(),
  execution: WorkflowExecutionCorrespondenceV1Schema.optional(),
  observationDeadline: z.object({ kind: z.literal('at'), expiresAt: z.string().datetime() }).strict().optional(),
  workspace: WorkflowWorkspaceProgressV1Schema.optional(),
  reason: z.object({ code: z.string().min(1), message: z.string().optional() }).strict().optional(),
  previousAttemptRecordId: WorkflowInvocationRecordIdSchema.optional(),
  recovery: WorkflowInvocationRecoveryV1Schema.optional(),
  uncertainPriorEffects: z.object({ activity: z.literal('stopped') }).strict().optional(),
  logicalInvocationRecordId: WorkflowInvocationRecordIdSchema,
}).strict().superRefine((value, context) => {
  const isRoot = value.blockKind === 'root';
  if (isRoot !== (value.invocationPath.blockId === '$root')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invocationPath', 'blockId'],
      message: 'The reserved $root path belongs only to the structural root frame',
    });
  }
  if (value.blockKind !== 'step' && value.attempt !== '0') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attempt'],
      message: 'Structural Workflow frames always use attempt zero',
    });
  }
  if (value.result !== undefined && value.containerResult !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['containerResult'],
      message: 'Workflow progress cannot store both a leaf result and a container selector',
    });
  }
  const isInitialAttempt = value.attempt === '0';
  if (isInitialAttempt && value.previousAttemptRecordId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['previousAttemptRecordId'],
      message: 'An initial Workflow attempt cannot name a previous attempt',
    });
  }
  if (!isInitialAttempt && value.previousAttemptRecordId === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['previousAttemptRecordId'],
      message: 'A retried Workflow attempt must name its previous physical attempt',
    });
  }
});
export type WorkflowProgressEnvelopeV1 = z.infer<typeof WorkflowProgressEnvelopeV1Schema>;

export const WorkflowCheckpointEnvelopeV1Schema = z.object({
  kind: z.literal('happier.workflow-checkpoint.v1'),
  rootRecordId: WorkflowInvocationRecordIdSchema,
  nextSequence: WorkflowDecimalV1Schema,
  frontier: z.object({
    nextBlockOrdinal: z.number().int().nonnegative().safe(),
    paused: z.boolean(),
    interruption: z.string().min(1).optional(),
  }).strict(),
}).strict();
export type WorkflowCheckpointEnvelopeV1 = z.infer<typeof WorkflowCheckpointEnvelopeV1Schema>;

export const WorkflowInvocationDetailV1Schema = z.object({
  index: WorkflowRunInvocationIndexV1Schema,
  progress: WorkflowProgressEnvelopeV1Schema,
  parentRevision: z.number().int().nonnegative().safe(),
}).strict();
export type WorkflowInvocationDetailV1 = z.infer<typeof WorkflowInvocationDetailV1Schema>;

export const WorkflowAuthoredInputV1Schema = z.object({
  document: WorkflowStepComposerDocumentSchema,
  input: z.array(StrictJsonValueSchema).default([]),
}).strict();
export type WorkflowAuthoredInputV1 = z.infer<typeof WorkflowAuthoredInputV1Schema>;

export const WorkflowInvocationRefV1Schema = z.object({ recordId: WorkflowInvocationRecordIdSchema }).strict();
const WorkflowRecoveryInputV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('original') }).strict(),
  z.object({ kind: z.literal('replacement'), value: WorkflowAuthoredInputV1Schema }).strict(),
]);
export const WorkflowRecoveryChoiceV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reattach'), invocation: WorkflowInvocationRefV1Schema }).strict(),
  z.object({
    kind: z.literal('continue'), invocation: WorkflowInvocationRefV1Schema,
    conversation: z.enum(['same_conversation', 'fresh_agent']),
    input: WorkflowAuthoredInputV1Schema,
    acknowledgeUncertainPriorEffects: z.literal(true).optional(),
  }).strict(),
  z.object({
    kind: z.literal('restore_workspace'), invocation: WorkflowInvocationRefV1Schema,
    conversation: z.enum(['same_conversation', 'fresh_agent']),
    input: WorkflowRecoveryInputV1Schema,
    acknowledgeUncertainPriorEffects: z.literal(true).optional(),
  }).strict(),
]);

export const WorkflowResumeInputV1Schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('boundary'), runId: WorkflowRunIdV1Schema, expectedRevision: z.number().int().nonnegative().safe() }).strict(),
  z.object({
    mode: z.literal('recover'), runId: WorkflowRunIdV1Schema,
    expectedRevision: z.number().int().nonnegative().safe(),
    invocations: z.array(WorkflowRecoveryChoiceV1Schema).min(1),
  }).strict(),
]);
export type WorkflowResumeInputV1 = z.infer<typeof WorkflowResumeInputV1Schema>;

export const WorkflowInvocationRetryInputV1Schema = z.object({
  runId: WorkflowRunIdV1Schema,
  expectedRevision: z.number().int().nonnegative().safe(),
  invocation: WorkflowInvocationRefV1Schema,
  conversation: z.enum(['same_conversation', 'fresh_agent']),
  input: WorkflowRecoveryInputV1Schema,
  acknowledgeUncertainPriorEffects: z.literal(true).optional(),
}).strict();
export type WorkflowInvocationRetryInputV1 = z.infer<typeof WorkflowInvocationRetryInputV1Schema>;

export const WORKFLOW_OPERATION_ERROR_CODES_V1 = [
  'invalid_input', 'target_unavailable', 'run_not_found', 'run_access_denied',
  'currentness_conflict', 'missing_reference', 'invalid_reference_scope',
  'workflow_input_too_large', 'workflow_outcome_unresolved',
  'workflow_interaction_capacity_exceeded',
  'workflow_conversation_unavailable', 'continuation_unavailable',
  'workflow_workspace_restore_unavailable', 'workflow_workspace_restore_failed',
  'workflow_wait_self_dependency', 'workflow_input_admission_update_required',
  'ineligible_state', 'custody_pending', 'content_unavailable',
] as const;
export const WorkflowOperationErrorCodeV1Schema = z.enum(WORKFLOW_OPERATION_ERROR_CODES_V1);
export type WorkflowOperationErrorCodeV1 = z.infer<typeof WorkflowOperationErrorCodeV1Schema>;

const WORKFLOW_OPERATION_ERROR_CODES_WITHOUT_DETAILS_V1 = [
  'invalid_input', 'target_unavailable', 'run_not_found', 'run_access_denied',
  'currentness_conflict', 'missing_reference', 'invalid_reference_scope',
  'workflow_input_too_large', 'workflow_outcome_unresolved',
  'workflow_interaction_capacity_exceeded',
  'workflow_conversation_unavailable', 'continuation_unavailable',
  'workflow_workspace_restore_unavailable', 'workflow_workspace_restore_failed',
  'workflow_input_admission_update_required', 'ineligible_state', 'custody_pending',
  'content_unavailable',
] as const;

/** Closed semantic failure returned by the Workflow Action family dependency. */
export const WorkflowActionFailureV1Schema = z.discriminatedUnion('errorCode', [
  z.object({
    ok: z.literal(false),
    errorCode: z.literal('workflow_wait_self_dependency'),
    error: z.string().trim().min(1),
    details: z.object({ runId: WorkflowRunIdV1Schema }).strict(),
  }).strict(),
  z.object({
    ok: z.literal(false),
    errorCode: z.enum(WORKFLOW_OPERATION_ERROR_CODES_WITHOUT_DETAILS_V1),
    error: z.string().trim().min(1),
  }).strict(),
]);
export type WorkflowActionFailureV1 = z.infer<typeof WorkflowActionFailureV1Schema>;

export const WorkflowErrorV1Schema = z.object({
  code: WorkflowOperationErrorCodeV1Schema,
  message: z.string().optional(),
}).strict();
export type WorkflowErrorV1 = z.infer<typeof WorkflowErrorV1Schema>;

export const WorkflowConversationRefV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), machineId: WorkflowMachineIdV1Schema, sessionId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('attached_run'), machineId: WorkflowMachineIdV1Schema, sessionId: z.string().min(1), runId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('detached_run'), machineId: WorkflowMachineIdV1Schema, runId: z.string().min(1) }).strict(),
]);
export const WorkflowInputRefV1Schema = z.object({
  conversation: WorkflowConversationRefV1Schema,
  localId: z.string().min(1),
  turnId: z.string().min(1).optional(),
}).strict();
export const WorkflowResultRefV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string() }).strict(),
  z.object({ kind: z.literal('decision'), value: z.string() }).strict(),
  z.object({ kind: z.literal('json'), value: StrictJsonValueSchema }).strict(),
]);
export type WorkflowResultRefV1 = z.infer<typeof WorkflowResultRefV1Schema>;
export const WorkflowStepObservationV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pending'), input: WorkflowInputRefV1Schema }).strict(),
  z.object({ kind: z.literal('completed'), input: WorkflowInputRefV1Schema, result: WorkflowResultRefV1Schema.optional() }).strict(),
  z.object({ kind: z.literal('failed'), input: WorkflowInputRefV1Schema.optional(), error: WorkflowErrorV1Schema }).strict(),
  z.object({ kind: z.literal('cancelled'), input: WorkflowInputRefV1Schema }).strict(),
  z.object({ kind: z.literal('outcome_uncertain'), input: WorkflowInputRefV1Schema.optional(), error: WorkflowErrorV1Schema }).strict(),
]);
export type WorkflowStepObservationV1 = z.infer<typeof WorkflowStepObservationV1Schema>;

export const WorkflowFinalOutputSelectionV1Schema = WorkflowAuthoredResultReferenceSchema;

export const WorkflowFinalResultV1Schema = z.object({
  kind: z.literal('happier.workflow-final-result.v1'),
  result: WorkflowResultRefV1Schema,
  /** Exact persisted producer selected by the authored final-output binding. */
  producerInvocation: WorkflowInvocationRefV1Schema,
}).strict();
export type WorkflowFinalResultV1 = z.infer<typeof WorkflowFinalResultV1Schema>;
