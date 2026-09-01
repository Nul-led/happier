import { z } from 'zod';

import { TurnIdSchema } from './idsV1.js';

export const SessionUserActionRequiredRequestKindV1Schema = z.enum([
  'permission',
  'user_action',
]);
export type SessionUserActionRequiredRequestKindV1 = z.infer<
  typeof SessionUserActionRequiredRequestKindV1Schema
>;

/** Content-free identity for one newly pending main-turn request. */
export const SessionUserActionRequiredOccurrenceV1Schema = z.object({
  requestId: z.string().trim().min(1).max(256),
  sourceTurnId: TurnIdSchema,
  requestKind: SessionUserActionRequiredRequestKindV1Schema,
  occurredAt: z.number().int().nonnegative(),
}).strict();
export type SessionUserActionRequiredOccurrenceV1 = z.infer<
  typeof SessionUserActionRequiredOccurrenceV1Schema
>;
