import {
    DIRECT_ROUTE_GRANT_TTL_MS,
    MachineLiveStreamRelayAuthorizationV1Schema,
    PEER_MACHINE_LIVE_STREAM_DIRECT_START_PATH_V2,
    PEER_MEDIATION_RECEIPTS,
    PeerLoopbackEndpointCandidateV1Schema,
    SignedDirectRouteGrantV2Schema,
    DirectRouteGrantRequestV2Schema,
    PeerMachineLiveStreamDirectStartResponseV2Schema,
    type MachineLiveStreamCapsV1,
    type MachineLiveStreamRelayAuthorizationV1,
    type MachineLiveStreamStartRequestV1,
    type PeerLoopbackEndpointCandidateV1,
    type PeerMachineLiveStreamDirectStartResponseV2,
    type PeerRouteEphemeralProofV2,
    type SignedDirectRouteGrantV2,
} from '@happier-dev/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import {
    areServerProfileIdentifiersEquivalent,
    getServerProfileById,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { storage } from '@/sync/domains/state/storage';
import type { ServerAccountRequestAuthority } from '@/sync/runtime/orchestration/serverScopedRpc/createServerRequestWithServerScope';
import {
    requestPeerMediationServerJson,
    requestPeerMediationServerJsonForCredential,
} from '../peerMediationServerRequest';
import { readPeerEndpointForServerScope } from '../readPeerEndpointForServerScope';
import type { MachineLiveStreamUnsignedStartRequest } from './startRequest';
export { createBaseStartRequest, createLiveStreamStartRequest, type MachineLiveStreamUnsignedStartRequest } from './startRequest';

export const MACHINE_LIVE_STREAM_DIRECT_FETCH_TIMEOUT_MS = 5_000;


export type MachineLiveStreamDirectStartResponse = PeerMachineLiveStreamDirectStartResponseV2;


export type TargetServer = Readonly<{
    serverId: string;
    serverUrl: string;
}>;

export type OperationResult<T> =
    | Readonly<{ ok: true; value: T }>
    | Readonly<{ ok: false; reasonCode: string }>;

/** Canonical authenticated UI HTTP seam for a V2 peer-route grant. */
export async function requestPeerRouteGrantV2(input: Readonly<{
    authority: Pick<ServerAccountRequestAuthority, 'request'>;
    request: ReturnType<typeof DirectRouteGrantRequestV2Schema.parse>;
    timeoutMs?: number;
}>): Promise<OperationResult<SignedDirectRouteGrantV2>> {
    try {
        const response = await requestPeerMediationServerJson({
            authorityRequest: input.authority.request,
            path: '/v1/machines/peer/mediation/route-grants',
            timeoutMs: input.timeoutMs,
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input.request),
            },
        });
        if (!response.ok) return { ok: false, reasonCode: 'grant_missing' };
        const body = response.body as { ok?: unknown; reasonCode?: unknown; grant?: unknown } | null;
        if (body?.ok !== true) return { ok: false, reasonCode: typeof body?.reasonCode === 'string' ? body.reasonCode : 'grant_missing' };
        const parsed = SignedDirectRouteGrantV2Schema.safeParse(body.grant);
        return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reasonCode: 'grant_invalid' };
    } catch {
        return { ok: false, reasonCode: 'grant_missing' };
    }
}

function normalizeId(raw: unknown): string {
    return String(raw ?? '').trim();
}

function normalizeBaseUrl(serverUrl: string): string {
    return String(serverUrl ?? '').trim().replace(/\/+$/, '');
}

export function resolveTargetServer(serverId: string | null | undefined): TargetServer | null {
    const active = getActiveServerSnapshot();
    const activeServerId = normalizeId(active.serverId);
    const requestedServerId = normalizeId(serverId) || activeServerId;
    if (!requestedServerId) return null;
    if (areServerProfileIdentifiersEquivalent(requestedServerId, activeServerId)) {
        const serverUrl = normalizeBaseUrl(active.serverUrl);
        return serverUrl ? { serverId: activeServerId, serverUrl } : null;
    }
    const profile = getServerProfileById(requestedServerId);
    const serverUrl = normalizeBaseUrl(profile?.serverUrl ?? '');
    return profile && serverUrl ? { serverId: resolveServerProfileScopeId(profile), serverUrl } : null;
}

