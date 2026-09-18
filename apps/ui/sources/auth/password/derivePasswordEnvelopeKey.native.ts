import { decodePasswordCredentialFieldV1 } from '@happier-dev/protocol/auth/accountPasswordCredential';
import { encodeBase64 } from '@/encryption/base64';
import { derivePasswordEnvelopeKey as deriveNativePasswordEnvelopeKey } from '@/sync/encryption/nativeCryptoWorker/nativeCryptoWorker.native';
import { preparePasswordKdfInput, type PasswordEnvelopeKeyInput } from './passwordKdfInput';

export async function derivePasswordEnvelopeKey(input: PasswordEnvelopeKeyInput): Promise<Uint8Array> {
    const prepared = preparePasswordKdfInput(input);
    try {
        return await deriveNativePasswordEnvelopeKey({
            passwordBase64: encodeBase64(prepared.password),
            saltBase64: encodeBase64(decodePasswordCredentialFieldV1(prepared.kdf.salt)),
            opsLimit: prepared.kdf.opsLimit,
            memLimitBytes: prepared.kdf.memLimitBytes,
            outputBytes: prepared.kdf.outputBytes,
        }, input.signal);
    } finally {
        prepared.password.fill(0);
    }
}
