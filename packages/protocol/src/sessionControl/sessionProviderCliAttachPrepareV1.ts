import { z } from 'zod';

/** Preparation is scoped to the native session the requesting terminal intends to attach. */
const ProviderSessionIdSchema = z.string().min(1).refine((value) => value.trim().length > 0);

export const SessionProviderCliAttachPrepareRequestV1Schema = z.object({
  providerSessionId: ProviderSessionIdSchema,
}).strict();

export type SessionProviderCliAttachPrepareRequestV1 = z.infer<typeof SessionProviderCliAttachPrepareRequestV1Schema>;

export const SessionProviderCliAttachPrepareResultV1Schema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    providerSessionId: ProviderSessionIdSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    errorCode: z.string().min(1),
    error: z.string().optional(),
  }).strict(),
]);

export type SessionProviderCliAttachPrepareResultV1 = z.infer<typeof SessionProviderCliAttachPrepareResultV1Schema>;
