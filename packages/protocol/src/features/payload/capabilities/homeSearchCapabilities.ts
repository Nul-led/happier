import { z } from 'zod';

/** Dynamic status of the one server-light Personal Home transcript index. */
export const HomeSearchCapabilitiesSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['home', 'daemon']).nullable(),
  reason: z.enum(['non_plain_home', 'index_unavailable', 'indexing']).optional(),
}).strict();

export type HomeSearchCapabilities = z.infer<typeof HomeSearchCapabilitiesSchema>;
