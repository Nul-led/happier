import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock } from '@/auth/storage/tokenStorage.web.testHelpers';
import { createDirectoryHttpFixture } from '@/sync/ops/accountDirectory/accountDirectoryTestFixtures';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { setAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';
import { completeAccountServicePostAuth, type AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';
import { cancelPendingDirectoryHomeEnrollment, getPendingDirectoryHomeEnrollment } from '@/sync/ops/accountDirectory/enrollDirectoryHome';
import { ENROLLMENT_POLL_IDLE_DELAY_MS } from '@/auth/enrollment/enrollmentPollingBackoff';

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

import { AccountServiceContinuation } from './AccountServiceContinuation';

describe('exact invoking-surface continuation', () => {
    let fixture: ReturnType<typeof createDirectoryHttpFixture>;
    let restore: () => void;
    let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
    beforeEach(() => {
        restore = installLocalStorageMock().restore;
        fixture = createDirectoryHttpFixture();
        boundary.request.mockImplementation(fixture.request);
    });
    afterEach(async () => { await screen?.unmount(); screen = undefined; await cancelPendingDirectoryHomeEnrollment(); restore(); });

    it('requests exact service reauthentication rather than treating recovery as Back', async () => {
        const input = { service: fixture.service,
            session: new AccountDirectorySession({ endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId }, { capability: fixture.service.capability }),
            intent: { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId } };
        let received: unknown;
        screen = await renderScreen(<AccountServiceContinuation input={input}
            result={{ kind: 'failure', stage: 'refresh', code: { source: 'directory', code: 'invalid_token' }, recovery: 'reauthenticate_account', accountCredentialCommitted: true, homeCredentialCommitted: false }}
            onResult={() => {}} onBack={() => {}} onReauthenticate={(value) => { received = value; }} />);
        await screen.pressByTestIdAsync('account-service-continuation-failure-action');
        expect(received).toBe(input);
    });

    it('explains each typed continuation failure with its own copy instead of one enrollment body', async () => {
        const input = { service: fixture.service,
            session: new AccountDirectorySession({ endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId }, { capability: fixture.service.capability }),
            intent: { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId } };
        screen = await renderScreen(<AccountServiceContinuation input={input}
            result={{ kind: 'failure', stage: 'enroll', code: { source: 'home', code: 'rejected' }, recovery: 'stop', accountCredentialCommitted: true, homeCredentialCommitted: false }}
            onResult={() => {}} onBack={() => {}} />);
        expect(screen.getTextContent()).toContain('A trusted device rejected this request');
        expect(screen.getTextContent()).not.toContain('Open Account settings to continue connecting the Home');
        await screen.unmount();

        screen = await renderScreen(<AccountServiceContinuation input={input}
            result={{ kind: 'failure', stage: 'refresh', code: { source: 'directory', code: 'account-disabled' }, recovery: 'stop', accountCredentialCommitted: true, homeCredentialCommitted: false }}
            onResult={() => {}} onBack={() => {}} />);
        expect(screen.getTextContent()).toContain('This account is disabled');
        expect(screen.getTextContent()).not.toContain('Open Account settings to continue connecting the Home');
    });

    it('offers a rejected approval the same fresh attempt expiry already gets', async () => {
        const input = { service: fixture.service,
            session: new AccountDirectorySession({ endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId }, { capability: fixture.service.capability }),
            intent: { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId } };
        screen = await renderScreen(<AccountServiceContinuation input={input}
            result={{ kind: 'failure', stage: 'enroll', code: { source: 'home', code: 'rejected' }, recovery: 'stop', accountCredentialCommitted: true, homeCredentialCommitted: false }}
            onResult={() => {}} onBack={() => {}} />);
        expect(screen.getTextContent()).toContain('Start Again');
    });

    it('tells the waiting user what to do and confirms the sign-in survived stop-waiting', async () => {
        const input = { service: fixture.service,
            session: new AccountDirectorySession({ endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId }, { capability: fixture.service.capability }),
            intent: { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId } };
        let backs = 0;
        screen = await renderScreen(<AccountServiceContinuation input={input}
            result={{ kind: 'approval_required', homeServerIdentityId: fixture.home.homeServerIdentityId, expiresAtMs: Date.now() + 300_000 }}
            onResult={() => {}} onBack={() => { backs += 1; }} />);
        expect(screen.getTextContent()).toContain('Approve this sign-in from your other signed-in device');
        // The Home name and the expiry stay as the secondary line they already were.
        expect(screen.getTextContent()).toContain('·');

        await screen.pressByTestIdAsync('account-service-continuation-approval_required-action');
        expect(backs).toBe(0);
        expect(screen.getTextContent()).toContain('Stopped waiting for approval');
        expect(screen.getTextContent()).toContain('Your sign-in is still saved');

        await screen.pressByTestIdAsync('account-service-approval-stopped-action');
        expect(backs).toBe(1);
    });

    it('names each choosable Home by address and marks the preferred one', async () => {
        const { service } = fixture;
        const input = { service, session: new AccountDirectorySession({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { capability: service.capability }),
            intent: { kind: 'enter' as const, target: { kind: 'automatic' as const } } };
        const other = { ...fixture.home, homeServerIdentityId: 'srv_other', label: 'Other Home', canonicalServerUrl: 'https://other.example.test', preferred: false };
        screen = await renderScreen(<AccountServiceContinuation input={input}
            result={{ kind: 'choose_home', homes: [{ ...fixture.home, preferred: true }, other] }}
            onResult={() => {}} onBack={() => {}} />);
        const text = screen.getTextContent();
        expect(text).toContain(fixture.home.canonicalServerUrl);
        expect(text).toContain('https://other.example.test');
        expect(text).toContain('Preferred');
    });

    it('opens exact Home authentication with the current coordinator result', async () => {
        const input = { service: fixture.service,
            session: new AccountDirectorySession({ endpoint: fixture.service.endpointUrl, serverIdentityId: fixture.service.serverIdentityId }, { capability: fixture.service.capability }),
            intent: { kind: 'enter' as const, target: { kind: 'explicit' as const, homeServerIdentityId: fixture.home.homeServerIdentityId } } };
        const previous = { kind: 'explicit_target_not_linked' as const, homeServerIdentityId: fixture.home.homeServerIdentityId };
        const onOpenHomeAuthentication = vi.fn();
        screen = await renderScreen(<AccountServiceContinuation input={input} result={previous}
            onResult={() => {}} onBack={() => {}} onOpenHomeAuthentication={onOpenHomeAuthentication} />);

        await screen.pressByTestIdAsync('account-service-direct-home-auth');

        expect(onOpenHomeAuthentication).toHaveBeenCalledWith(input, fixture.home.homeServerIdentityId, previous);
    });

    it('admits only one Home choice while the shared coordinator is refreshing', async () => {
        const { service } = fixture;
        await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { token: 'directory-token' });
        const input = { service, session: new AccountDirectorySession({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { capability: service.capability }),
            intent: { kind: 'enter' as const, target: { kind: 'automatic' as const } } };
        const other = { ...fixture.home, homeServerIdentityId: 'srv_other', label: 'Other Home' };
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let homeReads = 0;
        boundary.request.mockImplementation(async (endpoint: string, path: string, init?: RequestInit) => {
            if (path === '/v1/account-directory/homes') { homeReads += 1; await gate; }
            return fixture.request(endpoint, path, init);
        });
        const outcomes: AccountPostAuthResult[] = [];
        screen = await renderScreen(<AccountServiceContinuation input={input} result={{ kind: 'choose_home', homes: [fixture.home, other] }} onResult={(result) => { outcomes.push(result); }} onBack={() => {}} />);
        let first!: Promise<void>;
        act(() => { first = screen!.findByTestId(`account-service-choose-home-${fixture.home.homeServerIdentityId}`)!.props.onPress(); });
        await vi.waitFor(() => expect(homeReads).toBe(1));
        let second!: Promise<void>;
        act(() => { second = screen!.findByTestId('account-service-choose-home-srv_other')!.props.onPress(); });
        try {
            await act(async () => { await Promise.resolve(); });
            expect(homeReads).toBe(1);
        } finally {
            await act(async () => { release(); await Promise.all([first, second]); });
        }
        expect(outcomes).toHaveLength(1);
    });

    it('resumes retained authority even when device service selection changes', async () => {
        const { service } = fixture;
        const controller = new AbortController();
        await TokenStorage.accountDirectoryAuthCredentials.set({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { token: 'directory-token' });
        const input = { service,
            session: new AccountDirectorySession({ endpoint: service.endpointUrl, serverIdentityId: service.serverIdentityId }, { capability: service.capability }),
            intent: { kind: 'enroll' as const, homeServerIdentityId: fixture.home.homeServerIdentityId },
            signal: controller.signal,
        };
        const initial = await completeAccountServicePostAuth(input);
        expect(initial.kind).toBe('approval_required');
        controller.abort();
        let outcome: AccountPostAuthResult = initial;
        function Invoker() {
            const [result, setResult] = React.useState(initial);
            return <AccountServiceContinuation input={input} result={result} onResult={(next) => { outcome = next; setResult(next); }} onBack={() => {}} />;
        }
        screen = await renderScreen(<Invoker />);
        await setAccountServiceEndpoint({ url: 'https://unrelated.test', serverIdentityId: 'srv_unrelated', source: 'user' });
        fixture.state.approval = 'approved';
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, ENROLLMENT_POLL_IDLE_DELAY_MS + 100)); });
        await vi.waitFor(() => expect(outcome).toEqual({ kind: 'home_enrolled', homeServerIdentityId: fixture.home.homeServerIdentityId }));
        expect(getPendingDirectoryHomeEnrollment()).toBeNull();
        expect(fixture.state.calls.some(({ endpoint }) => endpoint === 'ambient' || endpoint === 'https://unrelated.test')).toBe(false);
        expect(fixture.state.calls.filter(({ path }) => path.includes('login-assertion'))).toHaveLength(1);
    });
});
