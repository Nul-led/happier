import { z } from 'zod';

import { ScmOperationErrorCodeSchema } from './operationError.js';
import { ScmOperationOutcomeSchema } from './operationOutcome.js';

export const ScmRemoteResponseSchema = z.object({
  success: z.boolean(),
  outcome: ScmOperationOutcomeSchema.optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  error: z.string().optional(),
  errorCode: ScmOperationErrorCodeSchema.optional(),
});
export type ScmRemoteResponse = z.infer<typeof ScmRemoteResponseSchema>;