export function readEndpointFromMachineState(input: Readonly<{
    serverId: string;
    machineId: string;
}>): PeerLoopbackEndpointCandidateV1 | null {
    const state = storage.getState();
    const endpoint = readPeerEndpointForServerScope({
        state,
        serverId: input.serverId,
        machineId: input.machineId,
        select: (machine) => machine.daemonState?.peerMediation?.loopback?.endpoint,
    });
    const parsed = PeerLoopbackEndpointCandidateV1Schema.safeParse(endpoint);
    return parsed.success ? parsed.data : null;
}

async function fetchJson(params: Readonly<{
    url: string;
    init: RequestInit;
    timeoutMs?: number;
}>): Promise<Readonly<{ ok: boolean; status: number; body: unknown }>> {
    const timeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0
        ? params.timeoutMs
        : MACHINE_LIVE_STREAM_DIRECT_FETCH_TIMEOUT_MS;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const response = await fetch(params.url, {
            ...params.init,
            ...(controller ? { signal: controller.signal } : {}),
        });
        return {
            ok: response.ok,
            status: response.status,
            body: await response.json().catch(() => null),
        };
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}


export async function requestLiveStreamRouteGrantV2(input: Readonly<{
    server: TargetServer;
    credentials: AuthCredentials;
    sourceMachineId: string;
    endpointFingerprint: string;
    streamId: string;
    streamFamily: string;
    sourceId?: string;
    caps: MachineLiveStreamCapsV1;
    ephemeralPublicKeyBase64Url: string;
    timeoutMs?: number;
}>): Promise<OperationResult<SignedDirectRouteGrantV2>> {
    try {
        const response = await requestPeerMediationServerJsonForCredential({
            serverId: input.server.serverId,
            token: input.credentials.token,
            path: '/v1/machines/peer/mediation/route-grants',
            timeoutMs: input.timeoutMs,
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    v: 2,
                    kind: 'ephemeral_ed25519',
                    ephemeralPublicKeyBase64Url: input.ephemeralPublicKeyBase64Url,
                    machineId: input.sourceMachineId,
                    flowKind: 'live_stream',
                    routeKind: 'loopback_direct',
                    endpointFingerprint: input.endpointFingerprint,
                    ttlMs: DIRECT_ROUTE_GRANT_TTL_MS.directLiveStream,
                    scope: {
                        kind: 'live_stream',
                        streamId: input.streamId,
                        streamFamily: input.streamFamily,
                        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
                        maxBitrateBps: input.caps.maxBitrateBps,
                        maxDurationMs: input.caps.maxDurationMs,
                        ...(input.caps.maxTotalBytes ? { maxTotalBytes: input.caps.maxTotalBytes } : {}),
                    },
                }),
            },
        });
        if (!response.ok) return { ok: false, reasonCode: 'grant_missing' };
        const body = response.body as { ok?: unknown; reasonCode?: unknown; grant?: unknown } | null;
        if (body?.ok !== true) return { ok: false, reasonCode: typeof body?.reasonCode === 'string' ? body.reasonCode : 'grant_missing' };
        const parsed = SignedDirectRouteGrantV2Schema.safeParse(body.grant);
        return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reasonCode: 'grant_invalid' };
    } catch {
        return { ok: false, reasonCode: 'grant_missing' };
    }
}



function resolveDirectStreamStartUrlV2(endpointUrl: string): string {
    const parsed = new URL(endpointUrl);
    parsed.pathname = PEER_MACHINE_LIVE_STREAM_DIRECT_START_PATH_V2;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
}


