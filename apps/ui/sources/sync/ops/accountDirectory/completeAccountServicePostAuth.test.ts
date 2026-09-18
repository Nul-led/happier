import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { completeAccountServicePostAuth, resumeAccountServicePostAuth, supplyAccountServiceHomeMaterial } from './completeAccountServicePostAuth';
import { adoptHomeProfile, buildHomeConnectionDescriptorForProfile, getActiveServerSnapshot, resolveServerProfileForPortableIdentity, resolveServerProfileScopeId } from '@/sync/domains/server/serverProfiles';
import { encodeBase64 } from '@/encryption/base64';
import { CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION } from '@happier-dev/protocol';
import { createDirectoryHttpFixture } from './accountDirectoryTestFixtures';
import { cancelPendingDirectoryHomeEnrollment, resumePendingDirectoryHomeEnrollment } from './enrollDirectoryHome';
import * as activeServerSwitch from '@/sync/domains/server/activeServerSwitch';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: () => request,
    serverFetch: (...args: unknown[]) => request(...args),
}));

const service = {
    endpointUrl: 'https://directory.test',
    serverIdentityId: 'srv_directory',
    canonicalServerUrl: 'https://directory.test',
    capability: {
        version: 1 as const, homeDirectory: true, homeEnrollment: true,
        homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) },
    },
    snapshot: { status: 'ready' as const, features: createRootLayoutFeaturesResponse() },
};

function session(identity = service.serverIdentityId) {
    return new AccountDirectorySession({ endpoint: service.endpointUrl, serverIdentityId: identity }, { capability: service.capability });
}

