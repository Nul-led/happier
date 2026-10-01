import axios from 'axios';
import { z } from 'zod';
import {
    StoredJsonContentEnvelopeSchema, createAccountScopedCryptoMaterialSnapshotV1,
    convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1,
    type AccountScopedCryptoMaterial,
} from '@happier-dev/protocol';
import type { StoredCredentials } from '@/persistence';
import { decodeBase64, encodeBase64, encryptLegacy, decryptLegacyResult, encryptWithDataKey, decryptWithDataKeyResult } from '@/api/encryption';
import { fetchAccountEncryptionCurrentness } from '@/api/client/connectedServiceCredentialApi';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import { requireAccountEncryptionCredentials } from '@/api/client/encryptionKey';

const versionSchema = z.number().int().min(-1);
const itemSchema = z.object({ key: z.string(), value: z.string(), version: versionSchema });
const mutationResultSchema = z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), results: z.array(z.object({ key: z.string(), version: versionSchema })) }),
    z.object({ success: z.literal(false), errors: z.array(z.object({ key: z.string(), error: z.literal('version-mismatch'), version: versionSchema, value: z.string().nullable() })) }),
]);

/** The generic Account JSON KV seam: domain parsing/rebase is supplied by the consumed domain port. */
export function createAccountKvJsonTransport(params: Readonly<{
    credentials: StoredCredentials;
    key: string;
    serverBaseUrl?: string;
    signal?: AbortSignal;
    shouldContinue?: () => boolean;
}>) {
    const baseUrl = (params.serverBaseUrl ?? resolveServerHttpBaseUrl()).replace(/\/+$/, '');
    const headers = { ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(), Authorization: `Bearer ${params.credentials.token}` };
    const check = () => {
        params.signal?.throwIfAborted();
        if (params.shouldContinue && !params.shouldContinue()) throw Object.assign(new Error('Account KV scope retired'), { code: 'account_kv_scope_retired' });
    };
    const whileCurrent = async <T,>(run: () => Promise<T>) => { check(); try { return await run(); } finally { check(); } };
    const context = async () => {
        const currentness = await whileCurrent(() => fetchAccountEncryptionCurrentness({ token: params.credentials.token,
            serverBaseUrl: baseUrl, ...(params.signal ? { signal: params.signal } : {}) }));
        if (currentness.mode === 'plain') return { mode: 'plain' as const, material: null };
        const encryption = requireAccountEncryptionCredentials(params.credentials).encryption;
        const material: AccountScopedCryptoMaterial = encryption.type === 'legacy'
            ? { type: 'legacy', secret: encryption.secret } : { type: 'dataKey', machineKey: encryption.machineKey };
        const snapshot = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee', material,
            ...(encryption.type === 'dataKey' ? { dataKeyPublicKey: encryption.publicKey } : {}) });
        if (currentness.contentKeyFingerprint !== convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(snapshot.contentPublicKeyFingerprint)) {
            throw Object.assign(new Error('Account content key is not current'), { code: 'account_storage_currentness_unavailable' });
        }
        return { mode: 'e2ee' as const, material: snapshot.material };
    };
    type Context = Awaited<ReturnType<typeof context>>;
    const decode = (encoded: string, storage: Context): unknown => {
        let envelope: z.infer<typeof StoredJsonContentEnvelopeSchema> | null = null;
        try {
            const parsed = StoredJsonContentEnvelopeSchema.safeParse(JSON.parse(new TextDecoder().decode(decodeBase64(encoded))));
            if (parsed.success) envelope = parsed.data;
        } catch { /* Ciphertext-only Account KV is the established E2EE representation. */ }
        const mode = envelope?.t === 'plain' ? 'plain' : 'e2ee';
        if (mode !== storage.mode) throw Object.assign(new Error('Account KV content mode mismatch'), { code: 'account_stored_json_mode_mismatch' });
        if (envelope?.t === 'plain') return envelope.v;
        if (!storage.material) throw new Error('Account KV encryption material unavailable');
        const bytes = decodeBase64(envelope?.t === 'encrypted' ? envelope.c : encoded);
        const opened = storage.material.type === 'legacy' ? decryptLegacyResult(bytes, storage.material.secret)
            : decryptWithDataKeyResult(bytes, storage.material.machineKey);
        if (opened.status !== 'authenticated') throw Object.assign(new Error('Account KV content unreadable'), { code: 'account_kv_content_unreadable' });
        return opened.value;
    };
    const encode = (value: unknown, storage: Context) => storage.mode === 'plain'
        ? encodeBase64(new TextEncoder().encode(JSON.stringify({ t: 'plain', v: value })))
        : encodeBase64(storage.material.type === 'legacy' ? encryptLegacy(value, storage.material.secret) : encryptWithDataKey(value, storage.material.machineKey));
    const requestOptions = { headers, validateStatus: () => true, ...(params.signal ? { signal: params.signal } : {}) };
    return {
        async read() {
            const storage = await context();
            const response = await whileCurrent(() => axios.get(`${baseUrl}/v1/kv/${encodeURIComponent(params.key)}`, requestOptions));
            if (response.status === 404) return { value: null, version: -1 };
            if (response.status !== 200) throw new Error(`Account KV read failed (${response.status})`);
            const item = itemSchema.parse(response.data);
            if (item.key !== params.key) throw new Error('Account KV returned another key');
            const value = decode(item.value, storage); check();
            return { value, version: item.version };
        },
        async compareAndSet(value: unknown, version: number) {
            const storage = await context();
            const encoded = encode(value, storage); check();
            const response = await whileCurrent(() => axios.post(`${baseUrl}/v1/kv`, {
                mutations: [{ key: params.key, value: encoded, version }],
            }, requestOptions));
            if (response.status !== 200 && response.status !== 409) throw new Error(`Account KV mutation failed (${response.status})`);
            const result = mutationResultSchema.parse(response.data);
            if (result.success) {
                const stored = result.results.find(item => item.key === params.key);
                if (!stored) throw new Error('Account KV mutation omitted its result');
                return { success: true as const, version: stored.version };
            }
            const conflict = result.errors.find(item => item.key === params.key);
            if (!conflict) throw new Error('Account KV mutation omitted its conflict');
            const incumbent = conflict.value === null ? null : decode(conflict.value, storage); check();
            return { success: false as const, value: incumbent, version: conflict.version,
                ...(conflict.value === null ? { tombstone: true as const } : {}) };
        },
    };
}
