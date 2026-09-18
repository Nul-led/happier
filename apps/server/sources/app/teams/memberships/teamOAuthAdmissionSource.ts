import { z } from "zod";

/** Server-authored authority for one exact Team OAuth admission finalization. */
export const teamOAuthAdmissionSourceSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("team_invitation"), teamId: z.string().trim().min(1), providerId: z.string().trim().min(1),
        providerOrigin: z.enum(["home", "team"]),
        connectionId: z.string().trim().min(1).nullable(), connectionRevision: z.number().int().positive().nullable(),
        admissionMode: z.literal("invite_only"), invitationId: z.string().trim().min(1),
        tokenHash: z.string().regex(/^[0-9a-f]{64}$/u),
    }).strict(),
    z.object({
        kind: z.literal("team_provisioned_identity"), teamId: z.string().trim().min(1), providerId: z.string().trim().min(1),
        connectionId: z.string().trim().min(1), connectionRevision: z.number().int().positive(),
        admissionMode: z.literal("provisioned"), provisionedIdentityId: z.string().trim().min(1),
    }).strict(),
    z.object({
        kind: z.literal("team_jit_identity"), teamId: z.string().trim().min(1), providerId: z.string().trim().min(1),
        connectionId: z.string().trim().min(1), connectionRevision: z.number().int().positive(),
        admissionMode: z.literal("jit"), authAttemptId: z.string().trim().min(8).max(128),
    }).strict(),
]);

export type TeamOAuthAdmissionSource = z.infer<typeof teamOAuthAdmissionSourceSchema>;
