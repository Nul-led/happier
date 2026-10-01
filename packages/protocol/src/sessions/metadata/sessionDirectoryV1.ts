import { z } from 'zod';

/** Presentation/routing only; never proves filesystem allocation ownership. */
export const SessionDirectoryV1Schema = z.object({
  v: z.literal(1),
  kind: z.literal('managed'),
}).strict();
export type SessionDirectoryV1 = z.infer<typeof SessionDirectoryV1Schema>;

export function readSessionDirectoryKind(metadata: unknown): 'path' | 'managed' {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'path';
  return SessionDirectoryV1Schema.safeParse(
    (metadata as Record<string, unknown>).sessionDirectoryV1,
  ).success ? 'managed' : 'path';
}
