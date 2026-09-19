import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import {
    adoptHomeProfile,
    listServerProfiles,
    removeServerProfile,
    resolveSelectedAccountServiceEndpoint,
    setAccountServiceEndpoint,
} from '@/sync/domains/server/serverProfiles';
import { Modal } from '@/modal';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { completeAccountServicePostAuth, type AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';
import { cancelPendingDirectoryHomeEnrollment, getPendingDirectoryHomeEnrollment } from '@/sync/ops/accountDirectory/enrollDirectoryHome';
import { ENROLLMENT_POLL_IDLE_DELAY_MS } from '@/auth/enrollment/enrollmentPollingBackoff';
import { router } from 'expo-router';

installTokenStorageWebPlatformMocks();
const boundary = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/sync/http/client', () => ({
    createServerFetchAtEndpoint: (options: { endpointUrl: string }) => (path: string, init?: RequestInit) => boundary.request(options.endpointUrl, path, init),
    serverFetch: (path: string, init?: RequestInit) => boundary.request('ambient', path, init),
}));
vi.mock('expo-router', async () => (await import('@/dev/testkit/mocks/router')).createExpoRouterMock().module);
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/modal', async () => (await import('@/dev/testkit/mocks/modal')).createModalModuleMock().module);

import { AccountServiceSettingsSection } from './AccountServiceSettingsSection';

/** Non-secret binding to the Account credential a continuation was created under. */
const ACCOUNT_CREDENTIAL_TOKEN_DIGEST = 'C0jknAf55a-WIBFlxj8xId4cq00hoNQDzcbt4__9tlM';

