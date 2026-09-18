import { z } from 'zod';

/** Content-free wake hint; ordinary Session changes also invalidate surface reads. */
export const SessionSurfacesChangeHintV1Schema = z.object({
  v: z.literal(1),
  sessionSurfaces: z.literal(true),
}).strict();
export type SessionSurfacesChangeHintV1 = z.infer<typeof SessionSurfacesChangeHintV1Schema>;
