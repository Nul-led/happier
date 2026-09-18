import { z } from 'zod';

import { ConnectedServiceBindingsV2IngressSchema } from '../connect/connectedServiceBindings.js';
import { ExecutionRunResultContractV1Schema } from '../execution/runs/resultContractV1.js';
import { StrictJsonValueSchema, type JsonValue } from '../json/strictJsonValue.js';
import { SessionModelSelectionV1Schema } from '../providers/selection/v1.js';
import {
  SESSION_AUTHORING_FIELD_CATALOG,
} from '../sessions/authoring/fieldCatalog.js';
import { PortableRuntimeDescriptorV1Schema } from '../sessions/metadata/runtimeDescriptorV1.js';
import { WorkflowStepComposerDocumentSchema } from './workflowComposerDocumentV1.js';
import {
  WorkflowAuthoredResultReferenceSchema,
  WorkflowBlockIdSchema,
  WorkflowConditionSchema,
  WorkflowConversationSelectionSchema,
  WorkflowInputNameSchema,
  WorkflowValueReferenceSchema,
  type WorkflowCondition,
  type WorkflowValueReference,
} from './workflowReferenceV1.js';
import { WorkflowWorkspaceSelectionSchema } from './workflowWorkspaceV1.js';

export {
  WorkflowStepComposerDocumentSchema,
  type WorkflowStepComposerDocument,
} from './workflowComposerDocumentV1.js';

/**
 * The one canonical, origin-neutral executable workflow definition (FLOW §3.1).
 *
 * UI, CLI, both SDKs, agent Actions and Automation admission all parse through
 * these exports. There is deliberately no second workflow dialect: the editor
 * imports this validator for instant local feedback and the Action host reruns
 * the same parser before any save or start effect.
 */

export const WorkflowInputDefinitionSchema = z.object({
  name: WorkflowInputNameSchema,
  valueType: z.enum(['string', 'number', 'boolean', 'json']),
  required: z.boolean(),
  default: StrictJsonValueSchema.optional(),
  description: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.required && value.default !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['default'],
      message: 'required inputs cannot have defaults',
    });
  }
});
export type WorkflowInputDefinition = z.infer<typeof WorkflowInputDefinitionSchema>;

export const WorkflowResultContractSchema = ExecutionRunResultContractV1Schema.superRefine(
  (value, context) => {
    if (
      value.kind === 'decision'
      && (value.decisions.length !== 2
        || value.decisions[0] !== 'continue'
        || value.decisions[1] !== 'stop')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['decisions'],
        message: 'Workflow evaluator decisions must be exactly ["continue", "stop"]',
      });
    }
  },
);
export type WorkflowResultContract = z.infer<typeof WorkflowResultContractSchema>;

/**
 * The audited serializable subset of the incumbent Session authoring contract.
 *
 * Each member keeps its canonical nested schema rather than collapsing to a
 * string id, so a saved definition reproduces the exact Agent target, model
 * connection, permission intent, MCP selection and Connected Service bindings
 * the author chose. Omission inherits; a present value — including an explicit
 * `null` or a value equal to the current default — is a preserved override.
 *
 * Machine placement, directory/checkout, existing-Session identity and prompt
 * content are deliberately absent: those are owned by Run target selection,
 * `workspace`, `conversation` and the Composer document respectively. Raw
 * environment variables and Account/team placement are excluded from portable
 * definitions.
 */
