import * as React from 'react';

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';
import type {
    AuthCredentialLifecycleResult,
} from '@/auth/context/AuthContext';

(
    globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
).IS_REACT_ACT_ENVIRONMENT = true;

const runtimeFetchMock = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({
    code: 'mtls-code',
    admissionReference: undefined as string | undefined,
}));
const pendingState = vi.hoisted(() => ({
    current: true,
    value: {
        provider: 'mtls',
        serverId: 'server-a',
        serverUrl: 'https://api.example.test',
        returnTo: '/setup/wizard',
    } as Record<string, unknown>,
}));

vi.mock('@/utils/system/runtimeFetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchMock(...args),
}));

const routerReplaceMock = vi.fn();
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: { replace: routerReplaceMock },
        params: routeParams,
    }).module;
});

const modalAlertMock = vi.fn(async () => {});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: { alert: modalAlertMock },
    }).module;
});

const loginWithCredentialsMock = vi.fn<
    (...args: unknown[]) => Promise<AuthCredentialLifecycleResult>
>(async () => ({ kind: 'completed' }));
const clearPendingExternalAuthMock = vi.fn(async (_options?: unknown) => true);
const recordTeamInvitationPostAuthContinuationMock = vi.fn(async (
    expected: Record<string, unknown>,
    continuation: Record<string, unknown>,
) => ({ ...expected, postAuthInvitation: continuation }));
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ loginWithCredentials: loginWithCredentialsMock }),
}));

vi.mock('@/components/account/presentFirstKeyCredentialLifecycle', () => ({
    presentFirstKeyCredentialLifecycle: async (params: Readonly<{
        run: () => Promise<AuthCredentialLifecycleResult>;
        onCompleted?: () => void | Promise<void>;
    }>) => {
        const result = await params.run();
        if (result.kind === 'completed') await params.onCompleted?.();
    },
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-b', serverUrl: 'https://other.example.test', generation: 2 }),
}));

vi.mock('@/sync/domains/server/readConfiguredServerUrlEnv', () => ({
    readConfiguredServerUrlEnv: () => '',
    readConfiguredServerUrlEnvRaw: () => '',
}));

vi.mock('@/auth/storage/tokenStorage', () => {
    const accountDirectoryAuthCredentials = {
        read: vi.fn(async () => ({ kind: 'absent' as const })),
        get: vi.fn(async () => null),
        set: vi.fn(async () => true),
        remove: vi.fn(async () => true),
        clear: vi.fn(async () => true),
        logout: vi.fn(async () => true),
    };
    return {
        ACCOUNT_DIRECTORY_AUTH_CREDENTIALS_STORAGE_KEY: 'account-directory-auth-credentials-v1',
        accountDirectoryAuthCredentials,
        TokenStorage: {
            accountDirectoryAuthCredentials,
        getCredentials: vi.fn(async () => null),
        getCredentialsForServerUrl: vi.fn(async () => null),
        invalidateCredentialsTokenForServerUrl: vi.fn(async () => false),
        readPendingExternalAuthContinuationState: vi.fn(async () => ({
            value: pendingState.value,
            serverMismatch: false,
        })),
        isPendingExternalAuthContinuationCurrent: vi.fn(async () => pendingState.current),
        clearPendingExternalAuth: (options?: unknown) => clearPendingExternalAuthMock(options),
        recordTeamInvitationPostAuthContinuation: (
            expected: Record<string, unknown>,
            continuation: Record<string, unknown>,
            target: Record<string, unknown>,
        ) => recordTeamInvitationPostAuthContinuationMock(expected, continuation, target),
        },
    };
});

