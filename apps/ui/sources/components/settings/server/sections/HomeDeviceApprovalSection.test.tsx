import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import type { PendingPreferredHomeEnrollment } from '@/sync/ops/accountDirectory/enrollPreferredDirectoryHome';
import type { HomeLoginContinuationResult } from '@/sync/ops/accountDirectory/homeLoginApproval';

type ListHomeDeviceApprovals = (typeof import('@/auth/approval/homeDeviceApprovalClient'))['listHomeDeviceApprovals'];
type DecideHomeDeviceApproval = (typeof import('@/auth/approval/homeDeviceApprovalClient'))['decideHomeDeviceApproval'];
type ResolveHomeEnrollmentTransport = (typeof import('@/auth/enrollment/homeEnrollmentTransport'))['resolveHomeEnrollmentTransport'];
type GetCredentialsForServerUrl = (typeof import('@/auth/storage/tokenStorage'))['TokenStorage']['getCredentialsForServerUrl'];

const appStateEmitter = vi.hoisted(async () => {
    const { createReactNativeAppStateEmitter } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeAppStateEmitter('active');
});

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { get OS() { return 'android'; } },
            AppState: (await appStateEmitter).appState,
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
});

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title }: any) => React.createElement('ItemGroup', { title }, children),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

const listMock = vi.hoisted(() => vi.fn<ListHomeDeviceApprovals>());
const decideMock = vi.hoisted(() => vi.fn<DecideHomeDeviceApproval>());
const resolveTransportMock = vi.hoisted(() => vi.fn<ResolveHomeEnrollmentTransport>());
const closeTransportMock = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlMock = vi.hoisted(() => vi.fn<GetCredentialsForServerUrl>(
    async () => ({ token: 'home-b-full-credential' }),
));
const pendingEnrollmentSnapshot = vi.hoisted(() => ({
    current: null as PendingPreferredHomeEnrollment | null,
}));
const pendingEnrollmentListeners = vi.hoisted(() => new Set<() => void>());
const resumePendingEnrollmentMock = vi.hoisted(() => vi.fn<() => Promise<HomeLoginContinuationResult | null>>(async () => null));
const cancelPendingEnrollmentMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/auth/approval/homeDeviceApprovalClient', () => ({
    listHomeDeviceApprovals: (...args: Parameters<ListHomeDeviceApprovals>) => listMock(...args),
    decideHomeDeviceApproval: (...args: Parameters<DecideHomeDeviceApproval>) => decideMock(...args),
}));
vi.mock('@/auth/enrollment/homeEnrollmentTransport', () => ({
    resolveHomeEnrollmentTransport: (...args: Parameters<ResolveHomeEnrollmentTransport>) => resolveTransportMock(...args),
}));
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
    return {
        ...actual,
        TokenStorage: {
            ...actual.TokenStorage,
            getCredentialsForServerUrl: (...args: Parameters<GetCredentialsForServerUrl>) => getCredentialsForServerUrlMock(...args),
        },
    };
});
vi.mock('@/sync/ops/accountDirectory/enrollPreferredDirectoryHome', () => ({
    getPendingPreferredHomeEnrollment: () => pendingEnrollmentSnapshot.current,
    subscribePendingPreferredHomeEnrollment: (listener: () => void) => {
        pendingEnrollmentListeners.add(listener);
        return () => pendingEnrollmentListeners.delete(listener);
    },
    resumePendingPreferredHomeEnrollment: () => resumePendingEnrollmentMock(),
    cancelPendingPreferredHomeEnrollment: () => cancelPendingEnrollmentMock(),
}));
vi.mock('@/utils/platform/desktopHost', () => ({
    isDesktopHost: () => false,
}));

const HOME_ENDPOINT_ID = 'f'.repeat(64);

