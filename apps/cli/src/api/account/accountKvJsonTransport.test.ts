import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountScopedCryptoMaterialSnapshotV1, convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1 } from '@happier-dev/protocol';
import type { StoredCredentials } from '@/persistence';
import { encodeBase64, encryptLegacy, encryptWithDataKey, decodeBase64, decryptLegacyResult, decryptWithDataKeyResult } from '@/api/encryption';
import { createAccountKvJsonTransport } from './accountKvJsonTransport';

afterEach(() => { vi.restoreAllMocks(); });
const key = 'workspace:work-boards:v1';
const baseUrl = 'https://board-home.test';
const plainCurrentness = { mode: 'plain', version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1 };
const plain = (v: unknown) => encodeBase64(new TextEncoder().encode(JSON.stringify({ t: 'plain', v })));

describe('CLI Account JSON KV transport', () => {
    it.each(['legacy', 'dataKey'] as const)('round-trips %s E2EE using the current Account content key', async type => {
        const secret = new Uint8Array(32).fill(7);
        const credentials: StoredCredentials = { token: 'board-token', encryption: type === 'legacy'
            ? { type, secret } : { type, machineKey: secret, publicKey: tweetnacl.box.keyPair.fromSecretKey(secret).publicKey } };
        const material = type === 'legacy' ? { type, secret } as const : { type, machineKey: secret } as const;
        const snapshot = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee', material,
            ...(credentials.encryption?.type === 'dataKey' ? { dataKeyPublicKey: credentials.encryption.publicKey } : {}) });
        const currentness = { ...plainCurrentness, mode: 'e2ee', signingKeyFingerprint: 'signing',
            contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(snapshot.contentPublicKeyFingerprint) };
        const encoded = encodeBase64(type === 'legacy' ? encryptLegacy({ v: 1, boards: [] }, secret) : encryptWithDataKey({ v: 1, boards: [] }, secret));
        vi.spyOn(axios, 'get').mockImplementation(async url => url.endsWith('/currentness')
            ? { status: 200, data: currentness } : { status: 200, data: { key, value: encoded, version: 4 } });
        const post = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { success: true, results: [{ key, version: 5 }] } });
        const transport = createAccountKvJsonTransport({ credentials, key, serverBaseUrl: baseUrl });
        await expect(transport.read()).resolves.toEqual({ value: { v: 1, boards: [] }, version: 4 });
        await expect(transport.compareAndSet({ v: 1, boards: ['new'] }, 4)).resolves.toEqual({ success: true, version: 5 });
        const body = post.mock.calls[0]![1] as { mutations: { value: string }[] };
        const opened = type === 'legacy' ? decryptLegacyResult(decodeBase64(body.mutations[0]!.value), secret)
            : decryptWithDataKeyResult(decodeBase64(body.mutations[0]!.value), secret);
        expect(opened).toEqual({ status: 'authenticated', value: { v: 1, boards: ['new'] } });
    });

    it('refuses mode/content mismatches before returning plaintext or issuing a write', async () => {
        const credentials: StoredCredentials = { token: 'board-token', encryption: null };
        vi.spyOn(axios, 'get').mockImplementation(async url => url.endsWith('/currentness')
            ? { status: 200, data: plainCurrentness } : { status: 200, data: { key, value: 'opaque-ciphertext', version: 4 } });
        const post = vi.spyOn(axios, 'post');
        const transport = createAccountKvJsonTransport({ credentials, key, serverBaseUrl: baseUrl });
        await expect(transport.read()).rejects.toMatchObject({ code: 'account_stored_json_mode_mismatch' });
        expect(post).not.toHaveBeenCalled();
    });

    it('does not commit after the Account scope retires during currentness resolution', async () => {
        let current = true;
        vi.spyOn(axios, 'get').mockImplementation(async () => { current = false; return { status: 200, data: plainCurrentness }; });
        const post = vi.spyOn(axios, 'post');
        const transport = createAccountKvJsonTransport({ credentials: { token: 'board-token', encryption: null }, key, serverBaseUrl: baseUrl, shouldContinue: () => current });
        await expect(transport.compareAndSet({}, -1)).rejects.toMatchObject({ code: 'account_kv_scope_retired' });
        expect(post).not.toHaveBeenCalled();
    });

    it('opens plain CAS conflicts with their version and distinguishes tombstones from stored null', async () => {
        vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: plainCurrentness });
        vi.spyOn(axios, 'post').mockResolvedValueOnce({ status: 409, data: { success: false, errors: [{ key, error: 'version-mismatch', version: 3, value: plain(null) }] } })
            .mockResolvedValueOnce({ status: 409, data: { success: false, errors: [{ key, error: 'version-mismatch', version: 4, value: null }] } });
        const transport = createAccountKvJsonTransport({ credentials: { token: 'board-token', encryption: null }, key, serverBaseUrl: baseUrl });
        await expect(transport.compareAndSet({}, 2)).resolves.toEqual({ success: false, value: null, version: 3 });
        await expect(transport.compareAndSet({}, 3)).resolves.toEqual({ success: false, value: null, version: 4, tombstone: true });
    });
});