beforeEach(() => {
    routeParams.code = 'mtls-code';
    routeParams.admissionReference = undefined;
    pendingState.current = true;
    pendingState.value = {
        provider: 'mtls',
        serverId: 'server-a',
        serverUrl: 'https://api.example.test',
        returnTo: '/setup/wizard',
    };
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

afterEach(async () => {
    try {
        const { stopAllEndpointSupervisorsForTests } = await import('@/sync/runtime/connectivity/endpointSupervisorPool');
        await stopAllEndpointSupervisorsForTests();
    } catch {
        // ignore
    }
    runtimeFetchMock.mockReset();
    modalAlertMock.mockClear();
    routerReplaceMock.mockClear();
    loginWithCredentialsMock.mockClear();
    recordTeamInvitationPostAuthContinuationMock.mockClear();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
});

function okJson(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('MtlsCallbackScreen', () => {
    it('uses runtimeFetch via serverFetch (not global fetch) to claim the mtls token', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error('Unexpected global fetch call');
        });
        vi.stubGlobal('fetch', fetchMock as any);

        runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
            if (url.includes('/health')) return okJson({ status: 'ok' });
            if (url.includes('/v1/auth/mtls/claim')) return okJson({ token: 'mtls-token' });
            return okJson({});
        });

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');

        await act(async () => {
            await renderScreen(React.createElement(MtlsCallbackScreen));
        });

        await act(async () => {
            await new Promise<void>((resolve) => queueMicrotask(resolve));
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).includes('https://api.example.test/v1/auth/mtls/claim'))).toBe(true);
        expect(loginWithCredentialsMock).toHaveBeenCalledWith(
            { token: 'mtls-token' },
            { target: { serverId: 'server-a', serverUrl: 'https://api.example.test' } },
        );
        expect(clearPendingExternalAuthMock).toHaveBeenCalledWith({
            serverId: 'server-a',
            serverUrl: 'https://api.example.test',
        });
        expect(routerReplaceMock).toHaveBeenCalledWith('/setup/wizard');
    });

    it('rejects an unexpected Team admission reference on an ordinary Home callback', async () => {
        routeParams.admissionReference = 'injected-team-reference';

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await act(async () => { await renderScreen(<MtlsCallbackScreen />); });
        await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });

        expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).includes('/v1/auth/mtls/claim'))).toBe(false);
        expect(loginWithCredentialsMock).not.toHaveBeenCalled();
        expect(clearPendingExternalAuthMock).toHaveBeenCalledWith({ serverId: 'server-a', serverUrl: 'https://api.example.test' });
        expect(routerReplaceMock).toHaveBeenCalledWith('/setup/wizard');
    });

    it('claims and completes the exact Team mTLS continuation', async () => {
        routeParams.admissionReference = 'mtls-admission-1';
        pendingState.value = {
            provider: 'mtls', serverId: 'server-a', serverUrl: 'https://api.example.test',
            teamContinuation: {
                v: 1, purpose: 'team_admission', admissionReference: 'mtls-admission-1', teamId: 'team-1',
                homeServerIdentityId: 'server-a', destination: { kind: 'team_sign_in', teamId: 'team-1' },
            },
        };
        runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/health')) return okJson({ status: 'ok' });
            if (url.includes('/v1/auth/mtls/claim')) return okJson({ token: 'team-token', teamId: 'team-1' });
            return okJson({});
        });

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await act(async () => { await renderScreen(<MtlsCallbackScreen />); });
        await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });

        const claimCall = runtimeFetchMock.mock.calls.find(([input]) => String(input).includes('/v1/auth/mtls/claim'));
        expect(JSON.parse(String(claimCall?.[1]?.body))).toEqual({ code: 'mtls-code', admissionReference: 'mtls-admission-1' });
        expect(loginWithCredentialsMock).toHaveBeenCalledWith(
            { token: 'team-token' },
            { target: { serverId: 'server-a', serverUrl: 'https://api.example.test' } },
        );
        expect(routerReplaceMock).toHaveBeenCalledWith('/teams/team-1/sign-in?target=server-a');
    });

    it('retains an existing-Account invitation continuation for the canonical explicit Join', async () => {
        routeParams.admissionReference = 'mtls-admission-1';
        const pending = {
            provider: 'mtls', serverId: 'server-a', serverUrl: 'https://api.example.test',
            teamContinuation: {
                v: 1, purpose: 'team_admission', admissionReference: 'mtls-admission-1', teamId: 'team-1',
                homeServerIdentityId: 'server-a', destination: { kind: 'team_sign_in', teamId: 'team-1' },
            },
        };
        const invitationContinuation = {
            v: 1,
            kind: 'post_auth_invitation',
            reference: 'mtls_claim_mtls-admission-1',
            teamId: 'team-1',
        };
        pendingState.value = pending;
        runtimeFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/health')) return okJson({ status: 'ok' });
            if (url.includes('/v1/auth/mtls/claim')) return okJson({
                token: 'team-token',
                teamId: 'team-1',
                teamInvitationContinuation: invitationContinuation,
            });
            return okJson({});
        });

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await act(async () => { await renderScreen(<MtlsCallbackScreen />); });
        await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });

        expect(recordTeamInvitationPostAuthContinuationMock).toHaveBeenCalledWith(
            pending,
            invitationContinuation,
            { serverId: 'server-a', serverUrl: 'https://api.example.test' },
        );
        expect(loginWithCredentialsMock).toHaveBeenCalledWith(
            { token: 'team-token' },
            { target: { serverId: 'server-a', serverUrl: 'https://api.example.test' } },
        );
        expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
        expect(routerReplaceMock).toHaveBeenCalledWith(
            '/teams/team-1/sign-in?target=server-a&postAuthInvitation=1',
        );
    });

    it('rejects a callback whose Team admission reference does not match pending custody', async () => {
        routeParams.admissionReference = 'mtls-admission-other';
        pendingState.value = {
            provider: 'mtls', serverId: 'server-a', serverUrl: 'https://api.example.test',
            teamContinuation: {
                v: 1, purpose: 'team_admission', admissionReference: 'mtls-admission-1', teamId: 'team-1',
                homeServerIdentityId: 'server-a', destination: { kind: 'team_sign_in', teamId: 'team-1' },
            },
        };

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await act(async () => { await renderScreen(<MtlsCallbackScreen />); });
        await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });

        expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).includes('/v1/auth/mtls/claim'))).toBe(false);
        expect(loginWithCredentialsMock).not.toHaveBeenCalled();
        expect(clearPendingExternalAuthMock).toHaveBeenCalledWith({ serverId: 'server-a', serverUrl: 'https://api.example.test' });
        expect(routerReplaceMock).toHaveBeenCalledWith('/teams/team-1/sign-in?target=server-a');
    });

    it.each([
        { name: 'wrong Team', response: { token: 'team-token', teamId: 'team-other' } },
        { name: 'missing token', response: { teamId: 'team-1' } },
        {
            name: 'mismatched invitation continuation',
            response: {
                token: 'team-token',
                teamId: 'team-1',
                teamInvitationContinuation: {
                    v: 1,
                    kind: 'post_auth_invitation',
                    reference: 'mtls_claim_mtls-admission-1',
                    teamId: 'team-other',
                },
            },
        },
    ])('fails $name through the exact Team recovery path', async ({ response }) => {
        pendingState.value = {
            provider: 'mtls', serverId: 'server-a', serverUrl: 'https://api.example.test',
            teamContinuation: {
                v: 1, purpose: 'team_admission', admissionReference: 'mtls-admission-1', teamId: 'team-1',
                homeServerIdentityId: 'server-a', destination: { kind: 'team_sign_in', teamId: 'team-1' },
            },
        };
        runtimeFetchMock.mockImplementation(async () => okJson(response));

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await act(async () => { await renderScreen(<MtlsCallbackScreen />); });
        await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });

        expect(loginWithCredentialsMock).not.toHaveBeenCalled();
        expect(recordTeamInvitationPostAuthContinuationMock).not.toHaveBeenCalled();
        expect(clearPendingExternalAuthMock).toHaveBeenCalledWith({ serverId: 'server-a', serverUrl: 'https://api.example.test' });
        expect(routerReplaceMock).toHaveBeenCalledWith('/teams/team-1/sign-in?target=server-a');
    });

    it('fails a replayed continuation before claim and returns to the exact Team', async () => {
        pendingState.current = false;
        pendingState.value = {
            provider: 'mtls', serverId: 'server-a', serverUrl: 'https://api.example.test',
            teamContinuation: {
                v: 1, purpose: 'team_admission', admissionReference: 'mtls-admission-1', teamId: 'team-1',
                homeServerIdentityId: 'server-a', destination: { kind: 'team_sign_in', teamId: 'team-1' },
            },
        };

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await act(async () => { await renderScreen(<MtlsCallbackScreen />); });
        await act(async () => { await new Promise<void>((resolve) => queueMicrotask(resolve)); });

        expect(runtimeFetchMock.mock.calls.some(([input]) => String(input).includes('/v1/auth/mtls/claim'))).toBe(false);
        expect(clearPendingExternalAuthMock).toHaveBeenCalled();
        expect(routerReplaceMock).toHaveBeenCalledWith('/teams/team-1/sign-in?target=server-a');
    });

    it('does not navigate as a successful mTLS replacement when credential recovery fails', async () => {
        loginWithCredentialsMock.mockResolvedValueOnce({
            kind: 'recovery_failed',
        });
        runtimeFetchMock.mockImplementation(async () => okJson({
            token: 'replacement-token',
        }));

        const { default: MtlsCallbackScreen } = await import('@/app/(app)/mtls');
        await act(async () => {
            await renderScreen(React.createElement(MtlsCallbackScreen));
        });
        await act(async () => {
            await new Promise<void>((resolve) => queueMicrotask(resolve));
        });

        expect(loginWithCredentialsMock).toHaveBeenCalledWith(
            { token: 'replacement-token' },
            { target: { serverId: 'server-a', serverUrl: 'https://api.example.test' } },
        );
        expect(clearPendingExternalAuthMock).not.toHaveBeenCalled();
        expect(routerReplaceMock).not.toHaveBeenCalled();
        expect(modalAlertMock).not.toHaveBeenCalled();
    });
});
