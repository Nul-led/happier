import { z } from 'zod';
import { SessionEffectiveAccessV1Schema } from '../access/sessionEffectiveAccessV1.js';
import { AccountEncryptionModeSchema } from '../../features/payload/capabilities/encryptionCapabilities.js';
import { TurnIdSchema } from '../idsV1.js';
import { PendingActivationAuthorizationV1Schema } from '../pending/pendingActivationAuthorizationV1.js';
import { PrimaryTurnStatusV1Schema, SessionRuntimeIssueV1Schema } from './runtimeIssueV1.js';
import { SessionRuntimeActivityStateSchema, refineRuntimeActivityProjectionFields } from '../runtime/activity/sessionRuntimeActivity.js';

export const SessionSummarySchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  active: z.boolean(),
  activeAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().nullable().optional(),
  pendingCount: z.number().int().nonnegative().optional(),
  pendingBlockedCount: z.number().int().nonnegative().optional(),
  tag: z.string().optional(),
  title: z.string().min(1).optional(),
  path: z.string().optional(),
  host: z.string().optional(),
  share: z.object({
    accessLevel: z.string().min(1),
    canApprovePermissions: z.boolean(),
  }).nullable().optional(),
  effectiveAccess: SessionEffectiveAccessV1Schema.optional(),
  isSystem: z.boolean().optional(),
  systemPurpose: z.string().nullable().optional(),
  encryptionMode: AccountEncryptionModeSchema.optional(),
  // Reports the caller's available E2EE material without conflating it with the
  // persisted Session mode. Token-only callers use null, including when listing a
  // retained E2EE Session whose private metadata remains locked.
  encryption: z.object({
    type: z.enum(['legacy', 'dataKey']),
  }).passthrough().nullable(),
  latestTurnId: TurnIdSchema.nullable().optional(),
  latestTurnStatus: PrimaryTurnStatusV1Schema.nullable().optional(),
  latestTurnStatusObservedAt: z.number().int().nonnegative().nullable().optional(),
  lastRuntimeIssue: SessionRuntimeIssueV1Schema.nullable().optional(),
  runtimeActivityState: SessionRuntimeActivityStateSchema.optional(),
  runtimeActivityActiveCount: z.number().int().nonnegative().optional(),
  runtimeActivityObservedAt: z.number().int().nonnegative().nullable().optional(),
  runtimeActivityRevision: z.number().int().nonnegative().optional(),
  rollbackEligibleTurnStarts: z.array(z.number().int().nonnegative()).optional(),
  pendingActivationAuthorization: PendingActivationAuthorizationV1Schema.optional(),
}).passthrough().superRefine(refineRuntimeActivityProjectionFields);
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListResultSchema = z.object({
  sessions: z.array(SessionSummarySchema),
  nextCursor: z.string().nullable().optional(),
  hasNext: z.boolean().optional(),
}).passthrough();
export type SessionListResult = z.infer<typeof SessionListResultSchema>;

