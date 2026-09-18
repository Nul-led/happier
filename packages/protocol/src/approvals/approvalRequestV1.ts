import { z } from 'zod';
import { asProtocolZod } from "../plugins/actions/internalProtocolZodAdapter.js";

import { ActionApprovalSchema } from '../actions/actionApprovalMetadata.js';
import { ActionIdSchema } from '../actions/actionIds.js';
import { PluginContributionLocalIdSchema } from '../plugins/contributionIdentity.js';
import { PluginIdSchema } from '../plugins/pluginId.js';
import {
  SessionCreationDirectoryApprovalV1Schema,
} from '../sessions/creation/sessionCreationTargetPreparationV1.js';
import { HandoffTargetReplacementApprovalV1Schema } from '../sessions/control/handoff/handoffTargetReplacementApprovalV1.js';
import { ActionRequiredAuthoritySchema } from '../actions/metadata.js';
import {
  ExternalActionTargetV1Schema,
  ExternalActionExecutionAuthorizationV1Schema,
  isExternalActionResolvedTargetAllowedV1,
} from '../actions/externalActionApi.js';
import { AutomationRunCauseSchema } from '../automations/automationRunCause.js';
import { AgentPermissionIntentV1Schema } from '../runtime/permissionIntentV1.js';
import { SessionAgentSpawnPolicyV1StrictSchema } from '../account/settings/sessionAgentSpawnPolicyV1.js';
import {
  SessionInputCausalPermissionAuthorityV1Schema,
  SessionInputSourceSessionV1Schema,
} from '../sessions/messages/sessionInputAdmission.js';

export const ApprovalRequestStatusSchema = z.enum(['open', 'approved', 'rejected', 'executed', 'failed', 'canceled']);
export type ApprovalRequestStatus = z.infer<typeof ApprovalRequestStatusSchema>;

/** Current executable lifecycle. The released V1 status schema above stays byte-for-byte closed. */
export const ApprovalRequestV2StatusSchema = z.enum([
  'open', 'approved', 'executing', 'rejected', 'executed', 'failed', 'canceled',
]);

const ApprovalRequestedSurfaceSchema = z.string().min(1);

/**
 * Released ApprovalRequestV1 artifacts may name this retired interactive
 * picker. It remains history-only: current Action catalog and V2 replay use
 * ActionIdSchema directly.
 */
const ApprovalRequestV1HistoricalActionIdSchema = z.union([
  ActionIdSchema,
  z.literal('session.spawn_picker'),
]);

export const ApprovalRequestOriginV1Schema = z.object({
  kind: z.literal('transcript_tool_call'),
  sessionId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  parentMessageId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  mcpRequestId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  toolInput: z.unknown().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.messageId || value.parentMessageId || value.toolCallId || value.toolName) {
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['origin'],
    message: 'transcript tool-call approval origins require a messageId, parentMessageId, toolCallId, or toolName',
  });
});
export type ApprovalRequestOriginV1 = z.infer<typeof ApprovalRequestOriginV1Schema>;

export const ApprovalRequestCreatedBySchema = z.object({
  surface: z.enum(['voice', 'agent', 'session_agent', 'mcp', 'cli', 'system']),
  agentId: z.string().min(1).optional(),
  pluginId: asProtocolZod(PluginIdSchema).optional(),
  contributionLocalId: asProtocolZod(PluginContributionLocalIdSchema).optional(),
  sessionId: z.string().min(1).optional(),
}).strict();
export type ApprovalRequestCreatedBy = z.infer<typeof ApprovalRequestCreatedBySchema>;

export const ApprovalDecisionV1Schema = z.object({
  kind: z.enum(['approve', 'reject']),
  decidedAtMs: z.number().int().min(0),
}).passthrough();
export type ApprovalDecisionV1 = z.infer<typeof ApprovalDecisionV1Schema>;

export const ApprovalExecutionV1Schema = z.object({
  executedAtMs: z.number().int().min(0),
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorCode: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
}).passthrough();
export type ApprovalExecutionV1 = z.infer<typeof ApprovalExecutionV1Schema>;

