import { z } from 'zod';

/**
 * Released Account profile shape, still projected by the public-share and
 * released Session-listing readers. The released direct-share routes that also
 * used it were retired under the one-way 0.3 upgrade.
 */
export const ReleasedDirectSessionShareProfileV1Schema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  avatar: z.string().nullable(),
}).strict();
export type ReleasedDirectSessionShareProfileV1 = z.infer<
  typeof ReleasedDirectSessionShareProfileV1Schema
>;
