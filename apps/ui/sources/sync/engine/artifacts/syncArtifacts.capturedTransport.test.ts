import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION, ARTIFACT_PLAIN_DATA_KEY_MARKER } from '@happier-dev/protocol';
import type { Artifact, ArtifactCreateRequest, ArtifactUpdateRequest, DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { Encryption } from '@/sync/encryption/encryption';
import { createArtifactViaApi, fetchArtifactWithBodyFromApi, updateArtifactViaApi, type ArtifactDataKeyCache } from './syncArtifacts';

// HTTP is the only substituted boundary; API, mode, compatibility, and crypto stay real.
const runtimeFetch = vi.hoisted(() => vi.fn());
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: (...args: unknown[]) => runtimeFetch(...args) }));

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { runtimeFetch.mockReset(); });

describe('artifact captured Home transport', () => {
    it.each(['plain', 'e2ee'] as const)('creates, fetches and updates %s artifacts on B while A is focused', async (mode) => {
        const homeB = upsertAndActivateServer({ serverUrl: `https://artifact-b-${mode}.test`, scope: 'tab' });
        upsertAndActivateServer({ serverUrl: `https://artifact-a-${mode}.test`, scope: 'tab' });
        let stored: Artifact | undefined;
        const requests: string[] = [];
        runtimeFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
            const target = new URL(String(url));
            requests.push(target.href);
            if (target.pathname === '/health' || target.pathname === '/v1/auth/ping') return json({});
            if (target.pathname === '/v1/features') return json({
                features: {}, capabilities: { accountStoredContentCompatibility: {
                    v: 1, minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                    currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                    declarationTransport: 'http-header-and-socket-auth-v1',
                } },
            });
            if (target.origin !== homeB.serverUrl) return json({ error: 'wrong-home' }, 403);
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-b');
            if (target.pathname === '/v1/account/encryption') return json({ mode, updatedAt: 0 });
            if (target.pathname === '/v1/artifacts' && init?.method === 'POST') {
                const body = JSON.parse(String(init.body)) as ArtifactCreateRequest;
                stored = { ...body, headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 };
                return json(stored);
            }
            if (stored && target.pathname === `/v1/artifacts/${stored.id}`) {
                if (init?.method !== 'POST') return json(stored);
                const update = JSON.parse(String(init.body)) as ArtifactUpdateRequest;
                expect(update.expectedHeaderVersion).toBe(1);
                expect(update.expectedBodyVersion).toBe(1);
                stored = { ...stored, header: update.header!, body: update.body!, headerVersion: 2, bodyVersion: 2 };
                return json({ success: true, headerVersion: 2, bodyVersion: 2 });
            }
            return json({ error: 'missing' }, 404);
        });
        const request = (path: string, init?: RequestInit) => runtimeFetch(`${homeB.serverUrl}${path}`, init) as Promise<Response>;
        const encryption = mode === 'plain' ? null : await Encryption.create(new Uint8Array(32).fill(22));
        const artifactDataKeys: ArtifactDataKeyCache = new Map();
        const context = { credentials: { token: 'token-b' }, encryption, artifactDataKeys, request, serverId: homeB.id };
        let projected: DecryptedArtifact | undefined;
        // Optional header fields are deliberately omitted, as with an ordinary new artifact.
        const id = await createArtifactViaApi({ ...context, title: 'B title', body: 'B body', addArtifact: (value) => { projected = value; } });
        expect(projected).toMatchObject({ id, title: 'B title', body: 'B body', storageMode: mode });
        expect(stored?.dataEncryptionKey === ARTIFACT_PLAIN_DATA_KEY_MARKER).toBe(mode === 'plain');
        context.artifactDataKeys.clear();
        const fetched = await fetchArtifactWithBodyFromApi({ ...context, artifactId: id });
        expect(fetched).toMatchObject({ title: 'B title', body: 'B body', storageMode: mode });
        // Missing versions force the update's recovery read through the same captured transport.
        projected = { ...fetched!, headerVersion: undefined, bodyVersion: undefined };
        context.artifactDataKeys.clear();
        await updateArtifactViaApi({ ...context, artifactId: id, title: 'B updated', body: 'B updated body', getArtifact: () => projected, updateArtifact: (value) => { projected = value; } });
        expect(projected).toMatchObject({ title: 'B updated', body: 'B updated body', headerVersion: 2, bodyVersion: 2 });
        expect(await fetchArtifactWithBodyFromApi({ ...context, artifactId: id })).toMatchObject({ title: 'B updated', body: 'B updated body' });
        expect(requests.filter((url) => !url.endsWith('/health') && !url.includes('/v1/auth/ping')).every((url) => url.startsWith(homeB.serverUrl))).toBe(true);
        if (mode === 'plain') expect(context.artifactDataKeys.size).toBe(0);
    });
});
