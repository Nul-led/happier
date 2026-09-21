import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    computeAccountEncryptionMigrateKeyFingerprintV1,
    parseAccountApiTokenCredentialV1,
    openApiTokenEncryptionAccessV1,
    type AccountApiTokenEncryptionAccessV1,
} from '@happier-dev/protocol';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { encodeBase64, decodeBase64 } from '@/encryption/base64';

// This fixture stages a Home directly instead of running connectionManager's
// restore lifecycle, so nothing ever publishes an applied active Home and
// `getActiveServerAccountScope()` returns null for every request. Everything
// else in the connection owner stays real; only the two applied-runtime facts
// the lifecycle would have produced are supplied, the same way the direct-Sync
// fixtures do (`sync.optimisticThinking.test.ts`, `sync.sessionMissingServerScope.test.ts`).
vi.mock('@/sync/runtime/orchestration/connectionManager', async () => {
    const { getActiveServerSnapshot } = await import('@/sync/domains/server/serverRuntime');
    return {
        getAppliedActiveServerSnapshot: () => getActiveServerSnapshot(),
        getAppliedActiveServerId: () => getActiveServerSnapshot().serverId,
        isAppliedActiveServerRuntimeAvailable: () => true,
        subscribeAppliedActiveServer: () => () => {},
        subscribeAppliedActiveServerRuntimeAvailability: () => () => {},
        subscribeApplyingActiveServer: () => () => {},
    };
});

