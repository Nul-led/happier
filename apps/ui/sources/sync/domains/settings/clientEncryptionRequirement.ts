import {
    combineClientEncryptionRequirements,
    isAccountEncryptionModeAllowedByClientRequirement,
    isSessionEncryptionModeAllowedByClientRequirement,
    type ClientEncryptionRequirement,
} from '@happier-dev/protocol';

type SyncedClientEncryptionRequirementSettings = Readonly<{
    clientEncryptionRequirementV1?: ClientEncryptionRequirement;
}>;

type LocalClientEncryptionRequirementSettings = Readonly<{
    clientEncryptionRequirementLocalV1?: ClientEncryptionRequirement;
}>;

export function resolveUiClientEncryptionRequirement(params: Readonly<{
    syncedSettings: SyncedClientEncryptionRequirementSettings;
    localSettings: LocalClientEncryptionRequirementSettings;
}>): ClientEncryptionRequirement {
    return combineClientEncryptionRequirements(
        params.syncedSettings.clientEncryptionRequirementV1 ?? 'follow_account',
        params.localSettings.clientEncryptionRequirementLocalV1 ?? 'follow_account',
    );
}

export function assertUiAccountEncryptionModeAllowed(params: Readonly<{
    mode: 'e2ee' | 'plain';
    syncedSettings: SyncedClientEncryptionRequirementSettings;
    localSettings: LocalClientEncryptionRequirementSettings;
}>): void {
    if (isAccountEncryptionModeAllowedByClientRequirement(
        resolveUiClientEncryptionRequirement(params),
        params.mode,
    )) return;
    throw Object.assign(
        new Error('This Happier client requires end-to-end encryption, but the Account settings are stored as plaintext.'),
        { code: 'CLIENT_E2EE_REQUIRED', retryable: false },
    );
}

export function isUiSessionEncryptionModeAllowed(params: Readonly<{
    mode: 'e2ee' | 'plain';
    requirement: ClientEncryptionRequirement;
}>): boolean {
    return isSessionEncryptionModeAllowedByClientRequirement(params.requirement, params.mode);
}

export function assertUiSessionEncryptionModeAllowed(params: Readonly<{
    mode: 'e2ee' | 'plain';
    requirement: ClientEncryptionRequirement;
}>): void {
    if (isUiSessionEncryptionModeAllowed(params)) return;
    throw Object.assign(
        new Error('This Happier client requires end-to-end encryption and will not use a plaintext Session.'),
        { code: 'CLIENT_E2EE_REQUIRED', retryable: false },
    );
}