const WORKFLOW_SESSION_AUTHORING_SELECTION_SHAPE = {
  agentTarget: SESSION_AUTHORING_FIELD_CATALOG.agentTarget.schema.optional(),
  // The catalog entry carries a `.default(null)` for draft hydration. A workflow
  // definition must distinguish omission from an explicit null, so this consumes
  // the underlying selection schema without that default.
  modelSelection: SessionModelSelectionV1Schema.nullable().optional(),
  profileId: SESSION_AUTHORING_FIELD_CATALOG.profileId.schema.optional(),
  permissionMode: SESSION_AUTHORING_FIELD_CATALOG.permissionMode.schema.optional(),
  acpSessionModeId: SESSION_AUTHORING_FIELD_CATALOG.acpSessionModeId.schema.optional(),
  sessionConfigOptionOverrides: SESSION_AUTHORING_FIELD_CATALOG.sessionConfigOptionOverrides.schema.optional(),
  mcpSelection: SESSION_AUTHORING_FIELD_CATALOG.mcpSelection.schema.optional(),
  // Portable definitions normalize supported V1 persistence into the strict
  // current selection so native/profile/group/team-resource intent survives
  // without carrying unknown fields into exported JSON.
  connectedServices: ConnectedServiceBindingsV2IngressSchema.nullable().optional(),
  transcriptStorage: SESSION_AUTHORING_FIELD_CATALOG.transcriptStorage.schema.optional(),
  terminal: SESSION_AUTHORING_FIELD_CATALOG.terminal.schema.optional(),
  windowsRemoteSessionLaunchMode: SESSION_AUTHORING_FIELD_CATALOG.windowsRemoteSessionLaunchMode.schema.optional(),
  windowsRemoteSessionConsole: SESSION_AUTHORING_FIELD_CATALOG.windowsRemoteSessionConsole.schema.optional(),
  windowsTerminalWindowName: SESSION_AUTHORING_FIELD_CATALOG.windowsTerminalWindowName.schema.optional(),
  runtimeDescriptorV1: PortableRuntimeDescriptorV1Schema.nullable().optional(),
} as const;

export const WorkflowSessionAuthoringSelectionSchema = z
  .object(WORKFLOW_SESSION_AUTHORING_SELECTION_SHAPE)
  .strict();
export type WorkflowSessionAuthoringSelection = z.infer<typeof WorkflowSessionAuthoringSelectionSchema>;

/** The Session-authoring field ids a workflow definition round-trips, in editor order. */
export type WorkflowSessionAuthoringSelectionFieldId = keyof typeof WORKFLOW_SESSION_AUTHORING_SELECTION_SHAPE;
export const WORKFLOW_SESSION_AUTHORING_SELECTION_FIELD_IDS = Object.freeze(
  Object.keys(WORKFLOW_SESSION_AUTHORING_SELECTION_SHAPE) as WorkflowSessionAuthoringSelectionFieldId[],
);

export const WorkflowStepExecutionSelectionSchema = WorkflowSessionAuthoringSelectionSchema.extend({
  conversation: WorkflowConversationSelectionSchema.optional(),
  workspace: WorkflowWorkspaceSelectionSchema.optional(),
}).strict();
export type WorkflowStepExecutionSelection = z.infer<typeof WorkflowStepExecutionSelectionSchema>;

export const WorkflowStepSchema = z.object({
  kind: z.literal('step'),
  id: WorkflowBlockIdSchema,
  document: WorkflowStepComposerDocumentSchema,
  execution: WorkflowStepExecutionSelectionSchema.optional(),
  input: z.array(WorkflowValueReferenceSchema).default([]),
  result: WorkflowResultContractSchema.default({ kind: 'text' }),
  timeoutMs: z.number().int().positive().safe().optional(),
  onlyWhen: WorkflowConditionSchema.optional(),
}).strict();
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WORKFLOW_FAILURE_POLICIES = ['fail_stop', 'collect_outcomes'] as const;
export type WorkflowFailurePolicy = (typeof WORKFLOW_FAILURE_POLICIES)[number];

export const WORKFLOW_ITEM_EXECUTION_MODES = ['sequential', 'parallel'] as const;
export type WorkflowItemExecutionMode = (typeof WORKFLOW_ITEM_EXECUTION_MODES)[number];

export const WORKFLOW_EVALUATOR_HISTORY_MODES = ['none', 'latest', 'all'] as const;
export type WorkflowEvaluatorHistoryMode = (typeof WORKFLOW_EVALUATOR_HISTORY_MODES)[number];

export type WorkflowParallelBranch = Readonly<{ id: string; blocks: readonly WorkflowBlock[] }>;

export type WorkflowRepetition =
  | Readonly<{ kind: 'count'; count: WorkflowValueReference }>
  | Readonly<{
    kind: 'items';
    items: WorkflowValueReference;
    execution: WorkflowItemExecutionMode;
    failurePolicy: WorkflowFailurePolicy;
    maxConcurrent?: number;
  }>
  | Readonly<{ kind: 'until'; maxIterations: number; stopWhen: WorkflowCondition }>
  | Readonly<{
    kind: 'evaluate';
    maxIterations: number;
    evaluator: WorkflowStep;
    history: WorkflowEvaluatorHistoryMode;
  }>;

