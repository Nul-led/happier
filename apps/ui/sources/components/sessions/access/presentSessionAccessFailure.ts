import type { SessionAccessErrorCodeV1 } from '@happier-dev/protocol';
import { SessionAccessApiError } from '@/sync/api/session/sessionAccessApi';
import { t } from '@/text';
import { HappyError } from '@/utils/errors/errors';

import type { SessionAccessUiError, SessionAccessUiReason } from './sessionAccessEditorTypes';

function sessionAccessFailureMessage(code: string, status?: number): string {
    switch (code) {
        case 'session_access_external_sharing_disabled':
            return `${t('teams.settings.externalSharingSection')}: ${t('teams.policy.externalSharingDisabled')}`;
        case 'session_access_external_sharing_requires_team_admin':
            return `${t('teams.settings.externalSharingSection')}: ${t('teams.policy.externalSharingAdmins')}`;
        case 'session_access_team_policy_required':
            return t('session.access.teamPolicyRequired');
        // A manager cannot change their own direct grant. That is an ordinary,
        // explainable row state, so it must never surface as a generic failure.
        case 'session_access_self_grant_invalid':
            return t('session.access.selfGrantManaged');
        case 'session_access_subject_not_found':
            return t('session.access.subjectNotFound');
        case 'session_access_subject_ineligible':
            return t('session.access.subjectIneligible');
        case 'session_access_transcript_not_shareable':
            return t('session.access.transcriptNotShareable');
        case 'session_access_authentication_required':
            return t('session.access.authenticationRequired');
        case 'session_access_authentication_unavailable':
            return t('session.access.authenticationUnavailable');
        case 'recipient_key_unavailable':
        case 'recipient_envelope_required':
            return t('session.access.setup');
        case 'session_access_invalid_recipient_envelope':
            return t('session.access.repair');
        case 'data_key_not_required':
            return t('session.access.unavailable');
        // The Home, not the content, is the missing capability here: this Session
        // is otherwise usable and the person needs an update/availability reason.
        case 'unsupported_action':
            return t('session.access.homeUnsupported');
        // The canonical transport now names an ambiguous mutation outcome, so
        // the typed code and the untyped transport loss below share one copy.
        case 'outcome_unknown':
            return t('session.access.outcomeUnknown');
        default:
            return t(status === 403 || code === 'session_access_forbidden'
                ? 'errors.permissionDenied'
                : 'errors.operationFailed');
    }
}

/** The same typed copy owner is used for server failures and disabled row controls. */
export function presentSessionAccessReason(code: SessionAccessErrorCodeV1): SessionAccessUiReason {
    return { code, message: sessionAccessFailureMessage(code) };
}

/** One presentation mapping for grant, context, and public-link access failures. */
export function presentSessionAccessFailure(
    error: unknown,
    options?: Readonly<{ outcomeUnknown?: boolean }>,
): SessionAccessUiError {
    if (options?.outcomeUnknown && !(error instanceof SessionAccessApiError) && !(error instanceof HappyError)) {
        return { code: 'outcome_unknown', message: t('session.access.outcomeUnknown'), retryable: true };
    }
    if (error instanceof SessionAccessApiError) {
        const message = sessionAccessFailureMessage(error.code, error.status);
        const terminal = error.status === 403 || error.status === 404 || error.status === 409
            || error.code === 'session_access_subject_ineligible'
            || error.code === 'session_access_owner_grant_invalid'
            || error.code === 'session_access_self_grant_invalid'
            || error.code === 'session_access_permission_delegation_forbidden'
            || error.code === 'session_access_permission_delegation_requires_edit'
            || error.code === 'session_access_team_policy_required'
            || error.code === 'session_access_transcript_not_shareable'
            || error.code === 'session_access_authentication_required'
            || error.code === 'session_access_authentication_unavailable'
            || error.code === 'session_access_external_sharing_requires_team_admin'
            || error.code === 'session_access_external_sharing_disabled'
            || error.code === 'session_access_invalid_recipient_envelope'
            || error.code === 'invalid_request'
            || error.code === 'data_key_not_required'
            || error.code === 'recipient_envelope_required'
            || error.code === 'recipient_key_unavailable'
            || error.code === 'unsupported_action';
        return { code: error.code, message, retryable: !terminal };
    }
    if (error instanceof HappyError) {
        return { code: error.code ?? 'session_access_failed', message: error.message, retryable: error.canTryAgain };
    }
    return { code: 'session_access_failed', message: t('errors.operationFailed'), retryable: true };
}
