import type { AccountEncryptionCurrentnessResponse } from '@happier-dev/protocol';

/**
 * Canonical plain-Account currentness response for UI boundary harnesses.
 * Plain Accounts intentionally have no recipient encryption envelope.
 */
export function createPlainAccountEncryptionCurrentnessFixture(input: Readonly<{
    version?: number;
    settingsVersion?: number;
    updatedAt?: number;
}> = {}): AccountEncryptionCurrentnessResponse {
    return Object.freeze({
        mode: 'plain',
        version: input.version ?? 1,
        ...(input.settingsVersion === undefined ? {} : { settingsVersion: input.settingsVersion }),
        signingKeyFingerprint: null,
        contentKeyFingerprint: null,
        updatedAt: input.updatedAt ?? 1,
        recipientEnvelopeReadiness: Object.freeze({
            status: 'unavailable',
            reason: 'plain_account',
        }),
    });
}