export type WorkflowBlock =
  | WorkflowStep
  | Readonly<{
    kind: 'parallel';
    id: string;
    branches: readonly WorkflowParallelBranch[];
    failurePolicy: WorkflowFailurePolicy;
    maxConcurrent?: number;
    onlyWhen?: WorkflowCondition;
  }>
  | Readonly<{
    kind: 'loop';
    id: string;
    body: readonly WorkflowBlock[];
    repetition: WorkflowRepetition;
    onlyWhen?: WorkflowCondition;
  }>
  | Readonly<{
    kind: 'if';
    id: string;
    when: WorkflowCondition;
    then: readonly WorkflowBlock[];
    otherwise: readonly WorkflowBlock[];
  }>;

export const WorkflowRepetitionSchema: z.ZodType<WorkflowRepetition> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('count'), count: WorkflowValueReferenceSchema }).strict(),
  z.object({
    kind: z.literal('items'),
    items: WorkflowValueReferenceSchema,
    execution: z.enum(WORKFLOW_ITEM_EXECUTION_MODES),
    failurePolicy: z.enum(WORKFLOW_FAILURE_POLICIES),
    maxConcurrent: z.number().int().positive().safe().optional(),
  }).strict(),
  z.object({
    kind: z.literal('until'),
    maxIterations: z.number().int().positive().safe(),
    stopWhen: WorkflowConditionSchema,
  }).strict(),
  z.object({
    kind: z.literal('evaluate'),
    maxIterations: z.number().int().positive().safe(),
    evaluator: WorkflowStepSchema,
    history: z.enum(WORKFLOW_EVALUATOR_HISTORY_MODES),
  }).strict(),
])) as unknown as z.ZodType<WorkflowRepetition>;

export const WorkflowBlockSchema: z.ZodType<WorkflowBlock> = z.lazy(() => z.discriminatedUnion('kind', [
  WorkflowStepSchema,
  z.object({
    kind: z.literal('parallel'),
    id: WorkflowBlockIdSchema,
    branches: z.array(z.object({
      id: WorkflowBlockIdSchema,
      blocks: z.array(WorkflowBlockSchema).min(1),
    }).strict()).min(1),
    failurePolicy: z.enum(WORKFLOW_FAILURE_POLICIES),
    maxConcurrent: z.number().int().positive().safe().optional(),
    onlyWhen: WorkflowConditionSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('loop'),
    id: WorkflowBlockIdSchema,
    body: z.array(WorkflowBlockSchema).min(1),
    repetition: WorkflowRepetitionSchema,
    onlyWhen: WorkflowConditionSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('if'),
    id: WorkflowBlockIdSchema,
    when: WorkflowConditionSchema,
    then: z.array(WorkflowBlockSchema).min(1),
    otherwise: z.array(WorkflowBlockSchema).default([]),
  }).strict(),
])) as unknown as z.ZodType<WorkflowBlock>;

export const WorkflowDefinitionBaseSchema = z.object({
  version: z.literal(1),
  inputs: z.array(WorkflowInputDefinitionSchema).default([]),
  defaults: WorkflowStepExecutionSelectionSchema.default({}),
  blocks: z.array(WorkflowBlockSchema).min(1),
  finalOutput: WorkflowAuthoredResultReferenceSchema.optional(),
}).strict();

export type WorkflowDefinitionV1 = Readonly<{
  version: 1;
  inputs: readonly WorkflowInputDefinition[];
  defaults: WorkflowStepExecutionSelection;
  blocks: readonly WorkflowBlock[];
  finalOutput?: z.infer<typeof WorkflowAuthoredResultReferenceSchema>;
}>;

/**
 * Structural parse only. Semantic validation (ids, references, scopes, provable
 * bounds and effective Agent resolution) is the walker in
 * `validateWorkflowDefinition`, which reparses its normalized output through
 * this schema.
 */
export const WorkflowDefinitionSchema = WorkflowDefinitionBaseSchema as unknown as z.ZodType<WorkflowDefinitionV1>;
/** Epoch-qualified public name; aliases the single executable owner above. */
export const WorkflowDefinitionV1Schema = WorkflowDefinitionSchema;

