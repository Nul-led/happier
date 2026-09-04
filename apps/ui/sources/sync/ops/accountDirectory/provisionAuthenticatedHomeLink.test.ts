import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { provisionAuthenticatedHomeLink } from './provisionAuthenticatedHomeLink';

const order = vi.hoisted((): string[] => []);
const isRelinkConflictMock = vi.hoisted(() => vi.fn((_error: unknown) => false));
const putHomeDirectoryLinkMock = vi.hoisted(() => vi.fn(async () => { order.push('publish-home-link'); }));
const transportCloseMock = vi.hoisted(() => vi.fn(async () => {}));
const resolveHomeEnrollmentTransportMock = vi.hoisted(() => vi.fn(async () => {
    order.push('open-home-transport');
    return { ok: true, transport: { close: transportCloseMock } };
}));
const getCredentialsMock = vi.hoisted(() => vi.fn(async () => ({ token: 'home-token' })));

vi.mock('@/sync/api/accountDirectory/accountDirectoryClient', () => ({
    isAccountDirectoryRelinkConflict: isRelinkConflictMock,
    putHomeDirectoryLink: putHomeDirectoryLinkMock,
}));
vi.mock('@/auth/enrollment/homeEnrollmentTransport', () => ({
    resolveHomeEnrollmentTransport: resolveHomeEnrollmentTransportMock,
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: getCredentialsMock,
    },
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    resolveServerProfileForPortableIdentity: () => ({
        kind: 'resolved',
        profile: { id: 'home-a', name: 'Home A', serverUrl: 'https://home-a.test', serverIdentityId: 'srv_home_a' },
    }),
    buildHomeConnectionDescriptorForProfile: () => ({
        v: 1,
        homeServerIdentityId: 'srv_home_a',
        canonicalServerUrl: 'https://home-a.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home-a.test' }],
    }),
}));

describe('provisionAuthenticatedHomeLink shared publication owner', () => {
    beforeEach(() => {
        order.length = 0;
        vi.clearAllMocks();
    });

    it('lets the shared owner resolve both credential authorities before opening Home transport', async () => {
        const session = {
            serviceKey: 'https://directory.test\u0000srv_account_service',
            readAccountSummary: vi.fn(async () => {
                order.push('read-account-subject');
                return { accountId: 'account-1' };
            }),
            putHome: vi.fn(async () => {
                order.push('publish-account-home');
                return {};
            }),
        } as unknown as AccountDirectorySession;

        await expect(provisionAuthenticatedHomeLink({
            session,
            homeServerIdentityId: 'srv_home_a',
            issuerServerIdentityId: 'srv_account_service',
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) },
            },
        })).resolves.toEqual({ kind: 'linked', homeServerIdentityId: 'srv_home_a' });

        expect(order).toEqual([
            'read-account-subject',
            'open-home-transport',
            'publish-home-link',
            'publish-account-home',
        ]);
        expect(transportCloseMock).toHaveBeenCalledOnce();
    });

    it('fails before Home contact when the authenticated Account Service identity differs from the issuer', async () => {
        const session = {
            serviceKey: 'https://directory.test\u0000srv_other_service',
            readAccountSummary: vi.fn(async () => ({ accountId: 'account-1' })),
            putHome: vi.fn(async () => ({})),
        } as unknown as AccountDirectorySession;

        await expect(provisionAuthenticatedHomeLink({
            session,
            homeServerIdentityId: 'srv_home_a',
            issuerServerIdentityId: 'srv_account_service',
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) },
            },
        })).resolves.toEqual({ kind: 'failed' });

        expect(resolveHomeEnrollmentTransportMock).not.toHaveBeenCalled();
        expect(putHomeDirectoryLinkMock).not.toHaveBeenCalled();
        expect(session.readAccountSummary).not.toHaveBeenCalled();
        expect(session.putHome).not.toHaveBeenCalled();
    });

    it('fails closed when profile resolution does not preserve the captured Home identity', async () => {
        const session = {
            serviceKey: 'https://directory.test\u0000srv_account_service',
            readAccountSummary: vi.fn(async () => ({ accountId: 'account-1' })),
            putHome: vi.fn(async () => ({})),
        } as unknown as AccountDirectorySession;

        await expect(provisionAuthenticatedHomeLink({
            session,
            homeServerIdentityId: 'srv_other_home',
            issuerServerIdentityId: 'srv_account_service',
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) },
            },
        })).resolves.toEqual({ kind: 'unavailable', reason: 'home_profile_unavailable' });

        expect(getCredentialsMock).not.toHaveBeenCalled();
        expect(resolveHomeEnrollmentTransportMock).not.toHaveBeenCalled();
        expect(session.readAccountSummary).not.toHaveBeenCalled();
        expect(session.putHome).not.toHaveBeenCalled();
    });

    it('preserves explicit relink mapping without publishing the Home to the Account Service', async () => {
        const conflict = new Error('conflicting signing key');
        putHomeDirectoryLinkMock.mockRejectedValueOnce(conflict);
        isRelinkConflictMock.mockImplementationOnce((error) => error === conflict);
        const session = {
            serviceKey: 'https://directory.test\u0000srv_account_service',
            readAccountSummary: vi.fn(async () => ({ accountId: 'account-1' })),
            putHome: vi.fn(async () => ({})),
        } as unknown as AccountDirectorySession;

        await expect(provisionAuthenticatedHomeLink({
            session,
            homeServerIdentityId: 'srv_home_a',
            issuerServerIdentityId: 'srv_account_service',
            capability: {
                version: 1,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) },
            },
        })).resolves.toEqual({ kind: 'relink_required', homeServerIdentityId: 'srv_home_a' });

        expect(isRelinkConflictMock).toHaveBeenCalledWith(conflict);
        expect(session.putHome).not.toHaveBeenCalled();
        expect(transportCloseMock).toHaveBeenCalledOnce();
    });
});
