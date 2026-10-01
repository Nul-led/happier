import { z } from 'zod';

// Development install-job operation, independent of the package version. Every
// envelope is closed: caller-supplied commands and consent extensions are rejected.
export const AgentInstallJobIntentSchema = z.enum(['install', 'update']);
export const AgentInstallJobConsentSchema = z.object({ vendorRecipe: z.boolean() }).strict();
export const AgentInstallJobStepSchema = z.object({
  stepId: z.string().min(1),
  label: z.string().min(1),
  state: z.enum(['running', 'done', 'failed']),
}).strict();
export const AgentInstallJobProgressSchema = z.object({
  stepId: z.string().min(1),
  bytesDone: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative().nullable(),
}).strict();
export const AgentInstallJobFailureCodeSchema = z.enum([
  'consent_required', 'unsupported_platform', 'install_not_available',
  'download_failed', 'verification_failed', 'timeout', 'cancelled',
  'install_failed', 'update_not_available',
]);
export const AgentInstallJobOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('succeeded'), version: z.string().nullable() }).strict(),
  z.object({
    kind: z.literal('failed'),
    code: AgentInstallJobFailureCodeSchema,
    stepId: z.string().min(1),
    message: z.string().min(1),
    guideUrl: z.string().url().optional(),
  }).strict(),
]);
export const AgentInstallJobEventSchema = z.discriminatedUnion('t', [
  AgentInstallJobStepSchema.extend({ t: z.literal('step') }),
  AgentInstallJobProgressSchema.extend({ t: z.literal('progress') }),
  z.object({ t: z.literal('log'), line: z.string() }).strict(),
]);
export const AgentInstallJobSchema = z.object({
  jobId: z.string().min(1),
  agentId: z.string().min(1),
  intent: AgentInstallJobIntentSchema,
  startedAt: z.number().int().nonnegative(),
  steps: z.array(AgentInstallJobStepSchema),
  progress: z.array(AgentInstallJobProgressSchema),
  done: z.boolean(),
  outcome: AgentInstallJobOutcomeSchema.nullable(),
}).strict();
export const DaemonAgentInstallErrorSchema = z.object({
  ok: z.literal(false),
  errorCode: z.enum(['invalid_request', 'job_not_found', 'install_unavailable']),
  error: z.string().min(1),
}).strict();
export const DaemonAgentInstallStartRequestSchema = z.object({
  agentId: z.string().min(1),
  intent: AgentInstallJobIntentSchema,
  consent: AgentInstallJobConsentSchema,
  force: z.boolean().optional(),
}).strict();
export const DaemonAgentInstallStartResponseSchema = z.union([
  z.object({ ok: z.literal(true), jobId: z.string().min(1) }).strict(),
  DaemonAgentInstallErrorSchema,
]);
export const DaemonAgentInstallReadRequestSchema = z.object({
  jobId: z.string().min(1), cursor: z.number().int().nonnegative(),
}).strict();
export const DaemonAgentInstallReadResponseSchema = z.union([
  z.object({
    ok: z.literal(true), events: z.array(AgentInstallJobEventSchema),
    steps: AgentInstallJobSchema.shape.steps,
    progress: AgentInstallJobSchema.shape.progress,
    nextCursor: z.number().int().nonnegative(), done: z.boolean(),
    outcome: AgentInstallJobOutcomeSchema.nullable(),
  }).strict(),
  DaemonAgentInstallErrorSchema,
]);
export const DaemonAgentInstallCancelRequestSchema = z.object({ jobId: z.string().min(1) }).strict();
export const DaemonAgentInstallCancelResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(), DaemonAgentInstallErrorSchema,
]);
export const DaemonAgentInstallListRequestSchema = z.object({}).strict();
export const DaemonAgentInstallListResponseSchema = z.union([
  z.object({ ok: z.literal(true), jobs: z.array(AgentInstallJobSchema) }).strict(), DaemonAgentInstallErrorSchema,
]);

export type AgentInstallJobIntent = z.infer<typeof AgentInstallJobIntentSchema>;
export type AgentInstallJobConsent = z.infer<typeof AgentInstallJobConsentSchema>;
export type AgentInstallJobStep = z.infer<typeof AgentInstallJobStepSchema>;
export type AgentInstallJobProgress = z.infer<typeof AgentInstallJobProgressSchema>;
export type AgentInstallJobFailureCode = z.infer<typeof AgentInstallJobFailureCodeSchema>;
export type AgentInstallJobOutcome = z.infer<typeof AgentInstallJobOutcomeSchema>;
export type AgentInstallJobEvent = z.infer<typeof AgentInstallJobEventSchema>;
export type AgentInstallJob = z.infer<typeof AgentInstallJobSchema>;
export type DaemonAgentInstallError = z.infer<typeof DaemonAgentInstallErrorSchema>;
export type DaemonAgentInstallStartRequest = z.infer<typeof DaemonAgentInstallStartRequestSchema>;
export type DaemonAgentInstallStartResponse = z.infer<typeof DaemonAgentInstallStartResponseSchema>;
export type DaemonAgentInstallReadRequest = z.infer<typeof DaemonAgentInstallReadRequestSchema>;
export type DaemonAgentInstallReadResponse = z.infer<typeof DaemonAgentInstallReadResponseSchema>;
export type DaemonAgentInstallCancelRequest = z.infer<typeof DaemonAgentInstallCancelRequestSchema>;
export type DaemonAgentInstallCancelResponse = z.infer<typeof DaemonAgentInstallCancelResponseSchema>;
export type DaemonAgentInstallListRequest = z.infer<typeof DaemonAgentInstallListRequestSchema>;
export type DaemonAgentInstallListResponse = z.infer<typeof DaemonAgentInstallListResponseSchema>;
