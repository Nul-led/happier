import { z } from 'zod';
import { PrincipalRefV1Schema, TeamPrincipalRefV1Schema, GroupPrincipalRefV1Schema } from '../../teams/principal.js';
import { SessionAccessGrantV1Schema, SessionAccessLevelV1Schema, SessionGrantMutationV1Schema, type SessionAccessLevelV1 } from './sessionAccessGrantV1.js';
import { SessionAccessAccountSummaryV1Schema } from './sessionAccessPrincipalV1.js';
import {
  gainsSessionAccessDelegationCapabilityV1,
  SessionEffectiveAccessV1Schema,
  type SessionAccessGrantCapabilityValueV1,
} from './sessionEffectiveAccessV1.js';
import {
  SESSION_RESPONSIBILITY_ASSIGNEE_UNAVAILABLE_V1,
  SESSION_RESPONSIBILITY_CANDIDATES_INVALID_CURSOR_V1,
} from './sessionResponsibilityV1.js';

export const SessionAccessErrorCodeV1Schema = z.enum([
  'session_access_forbidden', 'session_access_session_not_found',
  'session_access_subject_not_found', 'session_access_subject_ineligible',
  'session_access_owner_grant_invalid', 'session_access_self_grant_invalid',
  'session_access_permission_delegation_forbidden', 'session_access_permission_delegation_requires_edit',
  'session_access_team_policy_required',
  'session_initial_access_creator_mismatch',
  'session_access_authentication_required',
  'session_access_authentication_unavailable',
  'session_access_external_sharing_requires_team_admin',
  'session_access_external_sharing_disabled',
  'session_access_invalid_recipient_envelope',
  SESSION_RESPONSIBILITY_ASSIGNEE_UNAVAILABLE_V1,
  SESSION_RESPONSIBILITY_CANDIDATES_INVALID_CURSOR_V1,
  'invalid_request', 'data_key_not_required',
  'recipient_envelope_required', 'recipient_key_unavailable',
]);
export type SessionAccessErrorCodeV1 = z.infer<typeof SessionAccessErrorCodeV1Schema>;

export const SessionAccessPrincipalSummaryV1Schema = z.discriminatedUnion('kind', [
  SessionAccessAccountSummaryV1Schema,
  TeamPrincipalRefV1Schema.extend({ name: z.string() }).strict(),
  GroupPrincipalRefV1Schema.extend({ name: z.string(), teamName: z.string() }).strict(),
]);
export type SessionAccessPrincipalSummaryV1 = z.infer<typeof SessionAccessPrincipalSummaryV1Schema>;

export const SessionAccessGrantTransitionsV1Schema = z.object({
  accessLevels: z.array(SessionAccessLevelV1Schema),
  canChangePermissionDelegation: z.boolean(),
  canRemove: z.boolean(),
  reason: SessionAccessErrorCodeV1Schema.optional(),
}).strict();
export type SessionAccessGrantTransitionsV1 = z.infer<typeof SessionAccessGrantTransitionsV1Schema>;

const SESSION_ACCESS_LEVEL_ORDER: readonly SessionAccessLevelV1[] = SessionAccessLevelV1Schema.options;

/**
 * A grant increase is any transition that admits more access than the stored
 * grant: a first grant, a higher level, or newly gained permission delegation.
 * Tightening or withdrawing is never an increase, so it stays available under a
 * policy that has since become more restrictive.
 */
export function isSessionAccessGrantIncreaseV1(
  previous: SessionAccessGrantCapabilityValueV1 | null,
  next: SessionAccessGrantCapabilityValueV1,
): boolean {
  if (previous === null) return true;
  return SESSION_ACCESS_LEVEL_ORDER.indexOf(next.accessLevel) > SESSION_ACCESS_LEVEL_ORDER.indexOf(previous.accessLevel)
    || (!previous.canApprovePermissions && next.canApprovePermissions);
}

export type SessionAccessGrantTransitionsInputV1 = Readonly<{
  current: SessionAccessGrantCapabilityValueV1;
  /** The actor holds `managePermissionDelegation`, so transitions that create it are offered. */
  canDelegate: boolean;
  /** A Team-policy floor cannot be weakened to `view` or removed while the policy still requires it. */
  requiredByTeamPolicy: boolean;
  /** The subject failed grant eligibility: no transition is offered and the code explains why. */
  ineligible?: SessionAccessErrorCodeV1;
  /** The primary Team's external-sharing policy refuses this external subject any increase. */
  externalSharing?: SessionAccessErrorCodeV1;
}>;

/**
 * The one projection of which grant transitions a write would admit.
 *
 * Every input is a verdict already owned elsewhere (eligibility, Team-policy floor,
 * delegation authority, external-sharing policy); this function only composes them
 * into the affordances a client may offer, so a server inspection and a client
 * adapter for a released server cannot drift in what they let a manager attempt.
 */
