import { z } from 'zod';
import {
    HomeDeviceApprovalListV1Schema,
    type HomeDeviceApprovalRequestV1,
} from '@happier-dev/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { createServerFetchAtEndpoint } from '@/sync/http/client';

export type HomeDeviceApprovalTarget = Readonly<{
    canonicalServerUrl: string;
    runtimeOrigin?: string | null;
    serverId: string;
    credentials: AuthCredentials;
}>;

export type HomeDeviceApprovalDecision = 'approve' | 'reject';

const HomeDeviceApprovalDecisionSchema = z.object({
    status: z.enum(['approved', 'rejected', 'already_decided']),
}).strict();

export type HomeDeviceApprovalListItem = HomeDeviceApprovalRequestV1;
export type HomeDeviceApprovalListResult =
    | Readonly<{ ok: true; items: readonly HomeDeviceApprovalListItem[] }>
    | Readonly<{ ok: false; reason: 'unauthorized' | 'malformed' | 'request_failed'; status: number }>;
export type HomeDeviceApprovalDecisionResult =
    | Readonly<{ ok: true; status: 'approved' | 'rejected' }>
    | Readonly<{ ok: false; reason: 'not_found' | 'unauthorized' | 'already_decided' | 'malformed' | 'request_failed'; status: number }>;

function normalizeTarget(target: HomeDeviceApprovalTarget): HomeDeviceApprovalTarget | null {
    const canonicalServerUrl = target.canonicalServerUrl.trim().replace(/\/+$/, '');
    const serverId = target.serverId.trim();
    if (!canonicalServerUrl || !serverId || !target.credentials.token || !/^https?:\/\//i.test(canonicalServerUrl)) return null;
    return { ...target, canonicalServerUrl, serverId };
}

async function createAuthenticatedHomeRequest(target: HomeDeviceApprovalTarget) {
    const normalized = normalizeTarget(target);
    if (!normalized) return null;
    return createServerFetchAtEndpoint({
        endpointUrl: normalized.canonicalServerUrl,
        ...(normalized.runtimeOrigin ? { runtimeOrigin: normalized.runtimeOrigin } : {}),
        serverId: normalized.serverId,
        credentials: normalized.credentials,
    });
}

export async function listHomeDeviceApprovals(
    target: HomeDeviceApprovalTarget,
): Promise<HomeDeviceApprovalListResult> {
    const request = await createAuthenticatedHomeRequest(target);
    if (!request) return { ok: false, reason: 'unauthorized', status: 401 };
    try {
        const response = await request('/v1/auth/home-login/approvals', undefined, {
            includeAuth: true,
            retry: 'none',
        });
        if (response.status === 401 || response.status === 403) {
            return { ok: false, reason: 'unauthorized', status: response.status };
        }
        if (!response.ok) return { ok: false, reason: 'request_failed', status: response.status };
        const parsed = HomeDeviceApprovalListV1Schema.safeParse(await response.json().catch(() => null));
        return parsed.success
            ? { ok: true, items: parsed.data }
            : { ok: false, reason: 'malformed', status: 502 };
    } catch {
        return { ok: false, reason: 'request_failed', status: 0 };
    }
}

export async function decideHomeDeviceApproval(
    target: HomeDeviceApprovalTarget,
    approvalId: string,
    decision: HomeDeviceApprovalDecision,
): Promise<HomeDeviceApprovalDecisionResult> {
    const normalizedApprovalId = approvalId.trim();
    if (!normalizedApprovalId || normalizedApprovalId.length > 256) {
        return { ok: false, reason: 'not_found', status: 404 };
    }
    const request = await createAuthenticatedHomeRequest(target);
    if (!request) return { ok: false, reason: 'unauthorized', status: 401 };
    try {
        const response = await request(
            `/v1/auth/home-login/approvals/${encodeURIComponent(normalizedApprovalId)}/decision`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision }),
            },
            { includeAuth: true, retry: 'none' },
        );
        if (response.status === 401 || response.status === 403) {
            return { ok: false, reason: 'unauthorized', status: response.status };
        }
        if (response.status === 404) return { ok: false, reason: 'not_found', status: 404 };
        if (!response.ok) return { ok: false, reason: 'request_failed', status: response.status };
        const parsed = HomeDeviceApprovalDecisionSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success) return { ok: false, reason: 'malformed', status: 502 };
        if (parsed.data.status === 'already_decided') {
            return { ok: false, reason: 'already_decided', status: 409 };
        }
        return { ok: true, status: parsed.data.status };
    } catch {
        return { ok: false, reason: 'request_failed', status: 0 };
    }
}
