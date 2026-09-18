import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionExecuteResult } from '@happier-dev/protocol';

// Randomness is a genuine system boundary; the request-owned selector below is
// the exact value the controller must send, bind and reconcile against.
const uuid = vi.hoisted(() => ({ next: '11111111-1111-4111-8111-111111111111' }));
vi.mock('@/platform/randomUUID', () => ({ randomUUID: () => uuid.next }));

import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';

import {
    createApiTokenSettingsController,
    type ApiTokenSettingsControllerDependencies,
    type ApiTokenSettingsExecute,
} from './apiTokenSettingsController';

const NOW = Date.parse('2026-08-22T12:00:00.000Z');

const TOKEN_A = {
    tokenId: '11111111-1111-4111-8111-111111111111',
    label: 'CI on build-server',
    displayPrefix: 'hap_v1_11111111',
    createdAt: '2026-08-20T12:00:00.000Z',
    lastUsedAt: null,
    expiresAt: null,
    hasEncryptionAccess: false,
    hasUnattendedTeamAccess: false,
} as const;

const TOKEN_B = {
    tokenId: '22222222-2222-4222-8222-222222222222',
    label: 'Release automation',
    displayPrefix: 'hap_v1_22222222',
    createdAt: '2026-08-21T12:00:00.000Z',
    lastUsedAt: '2026-08-22T11:00:00.000Z',
    expiresAt: '2026-08-29T12:00:00.000Z',
    hasEncryptionAccess: true,
    hasUnattendedTeamAccess: false,
} as const;

type TestLifetime = ActiveServerAccountScopeLifetime & Readonly<{ retire(): void }>;

function createLifetime(): TestLifetime {
    let current = true;
    const callbacks = new Set<() => void>();
    return {
        scope: { serverId: 'server-a', accountId: 'account-a' },
        isCurrent: () => current,
        onRetire(callback) {
            if (!current) {
                callback();
                return { dispose() {} };
            }
            callbacks.add(callback);
            return { dispose: () => callbacks.delete(callback) };
        },
        retire() {
            current = false;
            for (const callback of [...callbacks]) callback();
            callbacks.clear();
        },
    };
}

function ok(result: unknown): ActionExecuteResult {
    return { ok: true, result };
}

function createHarness(results: readonly (ActionExecuteResult | Promise<ActionExecuteResult>)[]) {
    const queue = [...results];
    const lifetime = createLifetime();
    const execute = vi.fn<ApiTokenSettingsExecute>(async () => await (queue.shift() ?? ok({ tokens: [] })));
    const dependencies: ApiTokenSettingsControllerDependencies = {
        execute,
        captureActiveAccountScopeLifetime: () => lifetime,
        now: () => NOW,
    };
    const controller = createApiTokenSettingsController(dependencies);
    return { controller, execute, lifetime };
}

