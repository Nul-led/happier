import {
    acceptPasswordTextV1,
    PasswordEnvelopeKdfV1Schema,
    type PasswordEnvelopeKdfV1,
} from '@happier-dev/protocol/auth/accountPasswordCredential';

export type PasswordEnvelopeKeyInput = Readonly<{
    password: string;
    kdf: PasswordEnvelopeKdfV1;
    signal?: AbortSignal;
}>;

export function passwordDerivationAborted(): Error {
    const error = new Error('password_derivation_cancelled');
    error.name = 'AbortError';
    return error;
}

export function assertPasswordDerivationCurrent(signal?: AbortSignal): void {
    if (signal?.aborted) throw passwordDerivationAborted();
}

/** Only these exact UTF-8 bytes may cross either platform worker boundary. */
export function preparePasswordKdfInput(input: PasswordEnvelopeKeyInput): Readonly<{
    password: Uint8Array;
    kdf: PasswordEnvelopeKdfV1;
}> {
    assertPasswordDerivationCurrent(input.signal);
    const parsed = PasswordEnvelopeKdfV1Schema.safeParse(input.kdf);
    if (!parsed.success) throw new Error('password_kdf_invalid');
    const accepted = acceptPasswordTextV1(input.password);
    if (!accepted.accepted) throw new Error('password_text_rejected');
    return { password: accepted.utf8, kdf: parsed.data };
}