/**
 * Current execution history. Failure details are admitted only by the
 * request-bound validator below; this field is not an arbitrary error bag.
 */
export const ApprovalExecutionV2Schema = z.object({
  executedAtMs: z.number().int().min(0),
  ok: z.boolean(),
  result: z.unknown().optional(),
  errorCode: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  details: z.unknown().optional(),
}).strict();
export type ApprovalExecutionV2 = z.infer<typeof ApprovalExecutionV2Schema>;

const ApprovalExecutionOriginSurfaceV1Schema = z.enum([
  'ui',
  'voice',
  'agent',
  'mcp',
  'cli',
  'rpc',
  'api',
  'plugin',
]);

export const ApprovalExecutionOriginCallerV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('host') }).strict(),
  z.object({
    kind: z.literal('plugin'),
    pluginId: asProtocolZod(PluginIdSchema),
    contributionLocalId: asProtocolZod(PluginContributionLocalIdSchema),
    immutableGenerationId: z.string().trim().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal('automationRun'),
    runId: z.string().trim().min(1),
    automationId: z.string().trim().min(1),
    cause: AutomationRunCauseSchema,
  }).strict(),
]);

/**
 * Immutable authority and routing facts captured when a durable approval is
 * admitted. External invocation authorization is Machine-bound authorization
 * material; it contains no PAT bearer and cannot authenticate without that
 * Machine's signature. Descriptive `createdBy`/`origin` is display metadata.
 */
export const ApprovalExecutionOriginV1Schema = z.object({
  v: z.literal(1),
  authority: ActionRequiredAuthoritySchema,
  surface: ApprovalExecutionOriginSurfaceV1Schema,
  caller: ApprovalExecutionOriginCallerV1Schema,
  /** Local profile identifier used to route the replay to its configured Home. */
  serverId: z.string().trim().min(1),
  /** Cryptographic Home identity, required for a Home-signed external invocation. */
  serverIdentityId: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional(),
  principalId: z.string().trim().min(1).optional(),
  credentialId: z.string().trim().min(1).optional(),
  externalActionExecutionAuthorization: ExternalActionExecutionAuthorizationV1Schema.optional(),
  externalActionInputSignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/u).optional(),
  sessionId: z.string().trim().min(1).optional(),
  /** Original host corpus binding; current resource admission remains mandatory. */
  sessionListAccess: z.enum(['current_session', 'unavailable']).optional(),
  machineId: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).optional(),
  runOccurrenceId: z.string().trim().min(1).optional(),
  /** Original admitted permission inputs; current runtime policy is rechecked before replay. */
  callerPermissionMode: asProtocolZod(AgentPermissionIntentV1Schema).nullable().optional(),
  sessionAgentSpawnPolicyV1: SessionAgentSpawnPolicyV1StrictSchema.optional(),
  causalPermissionAuthority: SessionInputCausalPermissionAuthorityV1Schema.nullable().optional(),
  sessionInputSource: SessionInputSourceSessionV1Schema.nullable().optional(),
  target: ExternalActionTargetV1Schema.optional(),
  actionId: ActionIdSchema,
  requestId: z.string().trim().min(1),
}).strict().superRefine((value, ctx) => {
  if (value.sessionListAccess === 'current_session' && !value.sessionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessionListAccess'],
      message: 'Current-Session list scope requires an exact Session binding' });
  }
  if (
    value.actionId === 'session.list'
    && (value.surface === 'agent' || value.surface === 'mcp' || value.surface === 'plugin')
    && value.sessionListAccess !== 'current_session'
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sessionListAccess'],
      message: 'Autonomous Session-list approval origins require their exact admitted Session corpus',
    });
  }
  const authorization = value.externalActionExecutionAuthorization;
  if (authorization) {
    const binding = authorization.binding;
    const admittedTarget = value.target !== undefined
      && isExternalActionResolvedTargetAllowedV1({
        authorizedTarget: binding.target,
        resolvedTarget: value.target,
        selectedMachineId: binding.machineId,
      });
    if (value.surface !== 'api' || value.authority !== 'account_automation'
      || value.serverIdentityId !== binding.serverIdentityId
      || value.accountId !== binding.accountId || value.principalId !== binding.principalId
      || value.credentialId !== binding.credentialId
      || value.requestId !== binding.requestId || value.machineId !== binding.machineId || !admittedTarget) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['externalActionExecutionAuthorization'],
        message: 'Execution authorization must match the exact originating API invocation' });
    }
  }
  const credentialFieldCount = [value.principalId, value.credentialId]
    .filter((field) => field !== undefined).length;
  if (credentialFieldCount === 1 || (credentialFieldCount === 2 && !value.accountId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['credentialId'],
      message: 'external approval origins require accountId, principalId, and credentialId together',
    });
  }
  if (value.surface === 'api' && (!value.accountId || credentialFieldCount !== 2)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['credentialId'],
      message: 'API approval origins require verified credential provenance',
    });
  }
  if (value.target?.kind === 'session' && value.sessionId !== value.target.sessionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sessionId'],
      message: 'Session-target approval origins require the same exact Session id',
    });
  }
  if (value.target?.kind === 'machine' && value.machineId !== value.target.machineId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['machineId'],
      message: 'Machine-target approval origins require the same exact machine id',
    });
  }
  if (value.caller.kind === 'automationRun' && value.runId !== value.caller.runId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['runId'],
      message: 'Automation-run approval origins require the same exact Run id',
    });
  }
});
export type ApprovalExecutionOriginV1 = z.infer<typeof ApprovalExecutionOriginV1Schema>;