export function projectSessionAccessGrantTransitionsV1(
  input: SessionAccessGrantTransitionsInputV1,
): SessionAccessGrantTransitionsV1 {
  if (input.ineligible) {
    return { accessLevels: [], canChangePermissionDelegation: false, canRemove: false, reason: input.ineligible };
  }
  const { current } = input;
  const admits = (next: SessionAccessGrantCapabilityValueV1) =>
    (input.canDelegate || !gainsSessionAccessDelegationCapabilityV1(current, next))
    && (!input.externalSharing || !isSessionAccessGrantIncreaseV1(current, next));
  const accessLevels = SESSION_ACCESS_LEVEL_ORDER.filter((accessLevel) =>
    (!input.requiredByTeamPolicy || accessLevel !== 'view' || current.accessLevel === 'view')
    && admits({ accessLevel, canApprovePermissions: accessLevel === 'view' ? false : current.canApprovePermissions }));
  const canChangePermissionDelegation = current.accessLevel !== 'view'
    && admits({ accessLevel: current.accessLevel, canApprovePermissions: !current.canApprovePermissions });
  const reason = input.externalSharing
    ?? (input.requiredByTeamPolicy ? ('session_access_team_policy_required' as const) : undefined);
  return {
    accessLevels,
    canChangePermissionDelegation,
    canRemove: !input.requiredByTeamPolicy,
    ...(reason ? { reason } : {}),
  };
}

export const SessionAccessGrantRowV1Schema = z.object({
  grant: SessionAccessGrantV1Schema,
  principal: SessionAccessPrincipalSummaryV1Schema,
  allowedTransitions: SessionAccessGrantTransitionsV1Schema,
}).strict();
export type SessionAccessGrantRowV1 = z.infer<typeof SessionAccessGrantRowV1Schema>;

export const SessionAccessGrantsListRequestV1Schema = z.object({ sessionId: z.string().min(1) }).strict();
export type SessionAccessGrantsListRequestV1 = z.infer<typeof SessionAccessGrantsListRequestV1Schema>;

/**
 * One Team credential selection this Session keeps only while the named Team
 * still holds the standing it has now.
 *
 * `policy` says which standing: `team_visibility_required` ends when that Team's
 * grant is removed, `team_context_required` ends when the Session's context
 * moves off that Team. Carrying it lets one projection serve both edits without
 * either confirmation claiming a consequence the other one causes.
 *
 * It is a consequence preview, never an admission fact: the credential admission
 * repeats every decision in its own transaction and still fails closed. Only the
 * resource's display name travels, so an access edit can say what stops working
 * without disclosing the credential itself.
 */
export const SessionTeamCredentialBindingConsequenceV1Schema = z.object({
  resourceId: z.string().min(1),
  teamId: z.string().min(1),
  displayName: z.string(),
  policy: z.enum(['team_visibility_required', 'team_context_required']),
}).strict();
export type SessionTeamCredentialBindingConsequenceV1 = z.infer<typeof SessionTeamCredentialBindingConsequenceV1Schema>;

const listFields = {
  owner: SessionAccessAccountSummaryV1Schema,
  effectiveAccess: SessionEffectiveAccessV1Schema,
  primaryTeamId: z.string().min(1).nullable(),
};
export const SessionAccessGrantsListResponseV1Schema = z.discriminatedUnion('visibility', [
  z.object({
    ...listFields,
    visibility: z.literal('complete'),
    grants: z.array(SessionAccessGrantRowV1Schema),
    // Manager-only, and absent on a Home that publishes no consequence preview.
    // A viewer who cannot manage access can neither remove a grant nor change
    // the context, so the `self` projection carries nothing to preview.
    credentialBindingConsequences: z.array(SessionTeamCredentialBindingConsequenceV1Schema).optional(),
  }).strict(),
  z.object({ ...listFields, visibility: z.literal('self'), grants: z.tuple([]) }).strict(),
]);
export type SessionAccessGrantsListResponseV1 = z.infer<typeof SessionAccessGrantsListResponseV1Schema>;

export const SetSessionAccessGrantRequestV1Schema = z.object({
  sessionId: z.string().min(1),
  ...SessionGrantMutationV1Schema.options[0].shape,
  subject: PrincipalRefV1Schema,
}).strict().superRefine(({ sessionId: _sessionId, ...grant }, ctx) => {
  const parsed = SessionGrantMutationV1Schema.safeParse(grant);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});
export type SetSessionAccessGrantRequestV1 = z.infer<typeof SetSessionAccessGrantRequestV1Schema>;
export const SetSessionAccessGrantResponseV1Schema = z.object({
  changed: z.boolean(), grant: SessionAccessGrantV1Schema,
}).strict();
export type SetSessionAccessGrantResponseV1 = z.infer<typeof SetSessionAccessGrantResponseV1Schema>;

export const RemoveSessionAccessGrantRequestV1Schema = z.object({
  sessionId: z.string().min(1), subject: PrincipalRefV1Schema,
}).strict();
export type RemoveSessionAccessGrantRequestV1 = z.infer<typeof RemoveSessionAccessGrantRequestV1Schema>;
export const RemoveSessionAccessGrantResponseV1Schema = z.object({
  changed: z.boolean(), subject: PrincipalRefV1Schema,
}).strict();
export type RemoveSessionAccessGrantResponseV1 = z.infer<typeof RemoveSessionAccessGrantResponseV1Schema>;

export const SetSessionAccessContextRequestV1Schema = z.object({
  sessionId: z.string().min(1), primaryTeamId: z.string().min(1).nullable(),
}).strict();
export type SetSessionAccessContextRequestV1 = z.infer<typeof SetSessionAccessContextRequestV1Schema>;
export const SetSessionAccessContextResponseV1Schema = z.object({
  changed: z.boolean(), primaryTeamId: z.string().min(1).nullable(),
}).strict();
export type SetSessionAccessContextResponseV1 = z.infer<typeof SetSessionAccessContextResponseV1Schema>;
