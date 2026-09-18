import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    inTx: vi.fn(),
}));

vi.mock('@/storage/inTx', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/storage/inTx')>()),
    inTx: mocks.inTx,
}));

import { ACCOUNT_PASSWORD_MUTATION_CHALLENGE_PATH_V1, NATIVE_AUTH_PASSWORD_RESET_SUBMIT_PATH_V1 } from '@happier-dev/protocol';
import { createPasswordHashAdmission } from '@/app/auth/password/passwordHashAdmission';
import { setPasswordHashAdmissionForTesting } from '@/app/auth/password/passwordMaterialVerifier';
import { registerAccountSecurityRoutes } from './registerAccountSecurityRoutes';

afterEach(() => {
    setPasswordHashAdmissionForTesting(null);
    mocks.inTx.mockReset();
});

describe('Account Security reset contention classification', () => {
    it('maps password-hash admission pressure to a retryable typed service failure', async () => {
        const admission = createPasswordHashAdmission({ maxConcurrent: 1, maxQueued: 0 });
        setPasswordHashAdmissionForTesting(admission);
        let releaseSlot = () => {};
        const holder = admission.run(() => new Promise<void>((resolve) => { releaseSlot = resolve; }));
        await new Promise((resolve) => setImmediate(resolve));
        try {
            const routes = new Map<string, (request: { body: unknown; validationError?: unknown }, reply: unknown) => Promise<unknown>>();
            const app = {
                authenticate: vi.fn(),
                post: vi.fn((path: string, _options: unknown, handler: (typeof routes extends Map<string, infer T> ? T : never)) => routes.set(path, handler)),
                get: vi.fn(),
            };
            registerAccountSecurityRoutes(app as never);
            const send = vi.fn();
            const code = vi.fn(() => ({ send }));

            await expect(routes.get(ACCOUNT_PASSWORD_MUTATION_CHALLENGE_PATH_V1)!(
                { body: {
                    v: 1,
                    action: 'change',
                    expectedCredentialRevision: 1,
                    normalizedNativeEmail: 'alice@example.test',
                    newPlainPassword: 'replacement password value',
                } },
                { code, send } as never,
            )).resolves.toBeUndefined();
            expect(code).toHaveBeenCalledWith(503);
            expect(send).toHaveBeenCalledWith({ error: 'password_hash_overloaded' });
            expect(mocks.inTx).not.toHaveBeenCalled();
        } finally {
            releaseSlot();
            await holder;
            setPasswordHashAdmissionForTesting(null);
        }
    });

    it('does not relabel an infrastructure transaction failure as an invalid reset bearer', async () => {
        const routes = new Map<string, (request: { body: { token: string; password: string } }, reply: unknown) => Promise<unknown>>();
        const app = {
            authenticate: vi.fn(),
            post: vi.fn((path: string, _options: unknown, handler: (typeof routes extends Map<string, infer T> ? T : never)) => routes.set(path, handler)),
            get: vi.fn(),
        };
        registerAccountSecurityRoutes(app as never);
        const handler = routes.get(NATIVE_AUTH_PASSWORD_RESET_SUBMIT_PATH_V1);
        expect(handler).toBeDefined();
        const contention = new Error('database is locked');
        mocks.inTx.mockRejectedValueOnce(contention);
        const send = vi.fn();
        const code = vi.fn(() => ({ send }));

        await expect(handler!(
            { body: { v: 1, token: 'naot_v1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password: 'replacement password value' } } as never,
            { code, send } as never,
        )).rejects.toBe(contention);
        expect(code).not.toHaveBeenCalledWith(400);
        expect(send).not.toHaveBeenCalled();
    });
});
