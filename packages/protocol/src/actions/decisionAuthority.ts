import { evaluateApiTokenGrantV1, type ApiTokenGrantV1 } from '../auth/apiTokenGrant.js';
import type { ActionRequiredAuthority } from './metadata.js';
import type { ActionSpec } from './actionSpecs.js';

export const DECISION_ACTION_IDS = ['approval.request.decide', 'session.permission.respond'] as const;
export const TOKEN_CONVERSATIONAL_INPUT_ACTION_IDS = ['session.user_action.answer'] as const;

/** Account mutations an Agent may request, but only a present user may approve. */
export const AGENT_REQUESTABLE_PRESENT_USER_ACTION_IDS = [
  'account.apiTokens.create', 'account.apiTokens.update', 'account.apiTokens.revoke',
  'account.apiTokens.revokeAll', 'account.security.terminalPresentUser.set',
] as const;

export function isAgentRequestablePresentUserActionId(actionId: string): boolean {
  return (AGENT_REQUESTABLE_PRESENT_USER_ACTION_IDS as readonly string[]).includes(actionId);
}

export function isAgentApprovalRequestSurface(surface: string | null | undefined): boolean {
  return surface === 'agent' || surface === 'mcp';
}

export function canCredentialDecideV1(input: Readonly<{ authority: ActionRequiredAuthority; grant: ApiTokenGrantV1 | null }>): boolean {
  return input.authority === 'present_user' || input.grant?.approve === true;
}

/** Directory recovery consent is a human decision, unlike an ordinary Session open. */
export function requiresPresentUserDecisionForActionInputV1(
  spec: Pick<ActionSpec, 'id' | 'requiredAuthority'>,
  input?: unknown,
): boolean {
  return spec.requiredAuthority === 'present_user'
    || (spec.id === 'session.open' && typeof input === 'object' && input !== null
      && 'approvedNewDirectoryCreation' in input && input.approvedNewDirectoryCreation === true);
}

/** Decisions are opt-in; they never grant token, security, trust or policy authority. */
export function resolveCredentialActionAdmissionV1(input: Readonly<{
  spec: Pick<ActionSpec, 'id' | 'requiredAuthority'>;
  authority: ActionRequiredAuthority;
  grant: ApiTokenGrantV1 | null;
  surface?: string | null;
  hasExternalCredential?: boolean;
  actionInput?: unknown;
}>): { ok: true } | { ok: false; errorCode: 'present_user_required' } {
  if (!requiresPresentUserDecisionForActionInputV1(input.spec, input.actionInput) || input.authority === 'present_user') return { ok: true };
  // Admission here permits requesting consent, never automatic execution.
  // The approval owner enforces a mandatory floor, including persisted waivers.
  if (isAgentApprovalRequestSurface(input.surface) && !input.hasExternalCredential && !input.grant
    && (isAgentRequestablePresentUserActionId(input.spec.id) || input.spec.id === 'session.open')) return { ok: true };
  if ((DECISION_ACTION_IDS as readonly string[]).includes(input.spec.id) && canCredentialDecideV1(input)) return { ok: true };
  if (input.grant && (TOKEN_CONVERSATIONAL_INPUT_ACTION_IDS as readonly string[]).includes(input.spec.id)
    && evaluateApiTokenGrantV1({ grant: { ...input.grant, targets: null }, actionId: input.spec.id }).ok) return { ok: true };
  return { ok: false, errorCode: 'present_user_required' };
}
