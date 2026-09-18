import { z } from "zod";

import { TeamIdSchema } from "../membership.js";
import {
  TeamIdentityConnectionIdSchema,
  TeamIdentityConnectionMutationResultV1Schema,
  TeamIdentityConnectionV1Schema,
} from "./connection.js";

export const TeamIdentityWorkosConnectionCreateInputV1Schema = z.object({
  v: z.literal(1),
  teamId: TeamIdSchema,
}).strict();
export type TeamIdentityWorkosConnectionCreateInputV1 = z.infer<typeof TeamIdentityWorkosConnectionCreateInputV1Schema>;
export const TeamIdentityWorkosConnectionCreateResultV1Schema = TeamIdentityConnectionMutationResultV1Schema;
export type TeamIdentityWorkosConnectionCreateResultV1 = z.infer<typeof TeamIdentityWorkosConnectionCreateResultV1Schema>;

export const TeamIdentityWorkosAdminPortalLinkCreateInputV1Schema = z.object({
  v: z.literal(1),
  teamId: TeamIdSchema,
  connectionId: TeamIdentityConnectionIdSchema,
  directorySourceId: z.string().min(1).max(256).optional(),
  intent: z.enum(["sso", "dsync"]),
}).strict();
export type TeamIdentityWorkosAdminPortalLinkCreateInputV1 = z.infer<typeof TeamIdentityWorkosAdminPortalLinkCreateInputV1Schema>;

export const TeamIdentityWorkosAdminPortalLinkCreateResultV1Schema = z.object({
  url: z.url(),
}).strict();
export type TeamIdentityWorkosAdminPortalLinkCreateResultV1 = z.infer<typeof TeamIdentityWorkosAdminPortalLinkCreateResultV1Schema>;

export const TeamIdentityWorkosReconcileInputV1Schema = z.object({
  v: z.literal(1),
  teamId: TeamIdSchema,
  connectionId: TeamIdentityConnectionIdSchema,
  expectedRevision: z.number().int().positive(),
}).strict();
export type TeamIdentityWorkosReconcileInputV1 = z.infer<typeof TeamIdentityWorkosReconcileInputV1Schema>;

export const TeamIdentityWorkosConnectionCandidateV1Schema = z.object({
  connectionId: z.string().min(1).max(512),
  displayName: z.string().min(1).max(256),
  strategy: z.string().min(1).max(256),
  status: z.string().min(1).max(256),
}).strict();
export type TeamIdentityWorkosConnectionCandidateV1 = z.infer<typeof TeamIdentityWorkosConnectionCandidateV1Schema>;

export const TeamIdentityWorkosReconcileResultV1Schema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("setting_up"), connection: TeamIdentityConnectionV1Schema }).strict(),
  z.object({ outcome: z.literal("connected"), connection: TeamIdentityConnectionV1Schema }).strict(),
  z.object({ outcome: z.literal("needs_attention"), connection: TeamIdentityConnectionV1Schema }).strict(),
  z.object({
    outcome: z.literal("selection_required"),
    connection: TeamIdentityConnectionV1Schema,
    candidates: z.array(TeamIdentityWorkosConnectionCandidateV1Schema).min(2),
  }).strict(),
]);
export type TeamIdentityWorkosReconcileResultV1 = z.infer<typeof TeamIdentityWorkosReconcileResultV1Schema>;

export const TeamIdentityWorkosConnectionSetInputV1Schema = z.object({
  v: z.literal(1),
  teamId: TeamIdSchema,
  connectionId: TeamIdentityConnectionIdSchema,
  expectedRevision: z.number().int().positive(),
  workosConnectionId: z.string().min(1).max(512),
}).strict();
export type TeamIdentityWorkosConnectionSetInputV1 = z.infer<typeof TeamIdentityWorkosConnectionSetInputV1Schema>;