export async function postLiveStreamDirectStartV2(input: Readonly<{
    endpoint: PeerLoopbackEndpointCandidateV1;
    grant: SignedDirectRouteGrantV2;
    proof: PeerRouteEphemeralProofV2;
    startRequest: MachineLiveStreamStartRequestV1;
    timeoutMs?: number;
}>): Promise<OperationResult<MachineLiveStreamDirectStartResponse>> {
    try {
        const response = await fetchJson({
            url: resolveDirectStreamStartUrlV2(input.endpoint.url),
            timeoutMs: input.timeoutMs,
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    v: 2,
                    streamId: input.startRequest.streamId,
                    streamFamily: input.startRequest.streamFamily,
                    routeKind: 'loopback_direct',
                    flowKind: 'live_stream',
                    endpointFingerprint: input.endpoint.endpointFingerprint,
                    grant: input.grant,
                    proof: input.proof,
                    startRequest: input.startRequest,
                }),
            },
        });
        if (!response.ok) return { ok: false, reasonCode: 'topology_unavailable' };
        const parsed = PeerMachineLiveStreamDirectStartResponseV2Schema.safeParse(response.body);
        if (!parsed.success) return { ok: false, reasonCode: 'invalid_request' };
        return parsed.data.ok ? { ok: true, value: parsed.data } : { ok: false, reasonCode: parsed.data.reasonCode };
    } catch {
        return { ok: false, reasonCode: 'topology_unavailable' };
    }
}

export async function requestLiveStreamRelayAuthorization(input: Readonly<{
    server: TargetServer;
    credentials: AuthCredentials;
    startRequest: MachineLiveStreamUnsignedStartRequest;
    timeoutMs?: number;
}>): Promise<OperationResult<MachineLiveStreamRelayAuthorizationV1>> {
    try {
        const response = await requestPeerMediationServerJsonForCredential({
            serverId: input.server.serverId,
            token: input.credentials.token,
            path: '/v1/machines/peer/mediation/route-grants',
            timeoutMs: input.timeoutMs,
            init: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    machineId: input.startRequest.sourceMachineId,
                    targetMachineId: input.startRequest.targetMachineId,
                    flowKind: 'live_stream',
                    routeKind: 'server_relay',
                    ttlMs: DIRECT_ROUTE_GRANT_TTL_MS.serverRelayedLiveStream,
                    // Per-tab viewer target (W1-C-2): the server mint binds this socket id into the
                    // signed grant payload so frames are delivered to the exact tab. Omitted on the
                    // legacy machine→machine path (no viewer socket).
                    ...(input.startRequest.viewerSocketId
                        ? { viewerSocketId: input.startRequest.viewerSocketId }
                        : {}),
                    maxFramesPerSecond: input.startRequest.maxFramesPerSecond,
                    maxFrameBytes: input.startRequest.maxFrameBytes,
                    codecId: input.startRequest.codecId,
                    viewerCodecs: input.startRequest.viewerCodecs,
                    scope: {
                        kind: 'live_stream',
                        streamId: input.startRequest.streamId,
                        streamFamily: input.startRequest.streamFamily,
                        ...(input.startRequest.sourceId ? { sourceId: input.startRequest.sourceId } : {}),
                        maxBitrateBps: input.startRequest.maxBitrateBps,
                        maxDurationMs: input.startRequest.maxDurationMs,
                        ...(input.startRequest.maxTotalBytes
                            ? { maxTotalBytes: input.startRequest.maxTotalBytes }
                            : {}),
                    },
                }),
            },
        });
        if (!response.ok) return { ok: false, reasonCode: 'grant_missing' };
        const body = response.body as { ok?: unknown; reasonCode?: unknown; relayAuthorization?: unknown } | null;
        if (body?.ok !== true) {
            return {
                ok: false,
                reasonCode: typeof body?.reasonCode === 'string' ? body.reasonCode : 'grant_missing',
            };
        }
        const parsed = MachineLiveStreamRelayAuthorizationV1Schema.safeParse(body.relayAuthorization);
        return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reasonCode: 'grant_invalid' };
    } catch {
        return { ok: false, reasonCode: 'grant_missing' };
    }
}