/**
 * The ingress dialect: a prompt-only string is accepted anywhere a block may
 * appear — the root list, a parallel branch, a loop body and either `if`
 * branch. Normalization expands each string into a text-only step with a
 * deterministic `wf-<parent-path>-step-<ordinal>` id and reparses the result
 * through `WorkflowDefinitionSchema`, so nothing is ever persisted in this
 * dialect.
 *
 * This union exists solely to permit those string entries; every structured
 * member is otherwise identical to `WorkflowBlockSchema`. `workflowV1.test.ts`
 * pins the two together so the dialect cannot drift into a second definition
 * contract.
 */
export const WorkflowIngressBlockSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string().min(1),
  WorkflowStepSchema,
  z.object({
    kind: z.literal('parallel'),
    id: WorkflowBlockIdSchema,
    branches: z.array(z.object({
      id: WorkflowBlockIdSchema,
      blocks: z.array(WorkflowIngressBlockSchema).min(1),
    }).strict()).min(1),
    failurePolicy: z.enum(WORKFLOW_FAILURE_POLICIES),
    maxConcurrent: z.number().int().positive().safe().optional(),
    onlyWhen: WorkflowConditionSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('loop'),
    id: WorkflowBlockIdSchema,
    body: z.array(WorkflowIngressBlockSchema).min(1),
    repetition: WorkflowRepetitionSchema,
    onlyWhen: WorkflowConditionSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('if'),
    id: WorkflowBlockIdSchema,
    when: WorkflowConditionSchema,
    then: z.array(WorkflowIngressBlockSchema).min(1),
    otherwise: z.array(WorkflowIngressBlockSchema).default([]),
  }).strict(),
]));

export const WorkflowIngressSchema = z.object({
  version: z.literal(1).optional(),
  inputs: z.array(WorkflowInputDefinitionSchema).optional(),
  defaults: WorkflowStepExecutionSelectionSchema.optional(),
  blocks: z.array(WorkflowIngressBlockSchema).min(1),
  finalOutput: WorkflowAuthoredResultReferenceSchema.optional(),
}).strict();
export type WorkflowIngressV1 = z.infer<typeof WorkflowIngressSchema>;
/** Epoch-neutral alias consumed by the workflow Action request schemas. */
export type WorkflowIngress = WorkflowIngressV1;

/**
 * Host-only ingress context. A trusted Action adapter supplies the calling
 * Session's canonical current Agent and machine; the normalizer consults them
 * only when neither the step nor the workflow default supplies a value, and
 * never persists them as caller-authored JSON. This is not wire content and
 * cannot be caller-forged.
 */
export const WorkflowIngressContextV1Schema = z.object({
  agentTarget: SESSION_AUTHORING_FIELD_CATALOG.agentTarget.schema.optional(),
  machineId: z.string().min(1).optional(),
  directory: z.string().min(1).optional(),
}).strict();
export type WorkflowIngressContextV1 = z.infer<typeof WorkflowIngressContextV1Schema>;

export const WORKFLOW_VALIDATION_ISSUE_CODES = [
  'invalid_version',
  'unknown_field',
  'invalid_id',
  'duplicate_id',
  'missing_reference',
  'invalid_reference_scope',
  'invalid_input',
  'missing_required_input',
  'invalid_result_contract',
  'invalid_condition',
  'invalid_repetition',
  'invalid_max_concurrent',
  'unsupported_persisted_attachment',
  'conversation_workspace_mismatch',
  'target_unavailable',
] as const;
export type WorkflowValidationIssueCode = (typeof WORKFLOW_VALIDATION_ISSUE_CODES)[number];

export type WorkflowValidationIssue = Readonly<{
  code: WorkflowValidationIssueCode;
  /** JSON-pointer-like location of the exact block or field, e.g. `/blocks/1/input/0`. */
  path: string;
  message: string;
  blockId?: string;
  severity: 'error' | 'warning';
}>;

export type WorkflowTargetValidationState = 'not_requested' | 'checked' | 'unavailable';

export type WorkflowValidationResult = Readonly<{
  valid: boolean;
  normalizedDefinition?: WorkflowDefinitionV1;
  issues: readonly WorkflowValidationIssue[];
  targetValidation: WorkflowTargetValidationState;
}>;

export type { JsonValue };