// The real store and Action graph need a longer cold-transform budget on shared workers.
beforeAll(async () => {
    await import('@/sync/domains/state/storageStore');
    await import('@/sync/ops/actions/defaultActionExecutor');
}, 600_000);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function harness(options: { failure?: 'network' | 'mismatch' | 'unsupported' | 'malformed' | 'conflict' | 'account-disabled'; hold?: Promise<void>; holdCurrentness?: Promise<void> } = {}) {
    vi.stubEnv('EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', `token-ui-${crypto.randomUUID()}`);
    const { upsertAndActivateServer } = await import('@/sync/domains/server/serverRuntime');
    const { setServerProfileIdentityForUrl } = await import('@/sync/domains/server/serverProfiles');
    const profile = await upsertAndActivateServer({ serverUrl: 'https://token-ui.example', name: 'Token Home' });
    await setServerProfileIdentityForUrl(profile.serverUrl, 'srv_token-ui');
    const { storage } = await import('@/sync/domains/state/storageStore');
    storage.getState().activateProfileScope({ serverId: 'srv_token-ui', accountId: 'account-a' });
    const credentials = {
        token: `header.${Buffer.from(JSON.stringify({ sub: 'account-a' })).toString('base64url')}.signature`,
        secret: encodeBase64(new Uint8Array(32).fill(7), 'base64url'),
    };
    const encryption = await createEncryptionFromAuthCredentials(credentials);
    const { TokenStorage } = await import('@/auth/storage/tokenStorage');
    // Persisted credential reads and HTTP are the boundaries; controller,
    // scope, Action admission, adapters and all crypto remain real.
    vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue(credentials);
    const requests: { path: string; body: Record<string, unknown> }[] = [];
    const rows: Record<string, unknown>[] = [];
    let currentnessAvailable = true;
    const { setRuntimeFetch } = await import('@/utils/system/runtimeFetch');
    setRuntimeFetch(async (input, init) => {
        const url = new URL(String(input));
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        requests.push({ path: url.pathname, body });
        let response: unknown = { ok: true };
        if (url.pathname === '/v1/account/encryption/currentness') {
            await options.holdCurrentness;
            if (!currentnessAvailable) throw new Error('Home unavailable');
            response = {
            mode: 'e2ee', version: 1, updatedAt: 1, signingKeyFingerprint: 'signing',
            contentKeyFingerprint: computeAccountEncryptionMigrateKeyFingerprintV1(encryption.contentDataKey),
            recipientEnvelopeReadiness: { status: 'available' },
            };
        }
        if (url.pathname === '/v1/auth/api-tokens/create') {
            if (options.failure === 'unsupported') return new Response('{}', { status: 404 });
            if (options.failure === 'conflict') {
                return new Response(JSON.stringify({ error: 'api_token_id_conflict' }), { status: 409 });
            }
            if (options.failure === 'account-disabled') {
                return new Response(JSON.stringify({ error: 'account-disabled' }), { status: 403 });
            }
            const encryptionArm = body.encryption as { access?: unknown } | undefined;
            const tokenId = options.failure === 'mismatch'
                ? '22222222-2222-4222-8222-222222222222'
                : String(body.tokenId);
            const row = {
                tokenId,
                label: body.label,
                displayPrefix: `hap_v1_${String(tokenId).slice(0, 8)}`,
                createdAt: '2026-09-06T00:00:00.000Z',
                expiresAt: body.expiresAt,
                lastUsedAt: null,
                hasEncryptionAccess: encryptionArm !== undefined,
                hasUnattendedTeamAccess: body.authorizeUnattendedTeamAccess === true,
            };
            rows.push(row);
            // The Home has durably accepted this exact selector before the
            // response is held. Dismissal now aborts the real request signal,
            // so the adapter must settle from its issued witness rather than a
            // late-success-only test double.
            await options.hold;
            if (init?.signal?.aborted) {
                const error = new Error('response aborted after commit');
                error.name = 'AbortError';
                throw error;
            }
            if (options.failure === 'network') throw new Error('response lost');
            response = { token: `hap_v1_${tokenId}_${'A'.repeat(43)}`, apiToken: row };
            if (options.failure === 'malformed') response = { token: 'malformed', apiToken: row };
        }
    if (url.pathname.endsWith('/list')) response = { tokens: rows };
    if (url.pathname.endsWith('/revoke')) {
        const tokenId = typeof body.tokenId === 'string' ? body.tokenId : '';
        const rowIndex = rows.findIndex((row) => row.tokenId === tokenId);
        if (rowIndex >= 0) rows.splice(rowIndex, 1);
        response = { revoked: rowIndex >= 0 };
    }
        return new Response(JSON.stringify(response), { status: 200 });
    });
    const { createApiTokenSettingsController } = await import('./apiTokenSettingsController');
    const { createDefaultActionExecutor } = await import('@/sync/ops/actions/defaultActionExecutor');
    const { captureActiveServerAccountScopeLifetime: captureLifetime } = await import('@/sync/domains/scope/activeServerAccountScope');
    const controller = createApiTokenSettingsController({ execute: createDefaultActionExecutor().execute, captureActiveAccountScopeLifetime: captureLifetime, now: Date.now });
    const { captureActiveServerAccountScopeLifetime } = await import('@/sync/domains/scope/activeServerAccountScope');
    expect(captureActiveServerAccountScopeLifetime()?.isCurrent()).toBe(true);
    controller.setCreateDraft({ label: 'Integration', expiryPreset: '90d', encryptionAccess: true });
    return { controller, requests, encryption, withdrawCurrentness: () => { currentnessAvailable = false; } };
}

