import { z } from 'zod';
import { SessionImageMediaReferenceV1Schema } from '../sessions/media/imageReferenceV1.js';
import { PluginUiReadStoredImageResultV1Schema } from '../plugins/ui/storedImage.js';

/** Host-stamped request; renderer requests contain only the mounted opaque media identity. */
export const DaemonPluginStoredImageReadRequestSchema = z.object({
  callerPluginId: z.string().trim().min(1),
  expectedCallerOccurrenceId: z.string().trim().min(1),
  media: SessionImageMediaReferenceV1Schema.required({ file: true }),
}).strict();
export type DaemonPluginStoredImageReadRequest = z.infer<typeof DaemonPluginStoredImageReadRequestSchema>;
export const DaemonPluginStoredImageReadResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), image: PluginUiReadStoredImageResultV1Schema }).strict(),
  z.object({ ok: z.literal(false), code: z.string().min(1) }).strict(),
]);
export type DaemonPluginStoredImageReadResponse = z.infer<typeof DaemonPluginStoredImageReadResponseSchema>;