function validateApprovalRequestLifecycle(
  value: Readonly<Record<string, unknown>>,
  ctx: z.RefinementCtx,
): void {
  const status = value.status as z.infer<typeof ApprovalRequestV2StatusSchema>;
  const decision = value.decision as ApprovalDecisionV1 | undefined;
  const execution = value.execution as ApprovalExecutionV1 | undefined;
  const requiresDecision = status === 'approved'
    || status === 'executing'
    || status === 'rejected'
    || status === 'executed'
    || status === 'failed';
  const requiresExecution = status === 'executed' || status === 'failed';

  if (status === 'open') {
    if (decision != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'open approval requests must not include a decision' });
    if (execution != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['execution'], message: 'open approval requests must not include execution metadata' });
  }
  if (requiresDecision && decision == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: `status ${status} requires a decision` });
  if (requiresExecution && execution == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['execution'], message: `status ${status} requires execution metadata` });
  if (!requiresExecution && execution != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['execution'], message: `status ${status} must not include execution metadata` });
  if ((status === 'approved' || status === 'executing' || status === 'executed' || status === 'failed') && decision?.kind !== 'approve') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: `status ${status} requires an approve decision` });
  }
  if (status === 'rejected' && decision?.kind !== 'reject') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'status rejected requires a reject decision' });
  if (status === 'canceled' && decision != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'canceled approval requests must not include a decision' });
  if (status === 'executed' && execution?.ok !== true) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['execution'], message: 'status executed requires a successful execution result' });
  if (status === 'failed' && execution?.ok !== false) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['execution'], message: 'status failed requires a failed execution result' });
  if (value.v === 2 && execution?.ok === true && Object.hasOwn(execution, 'details')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['execution', 'details'], message: 'successful approval execution cannot include failure details' });
  }

  if (value.sessionCreationDirectoryApproval !== undefined && value.actionId !== 'session.spawn_new') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sessionCreationDirectoryApproval'], message: 'Directory creation approval evidence belongs only to session.spawn_new.' });
  }
  if (value.handoffTargetReplacementApproval !== undefined && value.actionId !== 'session.handoff') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['handoffTargetReplacementApproval'], message: 'Handoff target-replacement approval evidence belongs only to session.handoff.' });
  }
}

