import type { AccountApiTokenSummaryV1 } from '@happier-dev/protocol';

import type { StatusPillVariant } from '@/components/ui/status/StatusPill';
import type { TranslationKeyNoParams } from '@/text';

import type { ApiTokenSettingsErrorCode } from './apiTokenSettingsController';

export type ApiTokenListPresentation = 'skeleton' | 'list' | 'listWithRetry' | 'empty' | 'emptyWithRetry' | 'error';

export function resolveApiTokenListPresentation(state: Readonly<{
    phase: 'idle' | 'loading' | 'ready' | 'error';
    tokens: readonly unknown[];
    isRefreshing: boolean;
    listError?: string | null;
}>): ApiTokenListPresentation {
    if ((state.phase === 'idle' || state.phase === 'loading') && state.tokens.length === 0) return 'skeleton';
    if (state.tokens.length > 0) return state.listError ? 'listWithRetry' : 'list';
    if (state.phase === 'error') return 'error';
    return state.listError ? 'emptyWithRetry' : 'empty';
}

export type ApiTokenRowPresentation = Readonly<{
    token: AccountApiTokenSummaryV1;
    displayPrefix: string;
    status: 'active' | 'expired';
    statusVariant: StatusPillVariant;
    encryptionAccess: 'enabled' | 'bearerOnly';
    unattendedTeamAccess: 'authorized' | 'notAuthorized';
}>;

export function buildApiTokenRowPresentation(params: Readonly<{
    token: ApiTokenRowPresentation['token'];
    nowMs: number;
}>): ApiTokenRowPresentation {
    const expiresAtMs = params.token.expiresAt ? Date.parse(params.token.expiresAt) : null;
    const expired = expiresAtMs !== null && expiresAtMs <= params.nowMs;
    return {
        token: params.token,
        displayPrefix: `${params.token.displayPrefix}…`,
        status: expired ? 'expired' : 'active',
        statusVariant: expired ? 'neutral' : 'success',
        encryptionAccess: params.token.hasEncryptionAccess ? 'enabled' : 'bearerOnly',
        unattendedTeamAccess: params.token.hasUnattendedTeamAccess ? 'authorized' : 'notAuthorized',
    };
}

export function resolveApiTokenOperationErrorMessageKey(error: ApiTokenSettingsErrorCode | null): TranslationKeyNoParams {
    if (error === 'unsupported') return 'settingsApiTokens.encryption.unsupported';
    if (error === 'api_token_encryption_not_ready') return 'settingsApiTokens.encryption.notReady';
    if (error === 'api_token_encryption_stale') return 'settingsApiTokens.encryption.stale';
    if (error === 'api_token_id_conflict') return 'settingsApiTokens.encryption.idConflict';
    if (error === 'credential_authentication_evidence_limit') return 'settingsApiTokens.unattended.evidenceLimit';
    if (error === 'credential_authentication_evidence_unavailable') return 'settingsApiTokens.unattended.evidenceUnavailable';
    if (error === 'outcome_unknown') return 'settingsApiTokens.encryption.outcomeUnknown';
    if (error === 'label_required') return 'settingsApiTokens.errors.labelRequired';
    if (error === 'present_user_required') return 'settingsApiTokens.errors.presentUserRequired';
    if (error === 'network_error') {
        return 'settingsApiTokens.errors.offline';
    }
    return 'settingsApiTokens.errors.unavailable';
}