const HOME: ServerProfile = {
    id: 'home-b-profile',
    name: 'Home B',
    serverUrl: 'https://home-b.test',
    canonicalServerUrl: 'https://canonical.home-b.test',
    serverIdentityId: 'srv_home_b',
    connectionDescriptorRevision: 7,
    homeConnectionDescriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_b',
        canonicalServerUrl: 'https://canonical.home-b.test',
        revision: 7,
        endpoints: [{
            kind: 'iroh',
            endpointId: HOME_ENDPOINT_ID,
            relayUrls: ['https://relay.home-b.test'],
        }],
    },
    irohEndpoint: {
        endpointId: HOME_ENDPOINT_ID,
        relayUrls: ['https://relay.home-b.test'],
    },
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: 1,
};

const HOME_DESCRIPTOR = {
    v: 1,
    homeServerIdentityId: 'srv_home_b',
    canonicalServerUrl: 'https://canonical.home-b.test',
    revision: 7,
    endpoints: [{
        kind: 'iroh',
        endpointId: HOME_ENDPOINT_ID,
        relayUrls: ['https://relay.home-b.test'],
    }],
} satisfies HomeEnrollmentTransport['descriptor'];

function createTransport(
    overrides: Partial<HomeEnrollmentTransport> = {},
): HomeEnrollmentTransport {
    return {
        descriptor: HOME_DESCRIPTOR,
        canonicalServerUrl: HOME_DESCRIPTOR.canonicalServerUrl,
        homeServerIdentityId: HOME_DESCRIPTOR.homeServerIdentityId,
        endpointUrl: 'https://home-b.test',
        runtimeOrigin: 'http://127.0.0.1:55432',
        carrier: 'iroh',
        createRequest: () => async () => new Response(null, { status: 500 }),
        close: closeTransportMock,
        ...overrides,
    };
}

const APPROVAL = {
    approvalId: 'approval-1',
    accountId: 'account-home-b',
    flow: 'account_assertion',
    requesterBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    issuerServerIdentityId: 'srv_directory',
    issuerSubjectId: 'account-directory-subject',
    deviceLabel: 'New phone',
    status: 'pending',
    expiresAtMs: Date.now() + 60_000,
    decidedAtMs: null,
} as const;

function publishPendingEnrollment(
    next: typeof pendingEnrollmentSnapshot.current,
): void {
    pendingEnrollmentSnapshot.current = next;
    for (const listener of [...pendingEnrollmentListeners]) listener();
}

beforeEach(async () => {
    (await appStateEmitter).emit('active');
});

afterEach(() => {
    vi.useRealTimers();
    listMock.mockReset();
    decideMock.mockReset();
    resolveTransportMock.mockReset();
    closeTransportMock.mockReset();
    getCredentialsForServerUrlMock.mockClear();
    getCredentialsForServerUrlMock.mockResolvedValue({ token: 'home-b-full-credential' });
    pendingEnrollmentSnapshot.current = null;
    pendingEnrollmentListeners.clear();
    resumePendingEnrollmentMock.mockReset();
    resumePendingEnrollmentMock.mockResolvedValue(null);
    cancelPendingEnrollmentMock.mockReset();
    cancelPendingEnrollmentMock.mockResolvedValue(undefined);
});