describe('exact Account post-auth continuation', () => {
    beforeEach(async () => {
        request.mockReset();
        request.mockResolvedValue(new Response(JSON.stringify({ v: 1, homes: [], preferredHomeServerIdentityId: null })));
        await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { token: 'restricted-token' });
    });
    afterEach(() => vi.restoreAllMocks());

    it('rejects mismatched service custody before any request', async () => {
        expect(await completeAccountServicePostAuth({ service, session: session('srv_other'), intent: { kind: 'enter', target: { kind: 'automatic' } } }))
            .toMatchObject({ kind: 'failure', code: { source: 'local', code: 'session_mismatch' }, recovery: 'stop' });
        expect(request).not.toHaveBeenCalled();
    });

    it('stops an aborted intent before any request', async () => {
        const abort = new AbortController();
        abort.abort();
        expect(await completeAccountServicePostAuth({ service, session: session(), intent: { kind: 'enter', target: { kind: 'automatic' } }, signal: abort.signal }))
            .toEqual({ kind: 'stopped', reason: 'cancelled' });
        expect(request).not.toHaveBeenCalled();
    });

    it('refreshes and adopts Directory Homes for account-only Settings authentication without entering a Home', async () => {
        const focusSwitch = vi.spyOn(activeServerSwitch, 'setActiveServerAndSwitch');
        const fixture = createDirectoryHttpFixture();
        fixture.state.approval = 'approved';
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(
            path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : fixture.home.canonicalServerUrl,
            path,
            init,
        ));
        const focus = getActiveServerSnapshot();

        expect(await completeAccountServicePostAuth({
            service,
            session: session(),
            intent: { kind: 'refresh' },
        })).toEqual({ kind: 'account_connected' });
        expect(resolveServerProfileForPortableIdentity(fixture.home.homeServerIdentityId).kind).toBe('resolved');
        expect(getActiveServerSnapshot()).toMatchObject({
            serverId: focus.serverId,
            serverUrl: focus.serverUrl,
            isSelectionExplicit: focus.isSelectionExplicit,
        });
        expect(focusSwitch).not.toHaveBeenCalled();
        expect(fixture.state.calls.map(({ path }) => path)).toEqual(['/v1/account-directory/homes']);
        focusSwitch.mockRestore();
    });

    it('keeps account-only Settings authentication non-focusing when the Directory has no Homes', async () => {
        const focusSwitch = vi.spyOn(activeServerSwitch, 'setActiveServerAndSwitch');
        const focus = getActiveServerSnapshot();

        expect(await completeAccountServicePostAuth({
            service,
            session: session(),
            intent: { kind: 'refresh' },
        })).toEqual({ kind: 'account_connected_no_homes' });
        expect(getActiveServerSnapshot()).toMatchObject({
            serverId: focus.serverId,
            serverUrl: focus.serverUrl,
            isSelectionExplicit: focus.isSelectionExplicit,
        });
        expect(focusSwitch).not.toHaveBeenCalled();
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v1/account-directory/homes']);
        focusSwitch.mockRestore();
    });

    it('still focuses the exact Home for an explicit enter intent', async () => {
        const focusSwitch = vi.spyOn(activeServerSwitch, 'setActiveServerAndSwitch').mockResolvedValue('switched');
        const fixture = createDirectoryHttpFixture();
        fixture.state.approval = 'approved';
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(
            path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : fixture.home.canonicalServerUrl,
            path,
            init,
        ));

        expect(await completeAccountServicePostAuth({
            service,
            session: session(),
            intent: {
                kind: 'enter',
                target: { kind: 'explicit', homeServerIdentityId: fixture.home.homeServerIdentityId },
            },
        })).toEqual({
            kind: 'home_entered',
            homeServerIdentityId: fixture.home.homeServerIdentityId,
            selection: 'explicit',
        });
        const resolved = resolveServerProfileForPortableIdentity(fixture.home.homeServerIdentityId);
        expect(resolved.kind).toBe('resolved');
        expect(focusSwitch).toHaveBeenCalledOnce();
        expect(focusSwitch).toHaveBeenCalledWith(expect.objectContaining({
            serverId: resolved.kind === 'resolved' ? resolveServerProfileScopeId(resolved.profile) : '',
        }));
    });

    it('does not request an assertion when adoption of the selected Home fails', async () => {
        const fixture = createDirectoryHttpFixture();
        const conflictingIdentity = 'srv_conflicting_home';
        await adoptHomeProfile({
            descriptor: {
                ...fixture.home.connectionDescriptor,
                homeServerIdentityId: conflictingIdentity,
            },
            source: 'qr',
        });
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(
            path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : fixture.home.canonicalServerUrl,
            path,
            init,
        ));

        const result = await completeAccountServicePostAuth({
            service,
            session: session(),
            intent: { kind: 'enter', target: { kind: 'automatic' } },
        });

        expect(result).toMatchObject({
            kind: 'failure',
            stage: 'refresh',
            targetHomeServerIdentityId: fixture.home.homeServerIdentityId,
            homeCredentialCommitted: false,
        });
        expect(fixture.state.calls.map(({ path }) => path)).toEqual(['/v1/account-directory/homes']);
    });

    it('refreshes and re-resolves the exact Home before a new enrollment retry', async () => {
        const fixture = createDirectoryHttpFixture();
        let failNextAssertion = true;
        request.mockImplementation((path: string, init?: RequestInit) => {
            if (path.includes('/login-assertion') && failNextAssertion) {
                failNextAssertion = false;
                throw new TypeError('Account Service temporarily unavailable');
            }
            return fixture.request(
                path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : fixture.state.homes[0]!.canonicalServerUrl,
                path,
                init,
            );
        });
        const intent = { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId };
        const input = { service, session: session(), intent };
        const first = await completeAccountServicePostAuth(input);
        expect(first).toMatchObject({ kind: 'failure', stage: 'enroll', recovery: 'retry_stage' });

        const freshHome = {
            ...fixture.home,
            canonicalServerUrl: 'https://home-b-fresh.test',
            updatedAtMs: 2,
            connectionDescriptor: {
                ...fixture.home.connectionDescriptor,
                canonicalServerUrl: 'https://home-b-fresh.test',
                revision: 2,
                endpoints: [{ kind: 'https' as const, url: 'https://home-b-fresh.test' }],
            },
        };
        fixture.state.homes = [freshHome];
        fixture.state.approval = 'approved';

        expect(await resumeAccountServicePostAuth(input, first)).toEqual({
            kind: 'home_enrolled',
            homeServerIdentityId: fixture.home.homeServerIdentityId,
        });
        expect(fixture.state.calls.map(({ path }) => path).filter((path) => path === '/v1/account-directory/homes')).toHaveLength(2);
        expect(fixture.state.calls.filter(({ path }) => path === '/v1/auth/home-login').at(-1)?.endpoint)
            .toBe('https://home-b-fresh.test');
        const resolved = resolveServerProfileForPortableIdentity(fixture.home.homeServerIdentityId);
        if (resolved.kind !== 'resolved') throw new Error('Expected refreshed Home profile');
        expect(buildHomeConnectionDescriptorForProfile(resolved.profile))
            .toMatchObject({ revision: 2, canonicalServerUrl: 'https://home-b-fresh.test' });
    });

    it.each(['different-account-token', 'renewed-same-account-token', null])('stops a held Directory response after credential replacement or logout (%s)', async (replacement) => {
        const fixture = createDirectoryHttpFixture();
        let release!: (response: Response) => void;
        request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
        const original = session();
        const result = completeAccountServicePostAuth({ service, session: original, intent: { kind: 'enter', target: { kind: 'automatic' } } });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const target = { endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId };
        if (replacement) await TokenStorage.accountDirectoryAuthCredentials.set(target, { token: replacement });
        else await TokenStorage.accountDirectoryAuthCredentials.logout(target);
        release(new Response(JSON.stringify({ v: 1, homes: [fixture.home], preferredHomeServerIdentityId: fixture.home.homeServerIdentityId })));
        expect(await result).toEqual({ kind: 'stopped', reason: 'superseded' });
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v1/account-directory/homes']);
        expect(original.snapshot.homes).toEqual([]);
        // An obsolete session must not remove the replacement credential.
        await original.logout();
        expect(await TokenStorage.accountDirectoryAuthCredentials.get(target)).toEqual(replacement ? { token: replacement } : null);
        if (replacement) {
            request.mockResolvedValue(new Response(JSON.stringify({ v: 1, homes: [], preferredHomeServerIdentityId: null })));
            expect(await completeAccountServicePostAuth({ service, session: session(), intent: { kind: 'enter', target: { kind: 'automatic' } } }))
                .toEqual({ kind: 'account_connected_no_homes' });
        }
    });

    it.each(['plain', 'e2ee'] as const)('commits a freshly redeemed same-Account bearer with mode-correct %s material', async (mode) => {
        const fixture = createDirectoryHttpFixture();
        fixture.state.approval = 'approved';
        fixture.state.mode = mode;
        const descriptor = fixture.home.connectionDescriptor;
        await adoptHomeProfile({ descriptor, source: 'qr' });
        const oldToken = fixture.token.replace('signature', 'revoked-signature');
        const material = mode === 'e2ee' ? { secret: encodeBase64(new Uint8Array(32).fill(7), 'base64url') } : {};
        await TokenStorage.setCredentialsForServerUrl(descriptor.canonicalServerUrl, { serverId: descriptor.homeServerIdentityId }, { token: oldToken, ...material });
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : descriptor.canonicalServerUrl, path, init));
        expect(await completeAccountServicePostAuth({ service, session: session(), intent: { kind: 'enroll', homeServerIdentityId: descriptor.homeServerIdentityId } }))
            .toEqual({ kind: 'home_enrolled', homeServerIdentityId: descriptor.homeServerIdentityId });
        expect(await TokenStorage.getCredentialsForServerUrl(descriptor.canonicalServerUrl, { serverId: descriptor.homeServerIdentityId }))
            .toEqual(mode === 'plain' ? { token: fixture.token } : { token: fixture.token, ...material });
    });

    it.each(['legacy secret', 'current encryption'] as const)('removes stale %s material when authoritative Home Account mode is plain', async (shape) => {
        const fixture = createDirectoryHttpFixture();
        fixture.state.approval = 'approved';
        fixture.state.mode = 'plain';
        const descriptor = fixture.home.connectionDescriptor;
        await adoptHomeProfile({ descriptor, source: 'qr' });
        await TokenStorage.setCredentialsForServerUrl(
            descriptor.canonicalServerUrl,
            { serverId: descriptor.homeServerIdentityId },
            shape === 'legacy secret'
                ? { token: fixture.token, secret: encodeBase64(new Uint8Array(32).fill(7), 'base64url') }
                : { token: fixture.token, encryption: {
                    machineKey: encodeBase64(new Uint8Array(32).fill(7), 'base64'),
                    publicKey: encodeBase64(new Uint8Array(32).fill(8), 'base64'),
                } },
        );
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(
            path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : descriptor.canonicalServerUrl,
            path,
            init,
        ));
        const intent = { kind: 'enroll' as const, homeServerIdentityId: descriptor.homeServerIdentityId };

        expect(await resumeAccountServicePostAuth({ service, session: session(), intent }, {
            kind: 'home_material_required',
            homeServerIdentityId: descriptor.homeServerIdentityId,
            intent,
            reason: 'missing_material',
        })).toEqual({ kind: 'home_enrolled', homeServerIdentityId: descriptor.homeServerIdentityId });
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/encryption']);
        expect(await TokenStorage.getCredentialsForServerUrl(
            descriptor.canonicalServerUrl,
            { serverId: descriptor.homeServerIdentityId },
        )).toEqual({ token: fixture.token });
    });

    it('fails at the material stage when plain-mode keyless credential persistence fails', async () => {
        const fixture = createDirectoryHttpFixture();
        fixture.state.approval = 'approved';
        fixture.state.mode = 'plain';
        const descriptor = fixture.home.connectionDescriptor;
        await adoptHomeProfile({ descriptor, source: 'qr' });
        await TokenStorage.setCredentialsForServerUrl(
            descriptor.canonicalServerUrl,
            { serverId: descriptor.homeServerIdentityId },
            { token: fixture.token, secret: encodeBase64(new Uint8Array(32).fill(7), 'base64url') },
        );
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(
            path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : descriptor.canonicalServerUrl,
            path,
            init,
        ));
        const persistSecureStoreValue = SecureStore.setItemAsync;
        vi.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (key, value, options) => {
            const parsed = JSON.parse(value) as unknown;
            if (
                key.includes('auth_credentials')
                && typeof parsed === 'object'
                && parsed !== null
                && !Array.isArray(parsed)
                && Object.keys(parsed).length === 1
                && (parsed as Record<string, unknown>).token === fixture.token
            ) {
                throw new Error('secure storage unavailable');
            }
            await persistSecureStoreValue(key, value, options);
        });
        const intent = { kind: 'enroll' as const, homeServerIdentityId: descriptor.homeServerIdentityId };

        expect(await resumeAccountServicePostAuth({ service, session: session(), intent }, {
            kind: 'home_material_required',
            homeServerIdentityId: descriptor.homeServerIdentityId,
            intent,
            reason: 'missing_material',
        })).toMatchObject({
            kind: 'failure',
            stage: 'material',
            homeCredentialCommitted: true,
            code: { source: 'local', code: 'account_mode_unavailable' },
            recovery: 'stop',
        });
        expect(request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/encryption']);
        expect(await TokenStorage.getCredentialsForServerUrl(
            descriptor.canonicalServerUrl,
            { serverId: descriptor.homeServerIdentityId },
        )).toEqual({ token: fixture.token, secret: expect.any(String) });
    });

    it('commits the fresh same-Account bearer and retains invalid material for pinned recovery', async () => {
        const fixture = createDirectoryHttpFixture();
        fixture.state.approval = 'approved';
        fixture.state.mode = 'e2ee';
        const descriptor = fixture.home.connectionDescriptor;
        await adoptHomeProfile({ descriptor, source: 'qr' });
        const encryption = {
            machineKey: encodeBase64(new Uint8Array(32).fill(7), 'base64'),
            publicKey: encodeBase64(new Uint8Array(32).fill(8), 'base64'),
        };
        await TokenStorage.setCredentialsForServerUrl(descriptor.canonicalServerUrl, { serverId: descriptor.homeServerIdentityId }, {
            token: fixture.token.replace('signature', 'revoked-signature'), encryption,
        });
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : descriptor.canonicalServerUrl, path, init));
        const intent = { kind: 'enter' as const, target: { kind: 'explicit' as const, homeServerIdentityId: descriptor.homeServerIdentityId } };
        const focus = getActiveServerSnapshot();
        expect(await completeAccountServicePostAuth({ service, session: session(), intent })).toEqual({
            kind: 'home_material_required', homeServerIdentityId: descriptor.homeServerIdentityId, intent, reason: 'invalid_material',
        });
        expect(await TokenStorage.getCredentialsForServerUrl(descriptor.canonicalServerUrl, { serverId: descriptor.homeServerIdentityId }))
            .toEqual({ token: fixture.token, encryption });
        expect(await TokenStorage.accountDirectoryAuthCredentials.get({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }))
            .toEqual({ token: 'restricted-token' });
        expect(getActiveServerSnapshot()).toMatchObject({ serverId: focus.serverId, serverUrl: focus.serverUrl });
        expect(fixture.state.calls.filter((call) => call.path === '/v1/account/encryption'))
            .toEqual([expect.objectContaining({ endpoint: descriptor.canonicalServerUrl })]);
    });

    it('stops material completion when the Home credential changes during its mode lookup', async () => {
        const fixture = createDirectoryHttpFixture();
        const descriptor = fixture.home.connectionDescriptor;
        await adoptHomeProfile({ descriptor, source: 'qr' });
        await TokenStorage.setCredentialsForServerUrl(descriptor.canonicalServerUrl, { serverId: descriptor.homeServerIdentityId }, { token: fixture.token });
        let release!: (response: Response) => void;
        request.mockImplementation((path: string) => {
            if (path === '/v1/account/encryption') return new Promise<Response>((resolve) => { release = resolve; });
            throw new Error(`Unexpected request ${path}`);
        });
        const intent = { kind: 'enroll' as const, homeServerIdentityId: descriptor.homeServerIdentityId };
        const result = resumeAccountServicePostAuth({ service, session: session(), intent }, {
            kind: 'home_material_required', homeServerIdentityId: descriptor.homeServerIdentityId, intent, reason: 'missing_material',
        });
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        await TokenStorage.setCredentialsForServerUrl(descriptor.canonicalServerUrl, { serverId: descriptor.homeServerIdentityId }, { token: 'replacement-home-token' });
        release(new Response(JSON.stringify({ mode: 'plain', updatedAt: 0 })));
        expect(await result).toEqual({ kind: 'stopped', reason: 'superseded' });
    });

    it('refuses a held resumed Home approval after Directory credential replacement', async () => {
        await cancelPendingDirectoryHomeEnrollment();
        const fixture = createDirectoryHttpFixture();
        request.mockImplementation((path: string, init?: RequestInit) => fixture.request(path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : fixture.home.canonicalServerUrl, path, init));
        const enrolled = await completeAccountServicePostAuth({ service, session: session(), intent: { kind: 'enroll', homeServerIdentityId: fixture.home.homeServerIdentityId } });
        expect(enrolled.kind).toBe('approval_required');
        fixture.state.approval = 'approved';
        let release!: () => void;
        request.mockImplementation(async (path: string, init?: RequestInit) => {
            const response = await fixture.request(path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : fixture.home.canonicalServerUrl, path, init);
            if (path === '/v1/auth/home-login') await new Promise<void>((resolve) => { release = resolve; });
            return response;
        });
        const resumed = resumePendingDirectoryHomeEnrollment();
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const before = await TokenStorage.getCredentialsForServerUrl(fixture.home.canonicalServerUrl, { serverId: fixture.home.homeServerIdentityId });
        await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { token: 'replacement' });
        release();
        expect(await resumed).toMatchObject({ kind: 'stopped' });
        expect(await TokenStorage.getCredentialsForServerUrl(fixture.home.canonicalServerUrl, { serverId: fixture.home.homeServerIdentityId })).toEqual(before);
        expect(fixture.state.calls.filter((call) => call.path === '/v1/features/authenticated')).toEqual([]);
        await cancelPendingDirectoryHomeEnrollment();
    });

    it.each([
        ['directory_link_not_found', 'use_home_auth'],
        ['invalid_issuer', 'use_home_auth'],
        ['invalid_subject', 'use_home_auth'],
        ['invalid_audience', 'stop'],
        ['approval_rejected', 'stop'],
        ['approval_expired', 'stop'],
    ])('preserves terminal Home error %s for canonical recovery %s', async (code, recovery) => {
        const fixture = createDirectoryHttpFixture();
        request.mockImplementation((path: string, init?: RequestInit) => path === '/v1/auth/home-login'
            ? Promise.resolve(new Response(JSON.stringify({ error: code }), { status: 403 }))
            : fixture.request(path.startsWith('/v1/account-directory/') ? fixture.service.endpointUrl : fixture.home.canonicalServerUrl, path, init));
        const result = await completeAccountServicePostAuth({ service, session: session(), intent: { kind: 'enroll', homeServerIdentityId: fixture.home.homeServerIdentityId } });
        expect(result).toMatchObject({ kind: 'failure', stage: 'enroll', recovery, targetHomeServerIdentityId: fixture.home.homeServerIdentityId });
        if (code === 'approval_rejected' || code === 'approval_expired') {
            expect(result).toMatchObject({ code: { source: 'home', code: code === 'approval_rejected' ? 'rejected' : 'expired' } });
        } else expect(result).toMatchObject({ code: { source: 'directory', code } });
    });

    it('completes explicit Home authentication without repeating a missing Directory target lookup or enrollment', async () => {
        const homeServerIdentityId = 'srv_direct_home';
        const endpoint = 'https://direct-home.test';
        await adoptHomeProfile({ descriptor: { v: 1, homeServerIdentityId, canonicalServerUrl: endpoint,
            revision: 1, endpoints: [{ kind: 'https', url: endpoint }] },
            source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
        const credentials = { token: `header.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub: 'direct-account' })), 'base64')}.signature` };
        await TokenStorage.setCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId }, credentials);
        request.mockImplementation(async (path: string) => {
            if (path === '/v1/account/encryption') return new Response(JSON.stringify({ mode: 'plain', updatedAt: 0 }));
            throw new Error(`Unexpected repeated ceremony: ${path}`);
        });
        const input = { service, session: session(), intent: { kind: 'enroll' as const, homeServerIdentityId } };
        const previous = { kind: 'explicit_target_not_linked' as const, homeServerIdentityId };
        expect(await resumeAccountServicePostAuth(input, previous, { homeServerIdentityId, credentials }))
            .toEqual({ kind: 'home_enrolled', homeServerIdentityId });
        expect(request.mock.calls.every(([path]) => path === '/v1/account/encryption')).toBe(true);
        expect(await resumeAccountServicePostAuth(input, previous, { homeServerIdentityId: 'srv_other', credentials }))
            .toEqual({ kind: 'stopped', reason: 'superseded' });
    });

    it('retains account sign-in with no Homes and preserves an absent explicit target', async () => {
        expect(await completeAccountServicePostAuth({ service, session: session(), intent: { kind: 'enter', target: { kind: 'automatic' } } }))
            .toEqual({ kind: 'account_connected_no_homes' });
        request.mockResolvedValue(new Response(JSON.stringify({ v: 1, homes: [], preferredHomeServerIdentityId: null })));
        expect(await completeAccountServicePostAuth({ service, session: session(), intent: { kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: 'srv_a' } } }))
            .toEqual({ kind: 'explicit_target_not_linked', homeServerIdentityId: 'srv_a' });
    });

    it('uses supplied Home material only after exact Account-bound authentication, without reenrollment', async () => {
        const homeServerIdentityId = 'srv_material_home';
        const endpoint = 'https://material-home.test';
        const descriptor = { v: 1 as const, homeServerIdentityId, canonicalServerUrl: endpoint, revision: 1,
            endpoints: [{ kind: 'https' as const, url: endpoint }] };
        await adoptHomeProfile({ descriptor, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
        const token = `header.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub: 'account-bound' })), 'base64')}.signature`;
        expect(await TokenStorage.setCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId }, { token })).toBe(true);
        expect(resolveServerProfileForPortableIdentity(homeServerIdentityId).kind).toBe('resolved');
        expect(await TokenStorage.getCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId })).toEqual({ token });
        const intent = { kind: 'enroll' as const, homeServerIdentityId };
        const input = { service, session: session(), intent };
        const previous = { kind: 'home_material_required' as const, homeServerIdentityId, intent, reason: 'missing_material' as const };
        const features = createRootLayoutFeaturesResponse({ capabilities: {
            serverIdentity: { serverIdentityId: homeServerIdentityId }, auth: { keyChallenge: { v2: true } },
            accountStoredContentCompatibility: { v: 1, minimumProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION,
                currentProtocolVersion: CURRENT_ACCOUNT_STORED_CONTENT_PROTOCOL_VERSION, declarationTransport: 'http-header-and-socket-auth-v1' },
        } });
        request.mockImplementation(async (path: string, init?: RequestInit) => {
            if (path === '/v1/account/encryption') return new Response(JSON.stringify({ mode: 'e2ee', updatedAt: 0 }));
            if (path === '/v1/features') return new Response(JSON.stringify(features), { headers: { 'Content-Type': 'application/json' } });
            if (path === '/v1/auth/challenge') {
                expect(JSON.parse(String(init?.body))).toEqual({ expectedAccountId: 'account-bound' });
                return new Response(JSON.stringify({ challengeId: 'material-challenge', nonce: 'nonce',
                    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    audience: { origin: endpoint, serverIdentityId: homeServerIdentityId } }));
            }
            if (path === '/v1/auth') return new Response(JSON.stringify({ token }));
            throw new Error(`Unexpected material request: ${path}`);
        });
        const secret = new Uint8Array(32).fill(7);
        const result = await supplyAccountServiceHomeMaterial(input, previous, secret);
        expect(request.mock.calls.map(([path]) => path)).toContain('/v1/auth');
        expect(result).toEqual({ kind: 'home_enrolled', homeServerIdentityId });
        expect(await TokenStorage.getCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId })).toEqual({ token, secret: encodeBase64(secret, 'base64url') });
    });

    it('accepts paired material only for the retained exact Home and Account', async () => {
        const homeServerIdentityId = 'srv_paired_material';
        const endpoint = 'https://paired-material.test';
        await adoptHomeProfile({ descriptor: { v: 1, homeServerIdentityId, canonicalServerUrl: endpoint, revision: 1,
            endpoints: [{ kind: 'https', url: endpoint }] }, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
        const tokenFor = (sub: string) => `header.${encodeBase64(new TextEncoder().encode(JSON.stringify({ sub })), 'base64')}.signature`;
        const token = tokenFor('retained-account');
        await TokenStorage.setCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId }, { token });
        request.mockImplementation(async (path: string) => {
            expect(path).toBe('/v1/account/encryption');
            return new Response(JSON.stringify({ mode: 'e2ee', updatedAt: 0 }));
        });
        const intent = { kind: 'enroll' as const, homeServerIdentityId };
        const input = { service, session: session(), intent };
        const previous = { kind: 'home_material_required' as const, homeServerIdentityId, intent, reason: 'missing_material' as const };
        const secret = encodeBase64(new Uint8Array(32).fill(8), 'base64url');
        expect(await supplyAccountServiceHomeMaterial(input, previous, { homeServerIdentityId,
            credentials: { token: tokenFor('other-account'), secret } })).toMatchObject({ kind: 'home_material_required', reason: 'invalid_material' });
        expect(await TokenStorage.getCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId })).toEqual({ token });
        expect(await supplyAccountServiceHomeMaterial(input, previous, { homeServerIdentityId: 'srv_other',
            credentials: { token, secret } })).toMatchObject({ kind: 'home_material_required', reason: 'invalid_material' });
        expect(await supplyAccountServiceHomeMaterial(input, previous, { homeServerIdentityId,
            credentials: { token, secret } })).toEqual({ kind: 'home_enrolled', homeServerIdentityId });
        expect(await TokenStorage.getCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId })).toEqual({ token, secret });
    });

    it('keeps plaintext token-only and retries mode outages without authenticating the service again', async () => {
        const homeServerIdentityId = 'srv_plain_material';
        const endpoint = 'https://plain-material.test';
        const profile = await adoptHomeProfile({ descriptor: { v: 1, homeServerIdentityId, canonicalServerUrl: endpoint, revision: 1,
            endpoints: [{ kind: 'https', url: endpoint }] }, source: 'account-directory', descriptorAuthority: 'current_connection_observation' });
        expect(buildHomeConnectionDescriptorForProfile(profile)?.homeServerIdentityId).toBe(homeServerIdentityId);
        await TokenStorage.setCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId }, { token: 'plain-token' });
        const intent = { kind: 'enroll' as const, homeServerIdentityId };
        const input = { service, session: session(), intent };
        const previous = { kind: 'home_material_required' as const, homeServerIdentityId, intent, reason: 'missing_material' as const };
        request.mockImplementation(async (path: string) => {
            expect(path).toBe('/v1/account/encryption');
            return new Response('{}', { status: 503 });
        });
        const unavailable = await resumeAccountServicePostAuth(input, previous);
        expect(unavailable).toMatchObject({ kind: 'failure', stage: 'material', recovery: 'retry_stage', homeCredentialCommitted: true });
        request.mockImplementation(async (path: string) => {
            expect(path).toBe('/v1/account/encryption');
            return new Response(JSON.stringify({ mode: 'plain', updatedAt: 0 }));
        });
        expect(await resumeAccountServicePostAuth(input, unavailable)).toEqual({ kind: 'home_enrolled', homeServerIdentityId });
        expect(await TokenStorage.getCredentialsForServerUrl(endpoint, { serverId: homeServerIdentityId })).toEqual({ token: 'plain-token' });
    });
});
