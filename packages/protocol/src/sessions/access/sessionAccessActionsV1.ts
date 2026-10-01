import { z } from 'zod';

import { PrincipalRefV1Schema } from '../../teams/principal.js';
import { SessionAccessLevelV1Schema, SessionGrantIntentV1Schema } from './sessionAccessGrantV1.js';
import { RequiredSessionTeamCredentialV1Schema, SessionAccessGrantsListRequestV1Schema } from './sessionAccessOperationsV1.js';

/** Public logical input: recipient envelopes are materialized by the host crypto owner. */
export const SessionAccessGrantSetActionInputV1Schema = z.object({
  ...SessionAccessGrantsListRequestV1Schema.shape,
  subject: PrincipalRefV1Schema,
  accessLevel: SessionAccessLevelV1Schema,
  canApprovePermissions: z.boolean(),
  requiredTeamCredential: RequiredSessionTeamCredentialV1Schema.optional(),
}).strict().superRefine(({ sessionId: _sessionId, requiredTeamCredential: _requiredTeamCredential, ...grant }, context) => {
  const parsed = SessionGrantIntentV1Schema.safeParse(grant);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});

export const SessionPublicLinkCreateActionInputV1Schema = z.object({
  ...SessionAccessGrantsListRequestV1Schema.shape,
  expiresAt: z.number().optional(),
  maxUses: z.number().int().positive().optional(),
  isConsentRequired: z.boolean().optional(),
}).strict();

/**
 * Publication settings may be observed by automation; the bearer and wrapped
 * key may not.
 *
 * `id` and `updatedAt` are publication metadata, not bearer identity. Public
 * reads can mutate `updatedAt`, and token rotation keeps the row `id`, so
 * neither field individually authenticates device-held bearer material. A UI
 * may retain its local bearer across a field-for-field identical settings
 * refresh as a continuity heuristic; the server remains the bearer authority.
 * Ambiguous create/rotate settlement belongs to the physical request
 * executor's exact value-idempotent replay.
 */
export const SessionPublicLinkSettingsV1Schema = z.object({
  id: z.string().min(1),
  expiresAt: z.number().nullable(),
  maxUses: z.number().int().positive().nullable(),
  useCount: z.number().int().nonnegative(),
  isConsentRequired: z.boolean(),
  updatedAt: z.number(),
}).strict();
export type SessionPublicLinkSettingsV1 = z.infer<typeof SessionPublicLinkSettingsV1Schema>;
export const SessionPublicLinkGetActionResultV1Schema = SessionPublicLinkSettingsV1Schema.nullable();
export const SessionPublicLinkRemoveActionResultV1Schema = z.object({ changed: z.boolean() }).strict();

/** The released owner route is additive; project only explicitly public settings. */
export function projectSessionPublicLinkActionResultV1(value: unknown): SessionPublicLinkSettingsV1 | null {
  const response = z.object({
    publicShare: SessionPublicLinkSettingsV1Schema.loose().nullable(),
  }).loose().parse(value);
  if (response.publicShare === null) return null;
  const { id, expiresAt, maxUses, useCount, isConsentRequired, updatedAt } = response.publicShare;
  return { id, expiresAt, maxUses, useCount, isConsentRequired, updatedAt };
}
