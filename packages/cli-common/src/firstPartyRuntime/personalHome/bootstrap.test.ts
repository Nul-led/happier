import { describe, expect, it } from 'vitest';
import { PersonalHomeSignupClosureError } from '../personalHomeSignupPolicy.js';
import { PersonalHomeCredentialsUnverifiedError, runPersonalHomeBootstrap, type PersonalHomeAccountCredentials, type PersonalHomeBootstrapDeps, type PersonalHomeBootstrapReceipt } from './bootstrap.js';
import type { PersonalHomeRuntimeSpec } from './personalHomeRuntimeSpec.js';

type HarnessParams = {
    initialPolicy?: 'enabled' | 'disabled' | 'unknown';
    persistedPort?: number | null;
    persistedCredentials?: PersonalHomeAccountCredentials | null;
    credentialsFromCreate?: PersonalHomeAccountCredentials;
    /** Applies to the first verifyAuthenticatedAccess call (existing-credential check). */
    existingCredentialsVerify?: boolean;
    /** Applies to the post-restart authenticated readback. */
    accessVerified?: boolean;
    /** Server-reported effective policy. */
    policyReadback?: 'enabled' | 'disabled' | 'unknown';
    anonymousSignupRefused?: boolean;
};

type Harness = {
    deps: PersonalHomeBootstrapDeps;
    ops: string[];
    ensureInputs: Array<Readonly<{ spec: PersonalHomeRuntimeSpec; port: number; anonymousSignupEnabled: boolean }>>;
    restartInputs: Array<Readonly<{ spec: PersonalHomeRuntimeSpec; port: number; anonymousSignupEnabled: false }>>;
    receipts: PersonalHomeBootstrapReceipt[];
    getPersistedCredentials: () => PersonalHomeAccountCredentials | null;
    setParams: (params: Partial<HarnessParams>) => void;
};

function createHarness(params: HarnessParams = {}): Harness {
    const mutable: HarnessParams = { ...params };
    const ops: string[] = [];
    const ensureInputs: Harness['ensureInputs'] = [];
    const restartInputs: Harness['restartInputs'] = [];
    const receipts: PersonalHomeBootstrapReceipt[] = [];
    let persistedPort: number | null = params.persistedPort ?? null;
    let persisted: PersonalHomeAccountCredentials | null = params.persistedCredentials ?? null;
    let accountCreatedInHarness = false;

    const deps: PersonalHomeBootstrapDeps = {
        bindLoopback: async () => { ops.push('bind'); },
        resolveNonCollidingPort: async () => { ops.push('resolve-port'); return 43123; },
        readPersistedPort: async () => { ops.push('read-port'); return persistedPort; },
        readPersistedPolicy: async () => mutable.initialPolicy ?? 'enabled',
        ensureRuntimeStarted: async (input) => {
            ops.push('ensure-runtime');
            ensureInputs.push(input);
            persistedPort ??= input.port;
        },
        readPersistedCredentials: async () => { ops.push('read-credentials'); return persisted; },
        createLocalAccount: async () => {
            ops.push('create-account');
            accountCreatedInHarness = true;
            return mutable.credentialsFromCreate ?? { token: 'token-1', secret: 'secret-1' };
        },
        persistCredentials: async (credentials) => {
            ops.push('persist-credentials');
            persisted = credentials;
        },
        verifyAuthenticatedAccess: async () => {
            ops.push('verify-auth');
            if (!accountCreatedInHarness && mutable.existingCredentialsVerify === false) return false;
            return mutable.accessVerified ?? true;
        },
        restartHome: async (input) => { ops.push('restart'); restartInputs.push(input); },
        readEffectivePolicy: async () => {
            ops.push('read-policy');
            return mutable.policyReadback ?? 'disabled';
        },
        probeAnonymousSignupRefused: async () => {
            ops.push('probe-refusal');
            return mutable.anonymousSignupRefused ?? true;
        },
        readListenerOrigin: async () => {
            ops.push('read-listener');
            return 'http://127.0.0.1:43123';
        },
        persistCompletionReceipt: async (receipt) => {
            ops.push('persist-receipt');
            receipts.push(receipt);
            return { profileId: 'profile-1' };
        },
        exposeCarrier: async () => { ops.push('expose-carrier'); },
    };

    return {
        deps,
        ops,
        ensureInputs,
        restartInputs,
        receipts,
        getPersistedCredentials: () => persisted,
        setParams: (next) => { Object.assign(mutable, next); },
    };
}

