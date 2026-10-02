import { z } from 'zod';

/** Sensitive file metadata stays inside the ordinary Artifact body envelope. */
export const ArtifactBlobReferenceV1Schema = z.object({
  blobId: z.string().uuid(), mime: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ArtifactBlobReferenceV1 = z.infer<typeof ArtifactBlobReferenceV1Schema>;
export const ArtifactBodyV1Schema = z.union([z.string(), ArtifactBlobReferenceV1Schema]);
export type ArtifactBodyV1 = z.infer<typeof ArtifactBodyV1Schema>;

/** Mode is explicit before any binary opening or disclosure. Payloads use standard base64. */
const bytesBase64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const ArtifactBlobStoredContentV1Schema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('plain'), v: bytesBase64 }).strict(),
  z.object({ t: z.literal('encrypted'), c: bytesBase64 }).strict(),
]);
export type ArtifactBlobStoredContentV1 = z.infer<typeof ArtifactBlobStoredContentV1Schema>;
export const ArtifactBlobWriteV1Schema = z.object({
  blobId: z.string().uuid(), content: ArtifactBlobStoredContentV1Schema.optional(),
}).strict();
export type ArtifactBlobWriteV1 = z.infer<typeof ArtifactBlobWriteV1Schema>;
export const ArtifactBlobReadResponseV1Schema = ArtifactBlobWriteV1Schema.required({ content: true });
export type ArtifactBlobReadResponseV1 = z.infer<typeof ArtifactBlobReadResponseV1Schema>;
