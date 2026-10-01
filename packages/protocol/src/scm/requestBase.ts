import { z } from 'zod';

import { ScmBackendPreferenceSchema } from './backendIdentity.js';

export const ScmRequestBaseSchema = z.object({
  cwd: z.string().optional(),
  backendPreference: ScmBackendPreferenceSchema.optional(),
  outcomeVersion: z.literal(1).optional(),
});
export type ScmRequestBase = z.infer<typeof ScmRequestBaseSchema>;
