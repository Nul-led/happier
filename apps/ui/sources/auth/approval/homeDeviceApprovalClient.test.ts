import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeEnrollmentTransport } from '@/auth/enrollment/homeEnrollmentTransport';

const endpointFetchMock = vi.hoisted(() => vi.fn());
const createRequestMock = vi.hoisted(() => vi.fn((_input: unknown) => endpointFetchMock));

const TARGET = {
    transport: {
        descriptor: {
            v: 1,
            homeServerIdentityId: 'srv_home_b',
            canonicalServerUrl: 'https://canonical.home-b.test',
            revision: 7,
            endpoints: [{
                kind: 'iroh',
                endpointId: 'iroh-home-b',
                relayUrls: ['https://relay.home-b.test'],
            }],
        },
        canonicalServerUrl: 'https://canonical.home-b.test',
        homeServerIdentityId: 'srv_home_b',
        endpointUrl: 'https://canonical.home-b.test',
        runtimeOrigin: 'http://127.0.0.1:55432',
        carrier: 'iroh',
        createRequest: createRequestMock,
        close: async () => {},
    } satisfies HomeEnrollmentTransport,
    credentials: { token: 'home-b-full-credential' },
} as const;

function json(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function pendingApproval(index: number) {
    return {
        approvalId: `approval-${index}`,
        accountId: 'account-home-b',
        flow: 'account_assertion' as const,
        requesterBoxPublicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        issuerServerIdentityId: 'srv_dir_1',
        issuerSubjectId: 'account-1',
        deviceLabel: index === 6 ? 'Phone' : null,
        status: 'pending' as const,
        expiresAtMs: Date.now() + 60_000,
        decidedAtMs: null,
    };
}

import {
    decideHomeDeviceApproval,
    listHomeDeviceApprovals,
} from './homeDeviceApprovalClient';

afterEach(() => {
    endpointFetchMock.mockReset();
    createRequestMock.mockClear();
});

describe('homeDeviceApprovalClient', () => {
    it('uses the caller-loaded canonical Home credential while runtimeOrigin only selects transport', async () => {
        endpointFetchMock.mockResolvedValue(json(200, []));

        await expect(listHomeDeviceApprovals(TARGET)).resolves.toEqual({ ok: true, items: [] });

        expect(createRequestMock).toHaveBeenCalledWith({
            credentials: { token: 'home-b-full-credential' },
        });
    });

    it('lists and decides pending approvals using the explicit Home credential', async () => {
        const approval = pendingApproval(6);
        endpointFetchMock
            .mockResolvedValueOnce(json(200, [approval]))
            .mockResolvedValueOnce(json(200, { status: 'approved' }));

        await expect(listHomeDeviceApprovals(TARGET)).resolves.toEqual({ ok: true, items: [approval] });
        await expect(decideHomeDeviceApproval(TARGET, approval.approvalId, 'approve'))
            .resolves.toEqual({ ok: true, status: 'approved' });

        expect(endpointFetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/home-login/approvals');
        expect(endpointFetchMock.mock.calls[1]?.[0]).toBe('/v1/auth/home-login/approvals/approval-6/decision');
        expect(JSON.parse(String((endpointFetchMock.mock.calls[1]?.[1] as RequestInit).body)))
            .toEqual({ decision: 'approve' });
    });

    it('accepts every item in a protocol-valid approval list without a client-only cap', async () => {
        const approvals = Array.from({ length: 101 }, (_, index) => pendingApproval(index));
        endpointFetchMock.mockResolvedValueOnce(json(200, approvals));

        await expect(listHomeDeviceApprovals(TARGET)).resolves.toEqual({ ok: true, items: approvals });
    });

    it('maps unauthorized approval list and decision responses to typed failures', async () => {
        endpointFetchMock.mockResolvedValue(json(403, { error: 'present_user_required' }));

        await expect(listHomeDeviceApprovals(TARGET))
            .resolves.toEqual({ ok: false, reason: 'unauthorized', status: 403 });
        await expect(decideHomeDeviceApproval(TARGET, 'approval-7', 'reject'))
            .resolves.toEqual({ ok: false, reason: 'unauthorized', status: 403 });
    });
});
