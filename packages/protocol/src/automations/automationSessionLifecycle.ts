import { z } from 'zod';

import { asProtocolZod } from '../plugins/actions/internalProtocolZodAdapter.js';
import { SessionIdSchema, TurnIdSchema } from '../sessions/idsV1.js';
import {
  SessionUserActionRequiredRequestKindV1Schema,
  type SessionUserActionRequiredRequestKindV1,
} from '../sessions/userActionRequiredOccurrenceV1.js';

export const AutomationSessionLifecycleEventSchema = z.enum([
  'parentTurnCompleted',
  'parentTurnFailed',
  'parentTurnCancelled',
  'userActionRequired',
]);
export type AutomationSessionLifecycleEvent = z.infer<
  typeof AutomationSessionLifecycleEventSchema
>;

export const AutomationSessionLifecycleRequestKindSchema =
  SessionUserActionRequiredRequestKindV1Schema;
export type AutomationSessionLifecycleRequestKind =
  SessionUserActionRequiredRequestKindV1;

export const AUTOMATION_SESSION_LIFECYCLE_MAX_MATCH_COUNT = 2_147_483_647;

const AutomationSessionLifecycleNextMatchesPolicySchema = z.object({
  kind: z.literal('nextMatches'),
  count: z.number().int().positive().max(AUTOMATION_SESSION_LIFECYCLE_MAX_MATCH_COUNT),
}).strict();

export const AutomationSessionLifecyclePolicySnapshotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('currentTurn') }).strict(),
  z.object({ kind: z.literal('firstMatch') }).strict(),
  AutomationSessionLifecycleNextMatchesPolicySchema,
  z.object({ kind: z.literal('everyMatch') }).strict(),
]);
export type AutomationSessionLifecyclePolicySnapshot = z.infer<
  typeof AutomationSessionLifecyclePolicySnapshotSchema
>;

export const AutomationSessionLifecyclePolicySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('currentTurn'),
    sourceTurnId: TurnIdSchema,
  }).strict(),
  z.object({ kind: z.literal('firstMatch') }).strict(),
  AutomationSessionLifecycleNextMatchesPolicySchema,
  z.object({ kind: z.literal('everyMatch') }).strict(),
]);
export type AutomationSessionLifecyclePolicy = z.infer<
  typeof AutomationSessionLifecyclePolicySchema
>;

export const AutomationSessionLifecycleEventsSchema = z.array(
  AutomationSessionLifecycleEventSchema,
).min(1).superRefine((events, context) => {
  if (new Set(events).size !== events.length) {
    context.addIssue({
      code: 'custom',
      message: 'Session lifecycle Events must be unique',
    });
  }
});

export const AutomationSessionLifecycleConfigurationSchema = z.object({
  sourceSessionId: asProtocolZod(SessionIdSchema),
  events: AutomationSessionLifecycleEventsSchema,
  policy: AutomationSessionLifecyclePolicySchema,
}).strict();
export type AutomationSessionLifecycleConfiguration = z.infer<
  typeof AutomationSessionLifecycleConfigurationSchema
>;

export function initialAutomationSessionLifecycleRemainingOccurrences(
  policy: AutomationSessionLifecyclePolicy,
): number | null {
  switch (policy.kind) {
    case 'currentTurn':
    case 'firstMatch':
      return 1;
    case 'nextMatches':
      return policy.count;
    case 'everyMatch':
      return null;
  }
}

export function snapshotAutomationSessionLifecyclePolicy(
  policy: AutomationSessionLifecyclePolicy,
): AutomationSessionLifecyclePolicySnapshot {
  return policy.kind === 'currentTurn' ? { kind: 'currentTurn' } : policy;
}