export const ApprovalRequestV1Schema = z.object({
  v: z.literal(1),
  status: ApprovalRequestStatusSchema,
  createdAtMs: z.number().int().min(0),
  updatedAtMs: z.number().int().min(0),
  createdBy: ApprovalRequestCreatedBySchema,
  requestedSurface: ApprovalRequestedSurfaceSchema.optional(),
  origin: ApprovalRequestOriginV1Schema.optional(),
  approval: ActionApprovalSchema.optional(),
  actionId: ApprovalRequestV1HistoricalActionIdSchema,
  actionArgs: z.unknown(),
  summary: z.string().min(1),
  preview: z.unknown().optional(),
  /**
   * Host-stamped target evidence for a deferred `session.spawn_new` directory
   * creation approval. It is not Action input and cannot authorize another
   * Action family.
   */
  sessionCreationDirectoryApproval: SessionCreationDirectoryApprovalV1Schema.optional(),
  /** Host-stamped non-empty handoff target evidence; never Action input. */
  handoffTargetReplacementApproval: HandoffTargetReplacementApprovalV1Schema.optional(),
  decision: ApprovalDecisionV1Schema.optional(),
  execution: ApprovalExecutionV1Schema.optional(),
}).passthrough().superRefine((value, ctx) => {
  validateApprovalRequestLifecycle(value, ctx);
});
export type ApprovalRequestV1 = z.infer<typeof ApprovalRequestV1Schema>;

/** Current durable replay format. V1 remains readable history but carries no replay authority. */
export const ApprovalRequestV2Schema = z.object({
  v: z.literal(2),
  status: ApprovalRequestV2StatusSchema,
  createdAtMs: z.number().int().min(0),
  updatedAtMs: z.number().int().min(0),
  createdBy: ApprovalRequestCreatedBySchema,
  requestedSurface: ApprovalRequestedSurfaceSchema.optional(),
  origin: ApprovalRequestOriginV1Schema.optional(),
  executionOriginV1: ApprovalExecutionOriginV1Schema,
  approval: ActionApprovalSchema.optional(),
  actionId: ActionIdSchema,
  actionArgs: z.unknown(),
  summary: z.string().min(1),
  preview: z.unknown().optional(),
  sessionCreationDirectoryApproval: SessionCreationDirectoryApprovalV1Schema.optional(),
  handoffTargetReplacementApproval: HandoffTargetReplacementApprovalV1Schema.optional(),
  decision: ApprovalDecisionV1Schema.optional(),
  execution: ApprovalExecutionV2Schema.optional(),
}).strict().superRefine((value, ctx) => {
  validateApprovalRequestLifecycle(value, ctx);
  if (value.executionOriginV1.actionId !== value.actionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['executionOriginV1', 'actionId'], message: 'execution origin Action must match the approved Action' });
  }
  // A Home-signed external invocation is persisted as an `api` origin even when
  // the caller reached it through another surface, so the descriptive requested
  // surface records that nested caller without contradicting the authority. Any
  // other surface pair repeats one fact twice and must agree exactly.
  const nestedExternalInvocation = value.executionOriginV1.surface === 'api'
    && value.executionOriginV1.externalActionExecutionAuthorization !== undefined;
  if (
    value.requestedSurface !== undefined
    && value.requestedSurface !== value.executionOriginV1.surface
    && !nestedExternalInvocation
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestedSurface'], message: 'requested surface must match the immutable execution origin' });
  }
  const originCaller = value.executionOriginV1.caller;
  if (originCaller.kind === 'plugin') {
    if (value.createdBy.pluginId !== undefined && value.createdBy.pluginId !== originCaller.pluginId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['createdBy', 'pluginId'], message: 'display plugin must match the immutable execution origin' });
    }
    if (
      value.createdBy.contributionLocalId !== undefined
      && value.createdBy.contributionLocalId !== originCaller.contributionLocalId
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['createdBy', 'contributionLocalId'], message: 'display contribution must match the immutable execution origin' });
    }
  } else if (value.createdBy.pluginId !== undefined || value.createdBy.contributionLocalId !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['createdBy'], message: 'display plugin identity requires a plugin execution origin' });
  }
});
export type ApprovalRequestV2 = z.infer<typeof ApprovalRequestV2Schema>;

export const ApprovalRequestSchema = z.discriminatedUnion('v', [
  ApprovalRequestV1Schema,
  ApprovalRequestV2Schema,
]);
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