describe('runPersonalHomeBootstrap', () => {
    it('performs the full caller-visible sequence in order: origin, runtime start, account, closure, restart, refusal, authenticated readback, receipt, carrier', async () => {
        const harness = createHarness();
        const result = await runPersonalHomeBootstrap(harness.deps);

        expect(harness.ops).toEqual([
            'bind',
            'read-port',
            'resolve-port',
            'ensure-runtime',
            'read-credentials',
            'create-account',
            'persist-credentials',
            'restart',
            'read-policy',
            'probe-refusal',
            'read-listener',
            'verify-auth',
            'persist-receipt',
            'expose-carrier',
        ]);
        expect(result.canonicalServerUrl).toBe('http://127.0.0.1:43123');
        expect(result.localServerUrl).toBe('http://127.0.0.1:43123');
        expect(result.port).toBe(43123);
        expect(result.accountCreated).toBe(true);
        expect(result.profileId).toBe('profile-1');
        expect(result.receipt.canonicalServerUrl).toBe('http://127.0.0.1:43123');
        expect(result.receipt.accountCreated).toBe(true);
        expect(harness.receipts).toHaveLength(1);
    });

    it('starts the runtime with the fixed Personal Home specification while bootstrap signup is still enabled', async () => {
        const harness = createHarness();
        await runPersonalHomeBootstrap(harness.deps);

        expect(harness.ensureInputs).toHaveLength(1);
        expect(harness.ensureInputs[0]).toMatchObject({
            port: 43123,
            anonymousSignupEnabled: true,
            spec: {
                purpose: 'personal-home',
                bindAddress: '127.0.0.1',
                canonicalServerUrl: 'http://127.0.0.1:43123',
                encryptionStoragePolicy: 'plaintext_only',
                defaultAccountMode: 'plain',
            },
        });
        expect(harness.restartInputs).toEqual([
            expect.objectContaining({ port: 43123, anonymousSignupEnabled: false }),
        ]);
    });

    it('supports token-only plain credentials: the secret is optional and never required in the result', async () => {
        const harness = createHarness({ credentialsFromCreate: { token: 'token-only-1' } });
        const result = await runPersonalHomeBootstrap(harness.deps);

        expect(result.credentials).toEqual({ token: 'token-only-1' });
        expect('secret' in result.credentials).toBe(false);
        expect(harness.getPersistedCredentials()).toEqual({ token: 'token-only-1' });
    });

    it('refuses to complete or expose the carrier when a fresh anonymous signup attempt is still accepted', async () => {
        const harness = createHarness({ anonymousSignupRefused: false });
        await expect(runPersonalHomeBootstrap(harness.deps)).rejects.toBeInstanceOf(PersonalHomeSignupClosureError);
        expect(harness.ops).not.toContain('persist-receipt');
        expect(harness.ops).not.toContain('expose-carrier');
        expect(harness.receipts).toHaveLength(0);
    });

    it('fails closed when the effective policy readback is unknown, without marking completion', async () => {
        const harness = createHarness({ policyReadback: 'unknown' });
        await expect(runPersonalHomeBootstrap(harness.deps)).rejects.toBeInstanceOf(PersonalHomeSignupClosureError);
        expect(harness.ops).not.toContain('persist-receipt');
        expect(harness.receipts).toHaveLength(0);
    });

    it('retries after a failed attempt: reuses persisted credentials and stable port without creating a duplicate account', async () => {
        const harness = createHarness({ anonymousSignupRefused: false });
        await expect(runPersonalHomeBootstrap(harness.deps)).rejects.toBeInstanceOf(PersonalHomeSignupClosureError);
        expect(harness.receipts).toHaveLength(0);
        expect(harness.ops.filter((op) => op === 'create-account')).toHaveLength(1);
        expect(harness.getPersistedCredentials()).toEqual({ token: 'token-1', secret: 'secret-1' });

        harness.ops.length = 0;
        harness.setParams({ anonymousSignupRefused: true });
        const result = await runPersonalHomeBootstrap(harness.deps);

        expect(harness.ops).not.toContain('create-account');
        expect(harness.ops).not.toContain('resolve-port');
        expect(result.accountCreated).toBe(false);
        expect(result.credentials).toEqual({ token: 'token-1', secret: 'secret-1' });
        expect(result.canonicalServerUrl).toBe('http://127.0.0.1:43123');
        expect(harness.receipts).toHaveLength(1);
        expect(harness.ops[harness.ops.length - 1]).toBe('expose-carrier');
    });

    it('does not reopen anonymous signup when rerunning an already-closed Home', async () => {
        const harness = createHarness({
            initialPolicy: 'disabled',
            persistedCredentials: { token: 'token-existing' },
        });

        await runPersonalHomeBootstrap(harness.deps);

        expect(harness.ensureInputs[0]?.anonymousSignupEnabled).toBe(false);
        expect(harness.restartInputs[0]?.anonymousSignupEnabled).toBe(false);
    });

    it('blocks with a typed error when existing persisted credentials fail verification, and never creates a duplicate account', async () => {
        const harness = createHarness({
            persistedCredentials: { token: 'stale-token' },
            existingCredentialsVerify: false,
        });
        await expect(runPersonalHomeBootstrap(harness.deps)).rejects.toBeInstanceOf(PersonalHomeCredentialsUnverifiedError);
        expect(harness.ops).not.toContain('create-account');
        expect(harness.receipts).toHaveLength(0);
        expect(harness.ops).not.toContain('persist-receipt');
    });

    it('refuses completion when the authenticated local access readback fails after restart', async () => {
        const harness = createHarness({ accessVerified: false });
        await expect(runPersonalHomeBootstrap(harness.deps)).rejects.toBeInstanceOf(PersonalHomeCredentialsUnverifiedError);
        expect(harness.ops).not.toContain('persist-receipt');
        expect(harness.receipts).toHaveLength(0);
    });
});
