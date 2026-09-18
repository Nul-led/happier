import { z } from 'zod';

import { SessionAccessLevelV1Schema } from './sessionAccessGrantV1.js';

/** Released Account profile projected by the direct Session-sharing routes. */
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

/** Exact released direct-share row returned by list/create/update. */
export const ReleasedDirectSessionShareV1Schema = z.object({
  id: z.string(),
  sharedWithUser: ReleasedDirectSessionShareProfileV1Schema,
  accessLevel: SessionAccessLevelV1Schema,
  canApprovePermissions: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
export type ReleasedDirectSessionShareV1 = z.infer<
  typeof ReleasedDirectSessionShareV1Schema
>;

/** Exact released POST body. Semantic encrypted-key requirements remain route-owned. */
export const ReleasedDirectSessionShareCreateRequestV1Schema = z.object({
  userId: z.string(),
  accessLevel: SessionAccessLevelV1Schema,
  canApprovePermissions: z.boolean().optional(),
  encryptedDataKey: z.string().optional(),
}).strict();
export type ReleasedDirectSessionShareCreateRequestV1 = z.infer<
  typeof ReleasedDirectSessionShareCreateRequestV1Schema
>;

/** Exact released PATCH body. Omitted fields retain their stored values. */
export const ReleasedDirectSessionSharePatchRequestV1Schema = z.object({
  accessLevel: SessionAccessLevelV1Schema.optional(),
  canApprovePermissions: z.boolean().optional(),
}).strict();
export type ReleasedDirectSessionSharePatchRequestV1 = z.infer<
  typeof ReleasedDirectSessionSharePatchRequestV1Schema
>;

export const ReleasedDirectSessionShareResponseV1Schema = z.object({
  share: ReleasedDirectSessionShareV1Schema,
}).strict();
export type ReleasedDirectSessionShareResponseV1 = z.infer<
  typeof ReleasedDirectSessionShareResponseV1Schema
>;

export const ReleasedDirectSessionSharesResponseV1Schema = z.object({
  shares: z.array(ReleasedDirectSessionShareV1Schema),
}).strict();
export type ReleasedDirectSessionSharesResponseV1 = z.infer<
  typeof ReleasedDirectSessionSharesResponseV1Schema
>;

export const ReleasedDirectSessionShareDeleteResponseV1Schema = z.object({
  success: z.literal(true),
}).strict();
export type ReleasedDirectSessionShareDeleteResponseV1 = z.infer<
  typeof ReleasedDirectSessionShareDeleteResponseV1Schema
>;
