import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    encodePasswordCredentialFieldV1,
    type PlainAccountPasswordCredentialV1,
} from '@happier-dev/protocol';

import { createAccountTokenForTests } from '@/dev/testkit/harness/homeGovernanceHarness';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';
import { setServerProfileIdentityForUrl } from '@/sync/domains/server/serverProfiles';
import { getStorage } from '@/sync/domains/state/storage';
import { resetRuntimeFetch, setRuntimeFetch } from '@/utils/system/runtimeFetch';
import { invalidateAccountEncryptionModeCache } from '@/sync/api/account/apiAccountEncryptionMode';

import { createDefaultActionExecutor } from './defaultActionExecutor';

const initialState = getStorage().getState();

describe('default Account Security Action transport', () => {
    let serverId: string;
    let securityResponseOverride: Promise<Response> | null;
    const requests: Array<{ path: string; method: string; body: unknown }> = [];

    beforeEach(async () => {
        getStorage().setState(initialState, true);
        invalidateAccountEncryptionModeCache();
        const profile = await upsertAndActivateServer({ serverUrl: 'https://security-actions.test', name: 'Security Home' });
        await setServerProfileIdentityForUrl(profile.serverUrl, 'srv_security_actions');
        serverId = profile.id;
        securityResponseOverride = null;
        getStorage().getState().activateProfileScope({ serverId, accountId: 'account-a' });
        vi.spyOn(TokenStorage, 'getCredentialsForServerUrl').mockResolvedValue({ token: createAccountTokenForTests('account-a') });
        requests.length = 0;
        setRuntimeFetch(async (input, init) => {
            const path = new URL(String(input)).pathname;
            const body = init?.body ? JSON.parse(String(init.body)) : null;
            requests.push({ path, method: init?.method ?? 'GET', body });
            if (path === '/v1/account/encryption') return Response.json({ mode: 'plain', updatedAt: 1 });
            if (path === '/v2/account/settings') return Response.json({ content: { t: 'plain', v: {} }, version: 1 });
            if (path === '/v1/account/security') {
                if (securityResponseOverride) return await securityResponseOverride;
                return Response.json({
                    v: 1, encryptionMode: 'plain', nativeEmail: 'person@example.test',
                    password: { status: 'enrolled', revision: 4 },
                });
            }
            if (path === '/v1/account/email/change/request') return Response.json({ v: 1, status: 'verification_sent' });
            const status = path.endsWith('/remove') ? 'removed' : path.endsWith('/enroll') ? 'enrolled' : 'updated';
            return Response.json({ v: 1, status });
        });
    });

    afterEach(() => {
        resetRuntimeFetch();
        vi.restoreAllMocks();
        getStorage().setState(initialState, true);
        invalidateAccountEncryptionModeCache();
    });

    it('dispatches all five operations to the captured Home and keeps secret mutations present-user-only', async () => {
        const execute = createDefaultActionExecutor().execute;
        const targetCredential = {
            v: 1,
            kind: 'plain_password_hash',
            hash: {
                v: 1,
                algorithm: 'scrypt',
                parameters: { n: 2 ** 14, r: 8, p: 5, keyLength: 32 },
                salt: encodePasswordCredentialFieldV1(new Uint8Array(16).fill(3)),
                digest: encodePasswordCredentialFieldV1(new Uint8Array(32).fill(5)),
            },
        } as const satisfies PlainAccountPasswordCredentialV1;
        const reauthentication = {
            provider: 'github',
            pending: 'pending-a',
            proof: 'proof-a',
        } as const;
        await expect(execute('account.security.get', {}, {
            serverId, surface: 'ui', authority: 'account_automation', actionCaller: { kind: 'host' },
        })).resolves.toMatchObject({ ok: true, result: { nativeEmail: 'person@example.test' } });
        await expect(execute('account.password.enroll', {
            v: 1,
            kind: 'plain',
            email: 'person@example.test',
            targetCredential,
            reauthentication,
        }, { serverId, surface: 'ui', authority: 'present_user', actionCaller: { kind: 'host' }, bypassApprovals: true })).resolves.toMatchObject({ ok: true });
        await expect(execute('account.password.change', {
            v: 1, kind: 'plain', expectedCredentialRevision: 4,
            currentPassword: 'a sufficiently long password', newPassword: 'a different sufficiently long password',
        }, { serverId, surface: 'ui', authority: 'present_user', actionCaller: { kind: 'host' }, bypassApprovals: true })).resolves.toMatchObject({ ok: true });
        await expect(execute('account.password.remove', {
            v: 1, kind: 'plain', expectedCredentialRevision: 4, currentPassword: 'a sufficiently long password',
        }, { serverId, surface: 'ui', authority: 'present_user', actionCaller: { kind: 'host' }, bypassApprovals: true })).resolves.toMatchObject({ ok: true });
        await expect(execute('account.email.change.request', { v: 1, email: 'next@example.test' }, {
            serverId, surface: 'ui', authority: 'present_user', actionCaller: { kind: 'host' }, bypassApprovals: true,
        })).resolves.toMatchObject({ ok: true });

        expect(requests.filter(({ path }) => path.startsWith('/v1/account/')).map(({ path }) => path)).toEqual(expect.arrayContaining([
            '/v1/account/security', '/v1/account/password/enroll', '/v1/account/password/change',
            '/v1/account/password/remove', '/v1/account/email/change/request',
        ]));
        const enrollRequest = requests.find(({ path }) => path === '/v1/account/password/enroll');
        expect(enrollRequest?.body).toEqual({
            v: 1,
            kind: 'plain',
            email: 'person@example.test',
            targetCredential,
            reauthentication,
        });
        expect(enrollRequest?.body).not.toHaveProperty('password');
        expect(enrollRequest?.body).not.toHaveProperty('requestDigest');
        await expect(execute('account.password.remove', {
            v: 1, kind: 'plain', expectedCredentialRevision: 4, currentPassword: 'a sufficiently long password',
        }, { serverId, surface: 'agent', authority: 'account_automation', actionCaller: { kind: 'host' } })).resolves.toMatchObject({
            ok: false,
        });
    }, 180_000);

    it('retires an in-flight Account Security result when the active Home changes', async () => {
        let release: ((response: Response) => void) | undefined;
        securityResponseOverride = new Promise<Response>((resolve) => { release = resolve; });
        const execution = createDefaultActionExecutor().execute('account.security.get', {}, {
            serverId, surface: 'ui', authority: 'present_user', actionCaller: { kind: 'host' },
        });
        await vi.waitFor(() => expect(requests.some(({ path }) => path === '/v1/account/security')).toBe(true));

        upsertAndActivateServer({ serverUrl: 'https://other-home.test', name: 'Other Home' });
        release?.(Response.json({
            v: 1, encryptionMode: 'plain', nativeEmail: 'must-not-escape@example.test',
            password: { status: 'not_enrolled', revision: null },
        }));

        await expect(execution).resolves.toMatchObject({ ok: false });
    }, 180_000);
});
