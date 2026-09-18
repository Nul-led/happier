import { ExternalActionRequestIdV1Schema, ExternalActionTargetV1Schema, SignedRootActionIdSchema } from '@happier-dev/protocol';
import { z } from 'zod';

export const SIGNED_ROOT_ACTION_EXECUTE_PATH = '/actions/root/execute';
export const SignedRootActionExecuteRequestSchema = z.object({
  actionId: SignedRootActionIdSchema,
  input: z.unknown(),
  target: ExternalActionTargetV1Schema.optional(),
  // Request identities reuse the one Protocol-owned schema the external Action
  // envelope enforces downstream; no local grammar may trim or rewrite them.
  actionRequestId: ExternalActionRequestIdV1Schema.optional(),
}).strict();
export type SignedRootActionExecuteRequest = z.infer<
  typeof SignedRootActionExecuteRequestSchema
>;