describe('HomeDeviceApprovalSection', () => {
    it('discovers a new Home approval on the active-screen pairing cadence', async () => {
        vi.useFakeTimers();
        listMock
            .mockResolvedValueOnce({ ok: true, items: [] })
            .mockResolvedValueOnce({ ok: true, items: [APPROVAL] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('settings.server.homeApprovals.empty')).toBeNull();
        expect(screen.findAllByType('ItemGroup').filter((group) => group.props.title === 'approvals.title'))
            .toHaveLength(0);
        expect(listMock).toHaveBeenCalledTimes(1);

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
            await flushHookEffects({ cycles: 2, turns: 2 });
        });

        expect(listMock).toHaveBeenCalledTimes(2);
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('approvals.title: Home B');
    });

    it('allows only one approval refresh in flight', async () => {
        vi.useFakeTimers();
        const firstList = createDeferred<Awaited<ReturnType<ListHomeDeviceApprovals>>>();
        listMock
            .mockReturnValueOnce(firstList.promise)
            .mockResolvedValue({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(listMock).toHaveBeenCalledTimes(1);

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(1_900);
        });
        expect(listMock).toHaveBeenCalledTimes(1);

        await React.act(async () => {
            firstList.resolve({ ok: true, items: [] });
            await flushHookEffects({ cycles: 2, turns: 2 });
            await vi.advanceTimersByTimeAsync(2_000);
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('recovers from an interactive load failure when a later poll returns the same empty snapshot', async () => {
        vi.useFakeTimers();
        listMock
            .mockResolvedValueOnce({ ok: false, reason: 'request_failed', status: 503 })
            .mockResolvedValueOnce({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('settings.server.homeApprovals.error')).toBeTruthy();

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
            await flushHookEffects({ cycles: 2, turns: 2 });
        });

        expect(listMock).toHaveBeenCalledTimes(2);
        expect(screen.findByTestId('settings.server.homeApprovals.error')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.empty')).toBeNull();
        expect(screen.findAllByType('ItemGroup').filter((group) => group.props.title === 'approvals.title'))
            .toHaveLength(0);
    });

    it('backs off repeated transient approval refresh failures through the enrollment cadence owner', async () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        listMock
            .mockResolvedValueOnce({ ok: true, items: [] })
            .mockResolvedValueOnce({ ok: false, reason: 'request_failed', status: 503 })
            .mockResolvedValueOnce({ ok: false, reason: 'request_failed', status: 503 })
            .mockResolvedValueOnce({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(listMock).toHaveBeenCalledTimes(1);

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(2_000);
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(listMock).toHaveBeenCalledTimes(3);

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(1_999);
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(listMock).toHaveBeenCalledTimes(3);

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(1);
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(listMock).toHaveBeenCalledTimes(4);
        random.mockRestore();
    });

    it('pauses approval refresh in the background and stops it on unmount', async () => {
        vi.useFakeTimers();
        listMock.mockResolvedValue({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(listMock).toHaveBeenCalledTimes(1);

        await React.act(async () => {
            (await appStateEmitter).emit('background');
            await vi.advanceTimersByTimeAsync(3_000);
        });
        expect(listMock).toHaveBeenCalledTimes(1);

        await React.act(async () => {
            (await appStateEmitter).emit('active');
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(listMock).toHaveBeenCalledTimes(2);

        React.act(() => screen.tree.unmount());
        await vi.advanceTimersByTimeAsync(3_000);
        expect(listMock).toHaveBeenCalledTimes(2);
    });

    it('keeps a mounted pending enrollment idle until explicit Retry and stops after terminal success', async () => {
        vi.useFakeTimers();
        pendingEnrollmentSnapshot.current = {
            kind: 'approval_required',
            serviceKey: 'https://accounts.test\u0000srv_directory',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-pending',
            expiresAtMs: Date.now() + 60_000,
            resume: async () => { throw new Error('not called directly'); },
            cancel: async () => { throw new Error('not called directly'); },
        };
        listMock.mockResolvedValue({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });
        resumePendingEnrollmentMock.mockImplementation(async () => {
            publishPendingEnrollment(null);
            return { kind: 'enrolled', homeServerIdentityId: 'srv_home_b' };
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(screen.findByTestId('settings.server.homeEnrollment.pending')).toBeTruthy();

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
            await flushHookEffects({ cycles: 3, turns: 2 });
        });

        expect(resumePendingEnrollmentMock).not.toHaveBeenCalled();
        await React.act(async () => {
            screen.pressByTestId('settings.server.homeEnrollment.pending.retry');
            await flushHookEffects({ cycles: 3, turns: 2 });
        });
        expect(resumePendingEnrollmentMock).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('settings.server.homeEnrollment.pending')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('Home B. connect.homeAddedPreservedFocusBody');

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
        });
        expect(resumePendingEnrollmentMock).toHaveBeenCalledTimes(1);
    });

    it('checks expiry only when the user explicitly retries a mounted pending enrollment', async () => {
        vi.useFakeTimers();
        pendingEnrollmentSnapshot.current = {
            kind: 'approval_required',
            serviceKey: 'https://accounts.test\u0000srv_directory',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-pending',
            expiresAtMs: Date.now() + 1_000,
            resume: async () => { throw new Error('not called directly'); },
            cancel: async () => { throw new Error('not called directly'); },
        };
        listMock.mockResolvedValue({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });
        resumePendingEnrollmentMock.mockImplementation(async () => {
            publishPendingEnrollment(null);
            return { kind: 'expired' };
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
            await flushHookEffects({ cycles: 3, turns: 2 });
        });

        expect(resumePendingEnrollmentMock).not.toHaveBeenCalled();
        await React.act(async () => {
            screen.pressByTestId('settings.server.homeEnrollment.pending.retry');
            await flushHookEffects({ cycles: 3, turns: 2 });
        });
        expect(resumePendingEnrollmentMock).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('settings.server.homeEnrollment.pending')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('Home B. approvals.status.expired. connect.startAgain');

        await React.act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
        });
        expect(resumePendingEnrollmentMock).toHaveBeenCalledTimes(1);
    });

    it('presents a pending enrollment with its Home target, expiry, and separate retry and cancel actions', async () => {
        const expiresAtMs = Date.parse('2030-01-02T03:04:05.000Z');
        pendingEnrollmentSnapshot.current = {
            kind: 'approval_required',
            serviceKey: 'https://accounts.test\u0000srv_directory',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-pending',
            expiresAtMs,
            resume: async () => { throw new Error('not called directly'); },
            cancel: async () => { throw new Error('not called directly'); },
        };
        listMock.mockResolvedValue({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({
            ok: true,
            transport: createTransport(),
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        const pending = screen.findByTestId('settings.server.homeEnrollment.pending');
        expect(pending?.props.title).toBe('Home B');
        expect(pending?.props.subtitle).toContain('canonical.home-b.test');
        expect(pending?.props.subtitle).not.toContain('https://');
        expect(pending?.props.subtitle).toContain('connect.waitingForApproval');
        expect(pending?.props.subtitle).toContain(`connect.expiresAtLabel: ${new Date(expiresAtMs).toLocaleString()}`);
        expect(pending?.props.accessibilityLabel).toContain('Home B');
        expect(pending?.props.accessibilityLabel).toContain('connect.waitingForApproval');

        const retry = screen.findByTestId('settings.server.homeEnrollment.pending.retry');
        expect(retry?.props.title).toBe('common.retry');
        expect(screen.findByTestId('settings.server.homeEnrollment.pending.cancel')?.props.title).toBe('approvals.stopWaiting');
        await React.act(async () => {
            screen.pressByTestId('settings.server.homeEnrollment.pending.retry');
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        await React.act(async () => {
            screen.pressByTestId('settings.server.homeEnrollment.pending.cancel');
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(resumePendingEnrollmentMock).toHaveBeenCalledTimes(1);
        expect(cancelPendingEnrollmentMock).toHaveBeenCalledTimes(1);
    });

    it('presents a retained transport failure as retryable without inventing an approval expiry', async () => {
        pendingEnrollmentSnapshot.current = {
            kind: 'transport_unavailable',
            reason: 'request_failed',
            serviceKey: 'https://accounts.test\u0000srv_directory',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_b',
            resume: async () => ({ kind: 'transport_unavailable', reason: 'request_failed' }),
            cancel: async () => ({ kind: 'cancelled' }),
        };
        listMock.mockResolvedValue({ ok: true, items: [] });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        const pending = screen.findByTestId('settings.server.homeEnrollment.pending');
        expect(pending?.props.subtitle).toContain('connect.homeEnrollmentRetryBody');
        expect(pending?.props.subtitle).not.toContain('connect.expiresAtLabel');
        expect(screen.findByTestId('settings.server.homeEnrollment.pending.retry')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeEnrollment.pending.cancel')).toBeTruthy();
    });

    it('falls back to the pending Home identity when no provided profile matches', async () => {
        pendingEnrollmentSnapshot.current = {
            kind: 'approval_required',
            serviceKey: 'https://accounts.test\u0000srv_directory',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_unknown',
            approvalId: 'approval-pending',
            expiresAtMs: Date.now() + 60_000,
            resume: async () => { throw new Error('not called directly'); },
            cancel: async () => { throw new Error('not called directly'); },
        };

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('settings.server.homeEnrollment.pending')?.props.title).toBe('srv_unknown');
    });

    it('shows the exact requester fingerprint before any disclosure or decision when the device label is absent', async () => {
        listMock.mockResolvedValue({ ok: true, items: [{ ...APPROVAL, deviceLabel: null }] });
        resolveTransportMock.mockResolvedValue({
            ok: true,
            transport: createTransport(),
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        const approval = screen.findByTestId('settings.server.homeApprovals.approval-1');
        expect(approval?.props.subtitle).toContain('navigation.linkNewDevice');
        expect(approval?.props.subtitle)
            .toContain('connect.requestKeyFingerprintLabel: U9NW-XLlJ-x5Hw-8zJH');
        expect(approval?.props.accessibilityLabel)
            .toContain('connect.requestKeyFingerprintLabel: U9NW-XLlJ-x5Hw-8zJH');
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.security')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.approve')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.reject')).toBeTruthy();
    });

    it('shows a target Home approval and disables both decisions while approving', async () => {
        listMock.mockResolvedValue({ ok: true, items: [APPROVAL] });
        const decision = createDeferred<{ ok: true; status: 'approved' }>();
        decideMock.mockReturnValue(decision.promise);
        resolveTransportMock.mockResolvedValue({
            ok: true,
            transport: createTransport(),
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(getCredentialsForServerUrlMock).toHaveBeenCalledWith(
            'https://canonical.home-b.test',
            { serverId: 'srv_home_b' },
        );
        expect(resolveTransportMock).toHaveBeenCalledWith({
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://canonical.home-b.test',
            revision: 7,
            endpoints: [{
                kind: 'iroh',
                endpointId: HOME_ENDPOINT_ID,
                relayUrls: ['https://relay.home-b.test'],
            }],
        }, {
            verification: { kind: 'authenticated', token: 'home-b-full-credential' },
        });
        expect(listMock).toHaveBeenCalledWith({
            transport: expect.objectContaining({
                descriptor: HOME_DESCRIPTOR,
                runtimeOrigin: 'http://127.0.0.1:55432',
                carrier: 'iroh',
            }),
            credentials: { token: 'home-b-full-credential' },
        });
        expect(closeTransportMock).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.title).toBe('Home B');
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.subtitle)
            .toContain('connect.deviceLabel: New phone');
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.subtitle)
            .toContain('connect.requestKeyFingerprintLabel: U9NW-XLlJ-x5Hw-8zJH');
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.accessibilityLabel)
            .toContain('connect.requestKeyFingerprintLabel: U9NW-XLlJ-x5Hw-8zJH');
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.subtitle)
            .toContain('connect.expiresAtLabel:');
        const liveRegions = screen.findAllByProps({ accessibilityLiveRegion: 'polite' });
        expect(liveRegions).toHaveLength(1);
        expect(liveRegions[0]?.props.accessibilityLabel).toBe('approvals.title: Home B');
        const approve = screen.findByTestId('settings.server.homeApprovals.approval-1.approve');
        expect(approve?.props.accessibilityLabel).toBe('approvals.approve: Home B');
        await React.act(async () => {
            approve?.props.onPress();
            await flushHookEffects({ cycles: 1, turns: 1 });
        });
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.approve')?.props.disabled).toBe(true);
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.reject')?.props.disabled).toBe(true);

        await React.act(async () => {
            decision.resolve({ ok: true, status: 'approved' });
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(decideMock).toHaveBeenCalledWith(
            {
                transport: expect.objectContaining({
                    descriptor: HOME_DESCRIPTOR,
                    runtimeOrigin: 'http://127.0.0.1:55432',
                    carrier: 'iroh',
                }),
                credentials: { token: 'home-b-full-credential' },
            },
            'approval-1',
            'approve',
        );
        expect(closeTransportMock).toHaveBeenCalledTimes(2);
        expect(screen.findByTestId('settings.server.homeApprovals.empty')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('approvals.status.approved: Home B');
    });

    it('keeps a successful approval list successful when transport cleanup fails', async () => {
        listMock.mockResolvedValue({ ok: true, items: [APPROVAL] });
        closeTransportMock.mockRejectedValueOnce(new Error('transport cleanup failed'));
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('settings.server.homeApprovals.loading')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('approvals.title: Home B');
    });

    it('keeps a list operation failure primary and clears loading when transport cleanup also fails', async () => {
        listMock.mockRejectedValueOnce(new Error('approval list failed'));
        closeTransportMock.mockRejectedValueOnce(new Error('transport cleanup failed'));
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('settings.server.homeApprovals.loading')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.error')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('approvals.loadError');
    });

    it.each([
        ['approve', 'approved'],
        ['reject', 'rejected'],
    ] as const)(
        'keeps a successful %s successful and clears busy state when transport cleanup fails',
        async (decision, expectedStatus) => {
            listMock.mockResolvedValue({ ok: true, items: [APPROVAL] });
            decideMock.mockResolvedValue({ ok: true, status: expectedStatus });
            closeTransportMock
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('transport cleanup failed'));
            resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

            const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
            const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
            await flushHookEffects({ cycles: 2, turns: 2 });

            await React.act(async () => {
                screen.findByTestId(`settings.server.homeApprovals.approval-1.${decision}`)?.props.onPress();
                await flushHookEffects({ cycles: 2, turns: 2 });
            });

            expect(screen.findByTestId('settings.server.homeApprovals.approval-1')).toBeNull();
            expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
                .toBe(`approvals.status.${expectedStatus}: Home B`);
        },
    );

    it('keeps the operation failure primary, clears busy state, and ignores a cleanup failure', async () => {
        listMock.mockResolvedValue({ ok: true, items: [APPROVAL] });
        decideMock.mockRejectedValue(new Error('approval operation failed'));
        closeTransportMock
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('transport cleanup failed'));
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        await React.act(async () => {
            screen.findByTestId('settings.server.homeApprovals.approval-1.approve')?.props.onPress();
            await flushHookEffects({ cycles: 2, turns: 2 });
        });

        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.error')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.approve')?.props.disabled).toBe(false);
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.reject')?.props.disabled).toBe(false);
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('approvals.decisionError: Home B');
    });

    it('keeps a failed decision error local to its approval card', async () => {
        listMock.mockResolvedValue({
            ok: true,
            items: [APPROVAL, { ...APPROVAL, approvalId: 'approval-2', deviceLabel: 'Tablet' }],
        });
        decideMock.mockResolvedValue({ ok: false, reason: 'request_failed', status: 503 });
        resolveTransportMock.mockResolvedValue({
            ok: true,
            transport: createTransport(),
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findAllByType('ItemGroup').filter((group) => group.props.title === 'approvals.title'))
            .toHaveLength(1);
        await React.act(async () => {
            screen.findByTestId('settings.server.homeApprovals.approval-1.approve')?.props.onPress();
            await flushHookEffects({ cycles: 2, turns: 2 });
        });

        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.error')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.approval-2.error')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.approval-2.approve')?.props.disabled).toBe(false);
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('approvals.decisionError: Home B');
    });

    it('refreshes terminal already-decided state instead of offering a stale retry', async () => {
        listMock
            .mockResolvedValueOnce({ ok: true, items: [APPROVAL] })
            .mockResolvedValueOnce({ ok: true, items: [] });
        decideMock.mockResolvedValue({
            ok: false,
            reason: 'already_decided',
            status: 409,
        });
        resolveTransportMock.mockResolvedValue({
            ok: true,
            transport: createTransport(),
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        await React.act(async () => {
            screen.findByTestId('settings.server.homeApprovals.approval-1.reject')?.props.onPress();
            await flushHookEffects({ cycles: 3, turns: 2 });
        });

        expect(listMock).toHaveBeenCalledTimes(2);
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1.error')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.empty')).toBeNull();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('inbox.emptyDescription');
    });

    it.each([
        [{ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' }, 'connect.homeAddedPreservedFocusBody'],
        [{ kind: 'rejected' }, 'connect.pairingRejectedBody'],
        [{ kind: 'expired' }, 'approvals.status.expired. connect.startAgain'],
        [{ kind: 'transport_unavailable', reason: 'no_approved_endpoint' }, 'errors.operationFailed. common.retry'],
        [{ kind: 'failed' }, 'errors.operationFailed. common.retry'],
        [{
            kind: 'partial_commit',
            adoptionError: new Error('profile adoption failed'),
            canonicalServerUrl: 'https://canonical.home-b.test',
            homeServerIdentityId: 'srv_home_b',
            rollbackOutcome: { kind: 'not_applied', reason: 'ownership_changed' },
        }, 'connect.homeEnrollmentPartialCommitBody'],
    ] as const)(
        'announces the explicit %s pending-enrollment result without creating another continuation owner',
        async (result, expectedAnnouncement) => {
            pendingEnrollmentSnapshot.current = {
                kind: 'approval_required',
                serviceKey: 'https://accounts.test\u0000srv_directory',
                entryIntent: 'connect_service',
                homeServerIdentityId: 'srv_home_b',
                approvalId: 'approval-pending',
                expiresAtMs: Date.now() + 60_000,
                resume: async () => { throw new Error('not called directly'); },
                cancel: async () => { throw new Error('not called directly'); },
            };
            listMock.mockResolvedValue({ ok: true, items: [] });
            resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });
            resumePendingEnrollmentMock.mockResolvedValue(result as HomeLoginContinuationResult);

            const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
            const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
            await flushHookEffects({ cycles: 2, turns: 2 });

            await React.act(async () => {
                screen.findByTestId('settings.server.homeEnrollment.pending.retry')?.props.onPress();
                await flushHookEffects({ cycles: 2, turns: 2 });
            });

            expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
                .toBe(`Home B. ${expectedAnnouncement}`);
            expect(screen.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(1);
        },
    );

    it('announces explicit cancellation after the pending continuation is released', async () => {
        pendingEnrollmentSnapshot.current = {
            kind: 'approval_required',
            serviceKey: 'https://accounts.test\u0000srv_directory',
            entryIntent: 'connect_service',
            homeServerIdentityId: 'srv_home_b',
            approvalId: 'approval-pending',
            expiresAtMs: Date.now() + 60_000,
            resume: async () => { throw new Error('not called directly'); },
            cancel: async () => { throw new Error('not called directly'); },
        };
        listMock.mockResolvedValue({ ok: true, items: [] });
        resolveTransportMock.mockResolvedValue({ ok: true, transport: createTransport() });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        await React.act(async () => {
            screen.findByTestId('settings.server.homeEnrollment.pending.cancel')?.props.onPress();
            await flushHookEffects({ cycles: 2, turns: 2 });
        });

        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('Home B. approvals.stopWaiting');
        expect(screen.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(1);
    });
});
