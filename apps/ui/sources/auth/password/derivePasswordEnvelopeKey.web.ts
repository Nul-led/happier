import { passwordDerivationAborted, preparePasswordKdfInput, type PasswordEnvelopeKeyInput } from './passwordKdfInput';

/** One disposable worker per captured attempt: cancellation drops its memory and late output. */
export async function derivePasswordEnvelopeKey(input: PasswordEnvelopeKeyInput): Promise<Uint8Array> {
    const prepared = preparePasswordKdfInput(input);
    let worker: Worker;
    try {
        if (typeof Worker !== 'function') throw new Error('password_kdf_unavailable');
        worker = new Worker('/happier-password-kdf-worker.js');
    } catch {
        prepared.password.fill(0);
        throw new Error('password_kdf_unavailable');
    }
    return await new Promise<Uint8Array>((resolve, reject) => {
        let settled = false;
        const finish = (key?: Uint8Array, error?: Error) => {
            if (settled) {
                key?.fill(0);
                return;
            }
            settled = true;
            input.signal?.removeEventListener('abort', onAbort);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
            prepared.password.fill(0);
            if (error) {
                key?.fill(0);
                reject(error);
            } else if (key) {
                resolve(key);
            }
        };
        const onAbort = () => finish(undefined, passwordDerivationAborted());
        worker.onmessage = (event: MessageEvent<unknown>) => {
            const data = event.data;
            if (data && typeof data === 'object' && 'ok' in data && data.ok === true
                && 'key' in data && data.key instanceof Uint8Array && data.key.byteLength === 32
                && Object.keys(data).length === 2) {
                finish(data.key, input.signal?.aborted ? passwordDerivationAborted() : undefined);
            } else {
                finish(undefined, new Error('password_kdf_unavailable'));
            }
        };
        worker.onerror = () => finish(undefined, new Error('password_kdf_unavailable'));
        worker.onmessageerror = () => finish(undefined, new Error('password_kdf_unavailable'));
        input.signal?.addEventListener('abort', onAbort, { once: true });
        if (input.signal?.aborted) {
            onAbort();
            return;
        }
        try {
            worker.postMessage(prepared);
            // Structured cloning has completed before postMessage returns.
            prepared.password.fill(0);
        } catch {
            finish(undefined, new Error('password_kdf_unavailable'));
        }
    });
}
