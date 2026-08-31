import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
import type { HomeLoginContinuationResult } from '@/sync/ops/accountDirectory/homeLoginApproval';

type ListHomeDeviceApprovals = (typeof import('@/auth/approval/homeDeviceApprovalClient'))['listHomeDeviceApprovals'];
type DecideHomeDeviceApproval = (typeof import('@/auth/approval/homeDeviceApprovalClient'))['decideHomeDeviceApproval'];
type ResolveHomeEnrollmentTransport = (typeof import('@/auth/enrollment/homeEnrollmentTransport'))['resolveHomeEnrollmentTransport'];
type GetCredentialsForServerUrl = (typeof import('@/auth/storage/tokenStorage'))['TokenStorage']['getCredentialsForServerUrl'];

installSettingsViewCommonModuleMocks({
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
const pendingEnrollmentSnapshot = vi.hoisted(() => ({ current: null as null | {
    kind: 'approval_required';
    homeServerIdentityId: string;
    approvalId: string;
    expiresAtMs: number;
    resume: () => Promise<never>;
    cancel: () => Promise<never>;
} }));
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
    subscribePendingPreferredHomeEnrollment: () => () => {},
    resumePendingPreferredHomeEnrollment: () => resumePendingEnrollmentMock(),
    cancelPendingPreferredHomeEnrollment: () => cancelPendingEnrollmentMock(),
}));

const HOME: ServerProfile = {
    id: 'home-b-profile',
    name: 'Home B',
    serverUrl: 'https://home-b.test',
    canonicalServerUrl: 'https://canonical.home-b.test',
    serverIdentityId: 'srv_home_b',
    connectionDescriptorRevision: 7,
    irohEndpoint: {
        endpointId: 'iroh-home-b',
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
        endpointId: 'iroh-home-b',
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

afterEach(() => {
    listMock.mockReset();
    decideMock.mockReset();
    resolveTransportMock.mockReset();
    closeTransportMock.mockReset();
    getCredentialsForServerUrlMock.mockClear();
    getCredentialsForServerUrlMock.mockResolvedValue({ token: 'home-b-full-credential' });
    pendingEnrollmentSnapshot.current = null;
    resumePendingEnrollmentMock.mockClear();
    cancelPendingEnrollmentMock.mockClear();
});

describe('HomeDeviceApprovalSection', () => {
    it('presents a pending enrollment with its Home target, expiry, and separate retry and cancel actions', async () => {
        const expiresAtMs = Date.parse('2030-01-02T03:04:05.000Z');
        pendingEnrollmentSnapshot.current = {
            kind: 'approval_required',
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
        const cancel = screen.findByTestId('settings.server.homeEnrollment.pending.cancel');
        expect(retry?.props.title).toBe('common.retry');
        expect(cancel?.props.title).toBe('common.cancel');
        await React.act(async () => {
            retry?.props.onPress();
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        await React.act(async () => {
            cancel?.props.onPress();
            await flushHookEffects({ cycles: 2, turns: 2 });
        });
        expect(resumePendingEnrollmentMock).toHaveBeenCalledTimes(1);
        expect(cancelPendingEnrollmentMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to the pending Home identity when no provided profile matches', async () => {
        pendingEnrollmentSnapshot.current = {
            kind: 'approval_required',
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

    it('shows the stable requester-key fingerprint when no device label is available', async () => {
        listMock.mockResolvedValue({ ok: true, items: [{ ...APPROVAL, deviceLabel: null }] });
        resolveTransportMock.mockResolvedValue({
            ok: true,
            transport: createTransport(),
        });

        const { HomeDeviceApprovalSection } = await import('./HomeDeviceApprovalSection');
        const screen = await renderScreen(<HomeDeviceApprovalSection homes={[HOME]} />);
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.subtitle)
            .toContain('connect.requestKeyFingerprintLabel: U9NW-XLlJ-x5Hw-8zJH');
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
                endpointId: 'iroh-home-b',
                relayUrls: ['https://relay.home-b.test'],
            }],
        }, {
            verification: { kind: 'authenticated', token: 'home-b-full-credential' },
        });
        expect(listMock).toHaveBeenCalledWith({
            canonicalServerUrl: 'https://canonical.home-b.test',
            runtimeOrigin: 'http://127.0.0.1:55432',
            serverId: 'srv_home_b',
            credentials: { token: 'home-b-full-credential' },
        });
        expect(closeTransportMock).toHaveBeenCalledTimes(1);
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.title).toBe('Home B');
        expect(screen.findByTestId('settings.server.homeApprovals.approval-1')?.props.subtitle)
            .toContain('connect.deviceLabel: New phone · connect.requestKeyFingerprintLabel: U9NW-XLlJ-x5Hw-8zJH');
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
                canonicalServerUrl: 'https://canonical.home-b.test',
                runtimeOrigin: 'http://127.0.0.1:55432',
                serverId: 'srv_home_b',
                credentials: { token: 'home-b-full-credential' },
            },
            'approval-1',
            'approve',
        );
        expect(closeTransportMock).toHaveBeenCalledTimes(2);
        expect(screen.findByTestId('settings.server.homeApprovals.empty')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('approvals.status.approved: Home B');
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
        expect(screen.findByTestId('settings.server.homeApprovals.empty')).toBeTruthy();
        expect(screen.findByTestId('settings.server.homeApprovals.status')?.props.accessibilityLabel)
            .toBe('inbox.emptyDescription');
    });

    it.each([
        [{ kind: 'enrolled', homeServerIdentityId: 'srv_home_b' }, 'connect.homeAddedPreservedFocusBody'],
        [{ kind: 'rejected' }, 'connect.pairingRejectedBody'],
        [{ kind: 'expired' }, 'approvals.status.expired. connect.startAgain'],
        [{ kind: 'transport_unavailable', reason: 'no_approved_endpoint' }, 'errors.operationFailed. common.retry'],
        [{ kind: 'failed' }, 'errors.operationFailed. common.retry'],
    ] as const)(
        'announces the explicit %s pending-enrollment result without creating another continuation owner',
        async (result, expectedAnnouncement) => {
            pendingEnrollmentSnapshot.current = {
                kind: 'approval_required',
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
            .toBe('Home B. approvals.status.canceled');
        expect(screen.findAllByProps({ accessibilityLiveRegion: 'polite' })).toHaveLength(1);
    });
});
