import { z } from 'zod';

/**
 * Dependency-light owner for rejection codes shared by Session input and
 * Session creation settlement. Keeping this leaf outside the full admission
 * graph prevents Action-spec imports from forming an initialization cycle.
 */
export const SESSION_INPUT_ADMISSION_REJECTION_CODES_V1 = [
  'session_input_invalid',
  'session_input_archived',
  'session_input_unauthorized',
  'session_input_target_unavailable',
  'session_input_target_update_required',
  'session_input_cancelled',
  'session_input_untrusted_assertion',
  'session_input_idempotency_conflict',
  'session_input_source_authority_mismatch',
  'session_input_permission_ceiling_rejected',
  'session_input_encryption_mode_mismatch',
] as const;

export const SessionInputAdmissionRejectionCodeV1Schema = z.enum(
  SESSION_INPUT_ADMISSION_REJECTION_CODES_V1,
);
export type SessionInputAdmissionRejectionCodeV1 = z.infer<
  typeof SessionInputAdmissionRejectionCodeV1Schema
>;
