import { z } from 'zod';

/**
 * Typed Home-governance denials and conflicts.
 *
 * These are decided by the mutation's own transaction, not by a projected
 * capability, so a client that raced a role or lifecycle change receives an
 * actionable outcome instead of a generic failure.
 */
export const HomeGovernanceErrorCodeV1Schema = z.enum([
  /** The actor's current role/status does not permit this operation. */
  'home_governance_forbidden',
  /** The Home has no active owner and requires deployment-local recovery. */
  'home_governance_setup_required',
  /** The Home would be left with no active owner. */
  'home_owner_transfer_required',
  /** A Team would be left with no active owner. Decided by the Team owner. */
  'team_owner_transfer_required',
  /** The policy changed since the editor loaded it. */
  'home_policy_revision_conflict',
  /** The submitted policy is structurally or referentially unusable. */
  'home_policy_invalid',
  /** The submitted Home-governance request does not match its strict input schema. */
  'invalid_home_input',
  /** A page cursor is malformed or belongs to another query. */
  'invalid_home_cursor',
  /** The target Account does not exist on this Home. */
  'home_account_not_found',
  /** The target Account is not active and cannot receive this authority. */
  'home_account_inactive',
  /** Replacement would collide with an existing membership of the same Team. */
  'team_membership_transfer_conflict',
  /** Access was revoked but cleanup did not finish; the request is retryable. */
  'account_erasure_incomplete',
]);

export type HomeGovernanceErrorCodeV1 = z.infer<typeof HomeGovernanceErrorCodeV1Schema>;

export const HomeGovernanceErrorV1Schema = z.object({
  error: HomeGovernanceErrorCodeV1Schema,
}).strict();

export type HomeGovernanceErrorV1 = z.infer<typeof HomeGovernanceErrorV1Schema>;

/**
 * The single Home-governance code → HTTP status mapping.
 *
 * Routes and clients both consume this owner so a validation error, authority
 * refusal, missing Account, or state conflict cannot acquire a second category
 * while crossing the Action transport.
 */
export function homeGovernanceErrorHttpStatusV1(
  code: HomeGovernanceErrorCodeV1,
): 400 | 403 | 404 | 409 {
  switch (code) {
    case 'invalid_home_input':
    case 'home_policy_invalid':
    case 'invalid_home_cursor':
      return 400;
    case 'home_governance_forbidden':
      return 403;
    case 'home_account_not_found':
      return 404;
    case 'home_account_inactive':
    case 'home_governance_setup_required':
    case 'home_owner_transfer_required':
    case 'team_owner_transfer_required':
    case 'home_policy_revision_conflict':
    case 'team_membership_transfer_conflict':
    case 'account_erasure_incomplete':
      return 409;
  }
}
