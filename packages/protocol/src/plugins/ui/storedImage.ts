import { z } from 'zod';

/** Identity of a native Session-image artifact from this mount's successfully delivered Action results. */
export const StoredImageRefV1Schema = z.object({
  sessionId: z.string().trim().min(1),
  mediaId: z.string().trim().min(1),
}).strict();
export type StoredImageRefV1 = z.infer<typeof StoredImageRefV1Schema>;
export const PluginUiReadStoredImageRequestV1Schema = z.object({ image: StoredImageRefV1Schema }).strict();
export const PluginUiReadStoredImageResultV1Schema = z.object({
  bytesBase64: z.string(),
  mimeType: z.literal('image/png'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict();
export type PluginUiReadStoredImageResultV1 = z.infer<typeof PluginUiReadStoredImageResultV1Schema>;
