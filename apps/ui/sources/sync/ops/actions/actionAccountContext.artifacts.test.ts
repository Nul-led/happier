import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_PLAIN_DATA_KEY_MARKER, CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION, createLaunchProfilePublisherV1 } from '@happier-dev/protocol';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { encodeBase64 } from '@/encryption/base64';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import type { Artifact, ArtifactCreateRequest, ArtifactUpdateRequest } from '@/sync/domains/artifacts/artifactTypes';
import { captureLazyActionAccountContext } from './actionAccountContext';

// HTTP, device credential storage and the native theme runtime are substituted boundaries.
const runtimeFetch = vi.hoisted(() => vi.fn());
vi.mock('@/utils/system/runtimeFetch', () => ({ runtimeFetch: (...args: unknown[]) => runtimeFetch(...args) }));
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { runtimeFetch.mockReset(); vi.restoreAllMocks(); });

describe('scoped Account workflow Artifact operations', () => {
    it('publishes from raw exact-Home Settings through the existing Settings CAS and Artifact stores', async () => {
        const home = await upsertAndActivateServer({ serverUrl: 'https://profile-publisher.test', scope: 'tab' });
        await upsertAndActivateServer({ serverUrl: 'https://profile-publisher-focused.test', scope: 'tab' });
        const token = `header.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub: 'profile-account' })), 'base64url')}.signature`;
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token });
        let raw: Record<string, unknown> = { profiles: [{ v: 2, id: 'deploy', name: 'Deploy', createdAt: 1, updatedAt: 1 }],
            secretBindingsByProfileId: { deploy: { TOKEN: 'happier:shared-secret:v1:deploy' } }, futureSibling: { retained: true } };
        let version = 4;
        let stored: Artifact | undefined;
        runtimeFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
            const target = new URL(String(url));
            if (target.pathname === '/health' || target.pathname === '/v1/auth/ping') return json({});
            expect(target.origin).toBe(home.serverUrl);
            if (target.pathname === '/v1/features') return json({ features: {}, capabilities: { accountStoredContentCompatibility: {
                v: 1, minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                declarationTransport: 'http-header-and-socket-auth-v1',
            } } });
            if (target.pathname === '/v1/account/encryption') return json({ mode: 'plain', updatedAt: 0 });
            if (target.pathname === '/v2/account/settings') {
                if (init?.method === 'POST') {
                    const write = JSON.parse(String(init.body)) as { expectedVersion: number; content: { t: string; v: Record<string, unknown> } };
                    expect(write.expectedVersion).toBe(version);
                    expect(write.content.t).toBe('plain');
                    raw = write.content.v;
                    return json({ success: true, version: ++version });
                }
                return json({ content: { t: 'plain', v: raw }, version });
            }
            if (target.pathname === '/v1/artifacts' && init?.method === 'POST') {
                const write = JSON.parse(String(init.body)) as ArtifactCreateRequest;
                stored = { ...write, ownerAccountId: 'profile-account', access: 'owner', encryptionMode: 'plain', headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 1 };
                return json(stored);
            }
            if (target.pathname === '/v1/artifacts') return json(stored ? [stored] : []);
            if (stored && target.pathname === `/v1/artifacts/${stored.id}`) return json(stored);
            return json({ error: 'unexpected' }, 404);
        });
        const context = await captureLazyActionAccountContext(home.id);
        try {
            const result = await createLaunchProfilePublisherV1({ readSettings: context.readRawSettings,
                mutateSettings: context.mutateRawSettings, artifactStore: { read: context.workflowArtifacts.read,
                    create: async ({ header, body }) => ({ artifactId: await context.createArtifact({ ...header, title: 'Deploy' }, body) }) },
            }).publish({ profileId: 'deploy' });
            expect(raw.profiles).toEqual([result]);
            expect(raw.secretBindingsByProfileId).toEqual({});
            expect(raw.futureSibling).toEqual({ retained: true });
            expect(stored?.dataEncryptionKey).toBe(ARTIFACT_PLAIN_DATA_KEY_MARKER);
            expect(await context.readLaunchProfiles(raw.profiles)).toMatchObject([{ id: 'deploy', artifactId: result.artifactId,
                secretBindings: { TOKEN: 'happier:shared-secret:v1:deploy' } }]);
        } finally { context.dispose(); }
    });

    it('rejects captured-scope retirement before dispatch and after an asynchronous read', async () => {
        const home = await upsertAndActivateServer({ serverUrl: 'https://artifact-retirement.test', scope: 'tab' });
        const token = `header.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub: 'artifact-account' })), 'base64url')}.signature`;
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token });
        let releaseRead: (() => void) | undefined;
        let readStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => { readStarted = resolve; });
        runtimeFetch.mockImplementation(async (url: unknown) => {
            const target = new URL(String(url));
            if (target.pathname === '/v1/account/encryption') return json({ mode: 'plain', updatedAt: 0 });
            if (target.pathname === '/v1/artifacts/held') {
                readStarted!();
                await new Promise<void>((resolve) => { releaseRead = resolve; });
                return json({ error: 'missing' }, 404);
            }
            return json({});
        });
        const context = await captureLazyActionAccountContext(home.id);
        try {
            const pending = context.workflowArtifacts.read('held');
            const rejected = expect(pending).rejects.toMatchObject({ code: 'action_account_scope_changed' });
            await started;
            expect(await TokenStorage.setCredentialsForServerUrl(home.serverUrl, { serverId: home.id }, { token: 'replacement-account' })).toBe(true);
            releaseRead!();
            await rejected;
            const dispatched = runtimeFetch.mock.calls.length;
            await expect(context.workflowArtifacts.delete('held')).rejects.toMatchObject({ code: 'action_account_scope_changed' });
            expect(runtimeFetch.mock.calls).toHaveLength(dispatched);
        } finally { context.dispose(); }
    });
    it.each(['plain', 'e2ee'] as const)('reads, pages, creates, CAS-updates and deletes %s content on the captured Home', async (mode) => {
        const home = await upsertAndActivateServer({ serverUrl: `https://workflow-artifacts-${mode}.test`, scope: 'tab' });
        await upsertAndActivateServer({ serverUrl: `https://focused-artifacts-${mode}.test`, scope: 'tab' });
        const token = `header.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub: 'artifact-account' })), 'base64url')}.signature`;
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(mode === 'plain'
            ? { token } : { token, secret: encodeBase64(new Uint8Array(32).fill(24), 'base64url') });
        let stored: Artifact | undefined;
        const requests: URL[] = [];
        runtimeFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
            const target = new URL(String(url));
            if (target.pathname === '/health' || target.pathname === '/v1/auth/ping') return json({});
            if (target.pathname === '/v1/features') return json({ features: {}, capabilities: { accountStoredContentCompatibility: {
                v: 1, minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                declarationTransport: 'http-header-and-socket-auth-v1',
            } } });
            requests.push(target);
            expect(target.origin).toBe(home.serverUrl);
            expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
            if (target.pathname === '/v1/account/encryption') return json({ mode, updatedAt: 0 });
            if (target.pathname === '/v1/artifacts' && init?.method === 'POST') {
                const body = JSON.parse(String(init.body)) as ArtifactCreateRequest;
                stored = { ...body, ownerAccountId: 'artifact-account', access: 'owner', encryptionMode: 'plain', headerVersion: 1, bodyVersion: 1, seq: 1, createdAt: 1, updatedAt: 9 };
                return json(stored);
            }
            if (target.pathname === '/v1/artifacts') return json(stored ? [stored] : []);
            if (target.pathname.endsWith('/transport-error')) return json({ error: 'denied' }, 403);
            if (target.pathname.endsWith('/locked')) return json({ ...stored, id: 'locked', header: 'broken', dataEncryptionKey: 'unopenable' });
            if (!stored || target.pathname !== `/v1/artifacts/${stored.id}`) return json({ error: 'missing' }, 404);
            if (init?.method === 'DELETE') { stored = undefined; return new Response(null, { status: 204 }); }
            if (init?.method !== 'POST') return json(stored);
            const update = JSON.parse(String(init.body)) as ArtifactUpdateRequest;
            if (update.expectedHeaderVersion !== stored.headerVersion || update.expectedBodyVersion !== stored.bodyVersion) return json({ success: false, error: 'version-mismatch' });
            stored = { ...stored, header: update.header!, body: update.body!, headerVersion: 2, bodyVersion: 2 };
            return json({ success: true, headerVersion: 2, bodyVersion: 2 });
        });
        const context = await captureLazyActionAccountContext(home.id);
        try {
            const header = { kind: 'workflow-definition.v1', definitionId: 'workflow-id', revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Workflow' } };
            const port = context.workflowArtifacts;
            expect(await port.read('workflow-id')).toBeNull();
            await port.create({ artifactId: 'workflow-id', header, body: 'definition body' });
            expect(stored?.id).toBe('workflow-id');
            expect(stored?.dataEncryptionKey === ARTIFACT_PLAIN_DATA_KEY_MARKER).toBe(mode === 'plain');
            expect(await port.read('workflow-id')).toEqual({ artifactId: 'workflow-id', header, body: 'definition body', revision: { headerVersion: 1, bodyVersion: 1 } });
            const page = await port.list({ limit: 1, cursor: 'incoming-cursor' });
            expect(page.items[0]).toMatchObject({ artifactId: 'workflow-id', header, headerVersion: 1, updatedAt: 9 });
            expect(page.nextCursor).toBe(context.encodeArtifactListCursor(page.items[0]!));
            expect(requests.find((url) => url.searchParams.has('cursor'))?.searchParams.get('cursor')).toBe('incoming-cursor');
            expect(requests.find((url) => url.searchParams.has('limit'))?.searchParams.get('limit')).toBe('1');
            const nextHeader = { ...header, revision: { headerVersion: 2, bodyVersion: 2 } };
            expect(await port.update({ artifactId: 'workflow-id', expectedRevision: header.revision, header: nextHeader, body: 'definition body' })).toEqual({ ok: true, revision: nextHeader.revision });
            expect(await port.update({ artifactId: 'workflow-id', expectedRevision: header.revision, header: nextHeader, body: 'overwrite' })).toMatchObject({ ok: false, errorCode: 'version_mismatch' });
            await expect(port.read('transport-error')).rejects.toMatchObject({ status: 403 });
            await expect(port.read('locked')).rejects.toMatchObject({ code: 'content_unavailable' });
            expect(await port.delete('workflow-id')).toEqual({ ok: true });
            expect(await port.read('workflow-id')).toBeNull();
        } finally { context.dispose(); }
    });
});
