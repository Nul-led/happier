import {
    acceptPasswordTextV1,
    decodePasswordCredentialFieldV1,
    PASSWORD_MAX_UTF8_BYTES_V1,
    PasswordEnvelopeKdfV1Schema,
} from '@happier-dev/protocol/auth/accountPasswordCredential';

// The 0.7.16 CJS entry is intentional: its ESM entry references a missing
// sibling module. This narrow external boundary is verified by the browser probe.
const sodiumModule: unknown = require('libsodium-wrappers-sumo');
type PasswordSodium = Readonly<{
    ready: Promise<unknown>;
    libsodium: { useBackupModule: () => never };
    crypto_pwhash_ALG_ARGON2ID13: number;
    crypto_pwhash: (length: number, password: Uint8Array, salt: Uint8Array, opsLimit: number, memLimitBytes: number, algorithm: number) => Uint8Array;
}>;

function loadPasswordSodium(): Promise<PasswordSodium> {
    if (typeof WebAssembly !== 'object' || !sodiumModule || typeof sodiumModule !== 'object'
        || !('ready' in sodiumModule) || !(sodiumModule.ready instanceof Promise)
        || !('libsodium' in sodiumModule) || !sodiumModule.libsodium || typeof sodiumModule.libsodium !== 'object'
        || !('useBackupModule' in sodiumModule.libsodium) || typeof sodiumModule.libsodium.useBackupModule !== 'function') {
        return Promise.reject(new Error('password_kdf_unavailable'));
    }
    // libsodium.js normally falls back to asm.js after a WASM initialization
    // failure. Password KDF must fail closed instead of running a JS fallback.
    sodiumModule.libsodium.useBackupModule = () => { throw new Error('password_kdf_unavailable'); };
    return sodiumModule.ready.then(() => {
        if (!('crypto_pwhash' in sodiumModule) || typeof sodiumModule.crypto_pwhash !== 'function'
            || !('crypto_pwhash_ALG_ARGON2ID13' in sodiumModule) || sodiumModule.crypto_pwhash_ALG_ARGON2ID13 !== 2) {
            throw new Error('password_kdf_unavailable');
        }
        // Runtime checks above narrow the untyped CJS package to the consumed API.
        return sodiumModule as PasswordSodium;
    });
}

const sodiumReady = loadPasswordSodium();
// Report failure only to the captured request, without an unhandled rejection.
void sodiumReady.catch(() => {});
const worker = globalThis as unknown as {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

worker.onmessage = async ({ data }) => {
    let password: Uint8Array | undefined;
    let validatedPassword: Uint8Array | undefined;
    let key: Uint8Array | undefined;
    try {
        if (!data || typeof data !== 'object' || Object.keys(data).length !== 2
            || !('password' in data) || !(data.password instanceof Uint8Array)
            || data.password.byteLength > PASSWORD_MAX_UTF8_BYTES_V1 || !('kdf' in data)) {
            throw new Error('password_kdf_invalid');
        }
        password = data.password;
        const kdf = PasswordEnvelopeKdfV1Schema.parse(data.kdf);
        // Password bytes are already validated by the caller. Preserve a leading
        // U+FEFF rather than treating its UTF-8 encoding as a transport BOM:
        // it is valid password text and must derive the same bytes as native.
        const accepted = acceptPasswordTextV1(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(password));
        if (!accepted.accepted) throw new Error('password_text_rejected');
        validatedPassword = accepted.utf8;
        const sodium = await sodiumReady;
        key = sodium.crypto_pwhash(32, validatedPassword, decodePasswordCredentialFieldV1(kdf.salt), kdf.opsLimit, kdf.memLimitBytes, sodium.crypto_pwhash_ALG_ARGON2ID13);
        if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw new Error('password_kdf_unavailable');
        worker.postMessage({ ok: true, key });
    } catch {
        worker.postMessage({ ok: false });
    } finally {
        password?.fill(0);
        validatedPassword?.fill(0);
        key?.fill(0);
    }
};