describe('Account Service settings continuation composition', () => {
    let fixture: ReturnType<typeof createDirectoryHttpFixture>;
    let restore: () => void;
    let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
    beforeEach(async () => {
        restore = installLocalStorageMock().restore;
        fixture = createDirectoryHttpFixture();
        boundary.request.mockImplementation(fixture.request);
        await setAccountServiceEndpoint({ url: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId, source: 'user' });
        await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId }, { token: 'directory-token' });
    });
    afterEach(async () => {
        await screen?.unmount();
        screen = undefined;
        await cancelPendingDirectoryHomeEnrollment();
        await TokenStorage.removeCredentialsForServerUrl(fixture.home.canonicalServerUrl, {
            serverId: fixture.home.homeServerIdentityId,
        });
        for (const profile of listServerProfiles()) {
            await removeServerProfile(profile.id);
        }
        restore();
    });

    it('loads the real Directory without inferring enrollment from persisted sign-in', async () => {
        screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen?.findByTestId('settings-account-service-home-srv_home_b')).not.toBeNull());
        expect(fixture.state.calls.some(({ path }) => path.includes('login-assertion') || path === '/v1/auth/home-login')).toBe(false);
        expect(getPendingDirectoryHomeEnrollment()).toBeNull();
    });

    it('opens the canonical full-screen Account Service selection form', async () => {
        screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen?.findByTestId('settings-account-service-status')).not.toBeNull());

        await act(async () => {
            screen!.findByTestId('settings-account-service-advanced')!
                .findByProps({ accessibilityRole: 'button' }).props.onPress();
        });
        await act(async () => {
            await screen!.findByTestId('settings-account-service-select')!.props.onPress();
        });

        expect(screen.findByTestId('settings-account-service-selection')).not.toBeNull();
        expect(screen.findByTestId('account-service-selection-form')).not.toBeNull();

        await act(async () => {
            await screen!.findByTestId('account-service-current-choice')!.props.onPress();
        });
        await vi.waitFor(() => expect(screen?.findByTestId('settings-account-service-selection')).toBeNull());
        expect(resolveSelectedAccountServiceEndpoint()).toMatchObject({
            url: fixture.service.endpointUrl,
            serverIdentityId: fixture.service.serverIdentityId,
            displayName: 'https://directory.test',
            source: 'user',
        });
    });

    it('routes generic Account Service authentication through the non-focusing refresh intent', async () => {
        await TokenStorage.accountDirectoryAuthCredentials.logout({
            endpoint: fixture.service.endpointUrl,
            serverIdentityId: fixture.service.serverIdentityId,
        });
        screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen?.findByTestId('settings-account-service-login')).not.toBeNull());

        await act(async () => {
            await screen!.findByTestId('settings-account-service-login')!.props.onPress();
        });

        expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({
            accountServiceIdentity: fixture.service.serverIdentityId,
            accountIntent: JSON.stringify({ kind: 'refresh' }),
        }) }));
    });

    it('automatically resumes a visible exact pending enrollment through the shared scheduler', async () => {
        const { service } = fixture;
        const input = { service,
            credentialTokenDigest: ACCOUNT_CREDENTIAL_TOKEN_DIGEST,
            session: new AccountDirectorySession({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { capability: service.capability }),
            intent: { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId },
        };
        expect(await completeAccountServicePostAuth(input)).toMatchObject({ kind: 'approval_required' });
        screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen?.findByTestId('settings-account-service-home-srv_home_b')).not.toBeNull());
        fixture.state.approval = 'approved';
        fixture.state.mode = 'e2ee';
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, ENROLLMENT_POLL_IDLE_DELAY_MS + 100)); });
        await vi.waitFor(() => expect(getPendingDirectoryHomeEnrollment()).toBeNull());
        expect(screen.findByTestId('settings-account-service-material-srv_home_b')).not.toBeNull();
        expect(await TokenStorage.getCredentialsForServerUrl(fixture.home.canonicalServerUrl, { serverId: fixture.home.homeServerIdentityId })).toEqual({ token: fixture.token });
        expect(fixture.state.calls.filter(({ path }) => path.includes('login-assertion'))).toHaveLength(1);
        expect(fixture.state.calls.some(({ endpoint }) => endpoint === 'ambient')).toBe(false);
    });

    it('stops delegated sign-in on the Home with that Home\'s own credential and no Account Service write', async () => {
        const homeB = await adoptHomeProfile({ descriptor: fixture.home.connectionDescriptor, source: 'account-directory' });
        await TokenStorage.setCredentialsForServerUrl(homeB.serverUrl, { serverId: fixture.home.homeServerIdentityId }, { token: fixture.token });
        const linkRequests: Array<{ endpoint: string; path: string; init?: RequestInit }> = [];
        boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
            if (path.startsWith('/v1/account/directory-links/')) {
                linkRequests.push({ endpoint, path, init });
                return new Response(JSON.stringify({ v: 1, deleted: true, issuerServerIdentityId: fixture.service.serverIdentityId }), {
                    status: 200, headers: { 'Content-Type': 'application/json' },
                });
            }
            return fixture.request(endpoint, path, init);
        });
        vi.mocked(Modal.confirm).mockResolvedValueOnce(true);
        screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen?.findByTestId('settings-account-service-home-srv_home_b-link')).not.toBeNull());
        // The unlink action lives in the same row menu as remove/set-preferred, which compact rows
        // fold into the overflow popover, so reach it through the row's real action list.
        const homeRowActions = screen.findAllByType(ItemRowActions)
            .map((node) => node.props.actions as ReadonlyArray<{ id: string; destructive?: boolean; onPress?: () => void }>)
            .find((actions) => actions.some((action) => action.id === 'settings-account-service-home-srv_home_b-remove'));
        const unlink = homeRowActions?.find((action) => action.id === 'settings-account-service-home-srv_home_b-unlink');
        expect(unlink).toMatchObject({ destructive: true });
        if (!unlink?.onPress) throw new Error('Expected the unlink action beside remove');

        await act(async () => { unlink.onPress!(); });

        await vi.waitFor(() => expect(linkRequests).toHaveLength(1));
        expect(linkRequests[0]).toMatchObject({
            endpoint: fixture.home.canonicalServerUrl,
            path: `/v1/account/directory-links/${fixture.service.serverIdentityId}`,
        });
        expect(linkRequests[0]?.init?.method).toBe('DELETE');
        expect(fixture.state.calls.filter(({ init }) => init?.method === 'DELETE')).toHaveLength(0);
        expect(Modal.confirm).toHaveBeenCalledOnce();
    });

    it('reauthenticates the retained enrollment intent instead of changing it to automatic entry', async () => {
        screen = await renderScreen(<AccountServiceSettingsSection />);
        await vi.waitFor(() => expect(screen?.findByTestId('settings-account-service-home-srv_home_b-enroll')).not.toBeNull());
        fixture.state.loginAssertionStatus = 401;
        await act(async () => { await screen!.findByTestId('settings-account-service-home-srv_home_b-enroll')!.props.onPress(); });
        await vi.waitFor(() => expect(screen?.findByTestId('account-service-continuation-failure-action')).not.toBeNull());
        await act(async () => { await screen!.findByTestId('account-service-continuation-failure-action')!.props.onPress(); });
        expect(router.push).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({
            accountServiceIdentity: fixture.service.serverIdentityId,
            accountIntent: JSON.stringify({ kind: 'enroll', homeServerIdentityId: fixture.home.homeServerIdentityId }),
        }) }));
    });
});