describe('trusted token UI encryption lifecycle', () => {
    it('never probes encryption currentness during ordinary list refresh', async () => {
        const { controller, requests, withdrawCurrentness } = await harness();
        await controller.refresh();
        expect(requests.some((request) => request.path.endsWith('/currentness'))).toBe(false);
        withdrawCurrentness();
        await controller.refresh();
        expect(requests.some((request) => request.path.endsWith('/currentness'))).toBe(false);
        expect(controller.getState()).toMatchObject({ phase: 'ready' });
        controller.retire();
    }, 180_000);

    it('probes authoritative readiness lazily when encrypted creation is opened', async () => {
        const { controller, requests } = await harness();
        await controller.refreshEncryptionAvailability();
        expect(requests.filter((request) => request.path.endsWith('/currentness'))).toHaveLength(1);
        expect(controller.getState().canCreateEncrypted).toBe(true);
        controller.retire();
    }, 180_000);

    it('withdraws stale encrypted readiness without blocking ordinary creation', async () => {
        const { controller, withdrawCurrentness } = await harness();
        await controller.refreshEncryptionAvailability();
        expect(controller.getState().canCreateEncrypted).toBe(true);
        withdrawCurrentness();
        const refresh = controller.refreshEncryptionAvailability();
        expect(controller.getState().canCreateEncrypted).toBe(false);
        await refresh;
        expect(controller.getState()).toMatchObject({
            canCreateEncrypted: false,
            createDraft: { encryptionAccess: false },
        });

        await controller.createToken();
        expect(controller.getState()).toMatchObject({
            createError: null,
            recoveryTokenId: null,
            reveal: { token: expect.stringMatching(/^hap_v1_/), apiToken: { hasEncryptionAccess: false } },
        });
        controller.retire();
    }, 180_000);

    it('cancels local preparation before dispatch without creating a token', async () => {
        let finish!: () => void;
        const holdCurrentness = new Promise<void>((resolve) => { finish = resolve; });
        const { controller, requests } = await harness({ holdCurrentness });
        const create = controller.createToken();
        await vi.waitFor(() => expect(requests.some((request) => request.path.endsWith('/currentness'))).toBe(true));
        await expect(controller.requestRevealDismiss(async () => true, 'shared')).resolves.toBe(true);
        finish();
        await create;
        expect(requests.some((request) => request.path.endsWith('/create'))).toBe(false);
        expect(controller.getState()).toMatchObject({ reveal: null, recoveryTokenId: null, createPending: false });
        controller.retire();
    }, 180_000);

    it('retains the exact selector and reconciles the committed row after dismissal during dispatch', async () => {
        let finish!: () => void;
        const hold = new Promise<void>((resolve) => { finish = resolve; });
        const { controller, requests } = await harness({ hold });
        const create = controller.createToken();
        await vi.waitFor(() => expect(requests.some((request) => request.path === '/v1/auth/api-tokens/create')).toBe(true));
        await expect(controller.requestRevealDismiss(async () => true, 'shared')).resolves.toBe(true);
        finish();
        await create;
        const createRequest = requests.find((request) => request.path === '/v1/auth/api-tokens/create');
        expect(controller.getState()).toMatchObject({
            reveal: null,
            createPending: false,
            createError: 'outcome_unknown',
            recoveryTokenId: createRequest?.body.tokenId,
            tokens: [expect.objectContaining({ tokenId: createRequest?.body.tokenId })],
        });
        expect(requests.filter((request) => request.path.endsWith('/list'))).toHaveLength(1);
        controller.retire();
    }, 180_000);

    it('suppresses all late results after the captured Account retires', async () => {
        let finish!: () => void;
        const hold = new Promise<void>((resolve) => { finish = resolve; });
        const { controller, requests } = await harness({ hold });
        const create = controller.createToken();
        await vi.waitFor(() => expect(requests.some((request) => request.path === '/v1/auth/api-tokens/create')).toBe(true));
        const { retireActiveServerAccountScopeLifetime } = await import('@/sync/domains/scope/activeServerAccountScope');
        retireActiveServerAccountScopeLifetime();
        finish();
        await create;
        expect(controller.getState()).toMatchObject({ reveal: null, tokens: [], recoveryTokenId: null, createPending: false });
        controller.retire();
    }, 180_000);

    it('preserves ordinary token access after unsupported encrypted creation', async () => {
        const { controller, requests } = await harness({ failure: 'unsupported' });
        await controller.createToken();
        expect(controller.getState()).toMatchObject({ createError: 'unsupported', recoveryTokenId: null, reveal: null });
        expect(requests.filter((request) => request.path.endsWith('/create'))).toHaveLength(1);
        controller.retire();
    }, 180_000);

    it.each(['conflict', 'account-disabled'] as const)('keeps known %s refusal typed and recovery-free', async (failure) => {
        const { controller } = await harness({ failure });
        await controller.createToken();
        expect(controller.getState()).toMatchObject({
            createError: failure === 'conflict' ? 'api_token_id_conflict' : 'account-disabled',
            recoveryTokenId: null,
            reveal: null,
        });
        controller.retire();
    }, 180_000);

    it('uses a fresh UUID when the user explicitly retries a pre-effect collision', async () => {
        const { controller, requests } = await harness({ failure: 'conflict' });
        await controller.createToken();
        await controller.createToken();
        const createIds = requests
            .filter((request) => request.path === '/v1/auth/api-tokens/create')
            .map((request) => request.body.tokenId);
        expect(createIds).toHaveLength(2);
        expect(createIds[0]).not.toBe(createIds[1]);
        expect(controller.getState().recoveryTokenId).toBeNull();
        controller.retire();
    }, 180_000);

    it('prepares locally, dispatches once, and reveals only a correctly bound combined credential', async () => {
        const { controller, requests, encryption } = await harness();
        await controller.createToken();
        const created = requests.find((request) => request.path === '/v1/auth/api-tokens/create');
        expect(created).toBeDefined();
        // The canonical create input carries the selector once, at the top level,
        // and the optional encryption arm is exactly `{ access }`.
        expect(typeof created!.body.tokenId).toBe('string');
        expect(Object.keys(created!.body.encryption as object)).toEqual(['access']);
        const reveal = controller.getState().reveal;
        expect(reveal?.token).toMatch(/^hapc_v1_/);
        const parsed = parseAccountApiTokenCredentialV1(reveal!.token);
        expect(parsed).not.toBeNull();
        expect(JSON.stringify(requests)).not.toContain(reveal!.token);
        expect(JSON.stringify(requests)).not.toContain(parsed!.wrappingSecret);
        expect(openApiTokenEncryptionAccessV1({
            context: { serverIdentityId: parsed!.serverIdentityId, accountId: parsed!.accountId, tokenId: String(created!.body.tokenId), contentPublicKey: parsed!.contentPublicKey },
            wrappingSecret: decodeBase64(parsed!.wrappingSecret, 'base64url'), encryptionAccess: (created!.body.encryption as { access: AccountApiTokenEncryptionAccessV1 }).access,
        })).toEqual(encryption.getContentPrivateKey());
        controller.clearReveal();
        expect(controller.getState().reveal).toBeNull();
        controller.retire();
    }, 180_000);

    it.each(['network', 'malformed'] as const)('preserves the requested UUID only after outcome-unknown %s settlement', async (failure) => {
        const { controller, requests } = await harness({ failure });
        await controller.createToken();
        const created = requests.find((request) => request.path === '/v1/auth/api-tokens/create');
        const tokenId = created?.body.tokenId;
        expect(controller.getState()).toMatchObject({ reveal: null, createPending: false, recoveryTokenId: tokenId });
        expect(controller.getState().recoveryTokenId).toBeTruthy();
        expect(requests.filter((request) => request.path.endsWith('/create'))).toHaveLength(1);
        await controller.refresh();
        await controller.revokeToken(controller.getState().recoveryTokenId!);
        expect(requests.find((request) => request.path.endsWith('/revoke'))?.body).toEqual({ tokenId });
        expect(controller.getState().recoveryTokenId).toBeNull();
        controller.retire();
    }, 180_000);

    it('clears recovery after a mismatched response is absent from the authoritative list', async () => {
        const { controller, requests } = await harness({ failure: 'mismatch' });
        await controller.createToken();
        const created = requests.find((request) => request.path === '/v1/auth/api-tokens/create');
        const requestedTokenId = created?.body.tokenId;
        expect(requestedTokenId).toBeTruthy();
        expect(controller.getState()).toMatchObject({
            createError: 'invalid_response',
            recoveryTokenId: null,
            reveal: null,
        });
        expect(requests.filter((request) => request.path.endsWith('/create'))).toHaveLength(1);
        expect(requests.filter((request) => request.path.endsWith('/list'))).toHaveLength(1);
        expect(requests.some((request) => request.path.endsWith('/revoke'))).toBe(false);
        controller.retire();
    }, 180_000);
});