describe('createApiTokenSettingsController', () => {
    beforeEach(() => { uuid.next = TOKEN_A.tokenId; });

    it('loads summaries through the UI Action front door and preserves them during refresh', async () => {
        let finishRefresh!: (value: ActionExecuteResult) => void;
        const deferred = new Promise<ActionExecuteResult>((resolve) => { finishRefresh = resolve; });
        const harness = createHarness([ok({ tokens: [TOKEN_A] }), deferred]);

        await harness.controller.refresh();
        expect(harness.controller.getState()).toMatchObject({
            phase: 'ready',
            tokens: [TOKEN_A],
            isRefreshing: false,
        });

        const pending = harness.controller.refresh();
        expect(harness.controller.getState()).toMatchObject({
            phase: 'ready',
            tokens: [TOKEN_A],
            isRefreshing: true,
        });
        finishRefresh(ok({ tokens: [TOKEN_A, TOKEN_B] }));
        await pending;

        expect(harness.controller.getState()).toMatchObject({ tokens: [TOKEN_A, TOKEN_B], isRefreshing: false });
        expect(harness.execute).toHaveBeenNthCalledWith(
            1,
            'account.apiTokens.list',
            {},
            expect.objectContaining({ surface: 'ui', actionCaller: { kind: 'host' }, signal: expect.any(AbortSignal) }),
        );
    });

    it('keeps last-known content available when a background refresh fails', async () => {
        const harness = createHarness([
            ok({ tokens: [TOKEN_A] }),
            { ok: false, errorCode: 'auth_unavailable', error: 'auth_unavailable' },
        ]);

        await harness.controller.refresh();
        await harness.controller.refresh();

        expect(harness.controller.getState()).toMatchObject({
            phase: 'ready',
            tokens: [TOKEN_A],
            isRefreshing: false,
            listError: 'auth_unavailable',
        });
    });

    it('normalizes unsupported executor failures instead of inventing UI states', async () => {
        const harness = createHarness([
            { ok: false, errorCode: 'account_mismatch', error: 'account_mismatch' },
        ]);

        await harness.controller.refresh();

        expect(harness.controller.getState()).toMatchObject({
            phase: 'error',
            listError: 'unavailable',
        });
    });

    it('preserves the canonical invalid-request failure for presentation', async () => {
        const harness = createHarness([
            { ok: false, errorCode: 'invalid_request', error: 'invalid_request' },
        ]);

        await harness.controller.refresh();

        expect(harness.controller.getState()).toMatchObject({
            phase: 'error',
            listError: 'invalid_request',
        });
    });

    it('preserves the active operation projection when another request is attempted while it is busy', async () => {
        let finishRevoke!: (value: ActionExecuteResult) => void;
        const pendingRevoke = new Promise<ActionExecuteResult>((resolve) => { finishRevoke = resolve; });
        const harness = createHarness([pendingRevoke]);
        harness.controller.setCreateDraft({ label: 'Second token', expiryPreset: '90d' });

        const revoke = harness.controller.revokeToken(TOKEN_A.tokenId);
        const activeState = harness.controller.getState();
        expect(activeState).toMatchObject({
            createDraft: { label: 'Second token', expiryPreset: '90d' },
            operation: 'revoke',
            operationTokenId: TOKEN_A.tokenId,
            operationError: null,
            operationNotice: null,
        });

        await harness.controller.refresh();
        await expect(harness.controller.createToken()).resolves.toBeUndefined();
        await expect(harness.controller.revokeToken(TOKEN_B.tokenId)).resolves.toBe(false);
        await expect(harness.controller.revokeAllTokens()).resolves.toBeNull();
        await expect(harness.controller.signOutEverywhere()).resolves.toBe(false);

        expect(harness.controller.getState()).toEqual(activeState);
        expect(harness.execute).toHaveBeenCalledOnce();

        finishRevoke(ok({ revoked: true }));
        await expect(revoke).resolves.toBe(true);
        expect(harness.controller.getState()).toMatchObject({
            operation: null,
            operationTokenId: null,
            operationError: null,
            operationNotice: 'revoked',
        });
    });

    it('sends the request-owned selector for an ordinary create and keeps it while the row is still listed', async () => {
        const harness = createHarness([
            { ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' },
            ok({ tokens: [TOKEN_A] }),
        ]);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: '90d' });

        await harness.controller.createToken();

        expect(harness.execute).toHaveBeenNthCalledWith(
            1,
            'account.apiTokens.create',
            { tokenId: TOKEN_A.tokenId, label: TOKEN_A.label, expiresAt: '2026-11-20T12:00:00.000Z' },
            expect.objectContaining({ surface: 'ui' }),
        );
        expect(harness.controller.getState()).toMatchObject({
            createError: 'outcome_unknown',
            recoveryTokenId: TOKEN_A.tokenId,
            tokens: [TOKEN_A],
            reveal: null,
        });
    });

    it('discloses nothing when an ordinary create returns a selector this attempt did not request', async () => {
        const harness = createHarness([
            ok({
                token: `hap_v1_${TOKEN_B.tokenId}_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
                apiToken: TOKEN_B,
            }),
            ok({ tokens: [TOKEN_A] }),
        ]);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: '90d' });

        await harness.controller.createToken();

        expect(harness.controller.getState()).toMatchObject({
            createError: 'invalid_response',
            recoveryTokenId: TOKEN_A.tokenId,
            tokens: [TOKEN_A],
            reveal: null,
        });
        // The returned row is never adopted, retried or revoked on this attempt.
        expect(harness.execute.mock.calls.map(([id]) => id)).toEqual([
            'account.apiTokens.create',
            'account.apiTokens.list',
        ]);
    });

    it('reconciles a lost create against the authoritative list before permitting a replacement', async () => {
        const harness = createHarness([
            { ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' },
            ok({ tokens: [TOKEN_A] }),
            ok({ tokens: [] }),
            ok({
                token: `hap_v1_${TOKEN_B.tokenId}_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
                apiToken: TOKEN_B,
            }),
        ]);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: '90d' });

        await harness.controller.createToken();
        expect(harness.controller.getState().recoveryTokenId).toBe(TOKEN_A.tokenId);

        // No replacement may be minted while the request-owned row may still exist.
        await harness.controller.createToken();
        expect(harness.execute).toHaveBeenCalledTimes(2);

        // Another client revoked that exact row; the authoritative list proves absence.
        await harness.controller.refresh();
        expect(harness.controller.getState()).toMatchObject({ recoveryTokenId: null, tokens: [] });

        uuid.next = TOKEN_B.tokenId;
        await harness.controller.createToken();
        expect(harness.execute).toHaveBeenLastCalledWith(
            'account.apiTokens.create',
            expect.objectContaining({ tokenId: TOKEN_B.tokenId }),
            expect.objectContaining({ surface: 'ui' }),
        );
        expect(harness.controller.getState()).toMatchObject({
            reveal: { apiToken: TOKEN_B, acknowledged: false },
            recoveryTokenId: null,
            createError: null,
        });
    });

    it('retains the create draft after a typed failure and reveals a successful secret only in controller memory', async () => {
        const harness = createHarness([
            { ok: false, errorCode: 'present_user_required', error: 'present_user_required' },
            ok({
                token: `hap_v1_${TOKEN_A.tokenId}_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
                apiToken: TOKEN_A,
            }),
        ]);
        harness.controller.setCreateDraft({
            label: TOKEN_A.label,
            expiryPreset: '90d',
            authorizeUnattendedTeamAccess: true,
        });

        await harness.controller.createToken();
        expect(harness.controller.getState()).toMatchObject({
            createDraft: { label: TOKEN_A.label, expiryPreset: '90d', authorizeUnattendedTeamAccess: true },
            createError: 'present_user_required',
            reveal: null,
        });

        await harness.controller.createToken();
        expect(harness.controller.getState()).toMatchObject({
            createError: null,
            reveal: {
                token: `hap_v1_${TOKEN_A.tokenId}_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
                apiToken: TOKEN_A,
                acknowledged: false,
            },
        });
        expect(harness.execute).toHaveBeenLastCalledWith(
            'account.apiTokens.create',
            {
                tokenId: TOKEN_A.tokenId,
                label: TOKEN_A.label,
                expiresAt: '2026-11-20T12:00:00.000Z',
                authorizeUnattendedTeamAccess: true,
            },
            expect.objectContaining({ surface: 'ui', actionCaller: { kind: 'host' } }),
        );
    });

    it.each([
        'unsupported_action',
        'approvals_not_supported',
        'approval_rejected',
        'approval_canceled',
        'action_disabled',
        'account-disabled',
        'invalid_request',
        'invalid_parameters',
        'api_token_encryption_not_ready',
        'api_token_encryption_stale',
        'credential_authentication_evidence_limit',
        'api_token_id_conflict',
    ])('keeps known pre-effect failure %s typed with no recovery row', async (errorCode) => {
        const harness = createHarness([{ ok: false, errorCode, error: errorCode }]);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: '90d' });

        await harness.controller.createToken();

        expect(harness.controller.getState()).toMatchObject({
            createError: errorCode === 'unsupported_action' ? 'unsupported'
                : errorCode === 'invalid_parameters' ? 'invalid_request'
                    : errorCode,
            recoveryTokenId: null,
            reveal: null,
        });
    });

    it('does not infer outcome_unknown from a generic create transport failure', async () => {
        const harness = createHarness([
            { ok: false, errorCode: 'network_error', error: 'network_error' },
        ]);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: '90d' });
        await harness.controller.createToken();
        expect(harness.controller.getState()).toMatchObject({ createError: 'network_error', recoveryTokenId: null });
    });

    it('keeps list state intact when revoke or revoke-all loses an issued response', async () => {
        const harness = createHarness([
            ok({ tokens: [TOKEN_A, TOKEN_B] }),
            { ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' },
            { ok: false, errorCode: 'outcome_unknown', error: 'outcome_unknown' },
        ]);
        await harness.controller.refresh();

        await expect(harness.controller.revokeToken(TOKEN_A.tokenId)).resolves.toBe(false);
        expect(harness.controller.getState()).toMatchObject({
            tokens: [TOKEN_A, TOKEN_B],
            operation: null,
            operationTokenId: null,
            operationError: 'outcome_unknown',
            recoveryTokenId: null,
        });

        harness.controller.clearOperationFeedback();
        await expect(harness.controller.revokeAllTokens()).resolves.toBeNull();
        expect(harness.controller.getState()).toMatchObject({
            tokens: [TOKEN_A, TOKEN_B],
            operation: null,
            operationError: 'outcome_unknown',
            recoveryTokenId: null,
        });
    });

    it('suppresses a late create secret after dismissal and retains its exact recovery selector', async () => {
        let finishCreate!: (value: ActionExecuteResult) => void;
        const pendingCreate = new Promise<ActionExecuteResult>((resolve) => { finishCreate = resolve; });
        const harness = createHarness([pendingCreate, ok({ tokens: [TOKEN_A] })]);
        const confirmDismiss = vi.fn(async () => true);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: '90d' });

        const create = harness.controller.createToken();
        expect(harness.controller.getState()).toMatchObject({ createPending: true, reveal: null });

        await expect(harness.controller.requestRevealDismiss(confirmDismiss, 'shared')).resolves.toBe(true);
        expect(confirmDismiss).not.toHaveBeenCalled();
        expect(harness.controller.getState()).toMatchObject({ createPending: false, reveal: null });

        finishCreate(ok({
            token: `hap_v1_${TOKEN_A.tokenId}_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
            apiToken: TOKEN_A,
        }));
        await create;

        expect(harness.controller.getState()).toMatchObject({
            createPending: false,
            createError: 'outcome_unknown',
            recoveryTokenId: TOKEN_A.tokenId,
            tokens: [TOKEN_A],
            reveal: null,
        });
        expect(harness.execute.mock.calls.map(([actionId]) => actionId)).toEqual([
            'account.apiTokens.create',
            'account.apiTokens.list',
        ]);
    });

    it('warns once for every unacknowledged dismissal path, never traps, and clears the secret on permitted exit', async () => {
        const createResult = ok({
            token: `hap_v1_${TOKEN_A.tokenId}_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
            apiToken: TOKEN_A,
        });
        const harness = createHarness([createResult, createResult]);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: 'none' });
        await harness.controller.createToken();
        const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        await expect(harness.controller.requestRevealDismiss(confirm, 'shared')).resolves.toBe(false);
        expect(harness.controller.getState().reveal?.token).toContain('hap_v1_');
        await expect(harness.controller.requestRevealDismiss(confirm, 'action')).resolves.toBe(true);
        expect(harness.controller.getState().reveal).toBeNull();
        expect(confirm).toHaveBeenCalledTimes(2);

        await harness.controller.createToken();
        harness.controller.acknowledgeReveal();
        await expect(harness.controller.requestRevealDismiss(confirm, 'shared')).resolves.toBe(true);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(harness.controller.getState().reveal).toBeNull();
    });

    it('clears a cancelled create draft even when no secret has been revealed', () => {
        const harness = createHarness([]);
        harness.controller.setCreateDraft({ label: TOKEN_A.label, expiryPreset: '30d' });

        harness.controller.clearReveal();

        expect(harness.controller.getState()).toMatchObject({
            createDraft: { label: '', expiryPreset: '90d' },
            createError: null,
            reveal: null,
        });
    });

    it('keeps a token visible after revoke fails and removes it only after confirmed success', async () => {
        const harness = createHarness([
            ok({ tokens: [TOKEN_A] }),
            ok({ revoked: false }),
            ok({ revoked: true }),
        ]);
        await harness.controller.refresh();

        await expect(harness.controller.revokeToken(TOKEN_A.tokenId)).resolves.toBe(false);
        expect(harness.controller.getState()).toMatchObject({
            tokens: [TOKEN_A],
            operation: null,
            operationError: 'not_revoked',
        });

        await expect(harness.controller.revokeToken(TOKEN_A.tokenId)).resolves.toBe(true);
        expect(harness.controller.getState()).toMatchObject({
            tokens: [],
            operationError: null,
            operationNotice: 'revoked',
        });
    });

    it('revokes one token, revokes all tokens, and signs out sessions with separate Action semantics', async () => {
        const harness = createHarness([
            ok({ tokens: [TOKEN_A, TOKEN_B] }),
            ok({ revoked: true }),
            ok({ revokedCount: 1 }),
            ok({ status: 'signed_out' }),
        ]);
        await harness.controller.refresh();
        await harness.controller.revokeToken(TOKEN_A.tokenId);
        expect(harness.controller.getState().tokens).toEqual([TOKEN_B]);
        await harness.controller.revokeAllTokens();
        expect(harness.controller.getState().tokens).toEqual([]);
        await harness.controller.signOutEverywhere();

        expect(harness.execute.mock.calls.map(([id]) => id)).toEqual([
            'account.apiTokens.list',
            'account.apiTokens.revoke',
            'account.apiTokens.revokeAll',
            'account.sessions.signOutEverywhere',
        ]);
    });

    it('drops content, draft, secret, and stale results when the Account/server scope retires', async () => {
        let finish!: (value: ActionExecuteResult) => void;
        const deferred = new Promise<ActionExecuteResult>((resolve) => { finish = resolve; });
        const harness = createHarness([deferred]);
        harness.controller.setCreateDraft({ label: 'Account A token', expiryPreset: '30d' });

        const pending = harness.controller.refresh();
        harness.lifetime.retire();
        finish(ok({ tokens: [TOKEN_A] }));
        await pending;

        expect(harness.controller.getState()).toMatchObject({
            phase: 'idle',
            tokens: [],
            createDraft: { label: '', expiryPreset: '90d' },
            reveal: null,
        });
    });
});
