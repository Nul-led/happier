import {
    DIRECT_ROUTE_GRANT_TTL_MS,
    DirectRouteGrantRequestV2Schema,
    IrohEndpointDescriptorV1Schema,
    IrohMachineHandshakeV1Schema,
    createEphemeralPeerRouteProofHandleV2,
} from '@happier-dev/protocol';

import { TokenStorage } from '@/auth/storage/tokenStorage';
import { getRandomBytes } from '@/platform/cryptoRandom';
import { getReadyServerFeatures } from '@/sync/api/capabilities/getReadyServerFeatures';
import { requestPeerRouteGrantV2, resolveTargetServer } from '@/sync/domains/machines/peer/mediation/stream/productionRouteHttp';
import { readPeerEndpointForServerScope } from '@/sync/domains/machines/peer/mediation/readPeerEndpointForServerScope';
import { createServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { storage } from '@/sync/domains/state/storage';
import { serverFetch } from '@/sync/http/client';
import { getIrohApplicationEndpoint, probeIrohMachineHttpLifecycleAvailability, startIrohMachineHttpTunnel } from '@/sync/runtime/nativeIrohTunnels/machineHttpLifecycle';
import { captureSessionRequestAuthorityForServerAccountScope } from '@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope';
import { parseToken } from '@/utils/auth/parseToken';
import { resolveTransferRouteDecision } from '../routing/resolveTransferRouteDecision';

export type MachineCarrierTransferFlow = 'file_transfer' | 'attachment_transfer';

/** Stable user-facing failure copy for an operation pinned to machine/1. */
export const MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR = 'A direct machine connection is required for this transfer.';
export const MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR = 'The direct machine connection was interrupted. Retry the transfer.';

export type MachineCarrierHttpLease = Readonly<{
    localOrigin: string;
    requestHeaders: Readonly<Record<string, string>>;
    release: () => Promise<void> | void;
}>;

export type AcquireMachineCarrierHttpLease = (input: Readonly<{
    operationId: string;
    machineId: string;
    serverId?: string | null;
    flow: MachineCarrierTransferFlow;
    /** Existing transfer ceiling bound into the single-use signed grant. */
    maxBytes: number;
    signal?: AbortSignal;
}>) => Promise<MachineCarrierHttpLease>;

function readTargetIrohEndpoint(serverId: string, machineId: string) {
    const state = storage.getState();
    const candidate = readPeerEndpointForServerScope({
        state,
        serverId,
        machineId,
        select: (machine) => machine.daemonState?.peerMediation?.iroh?.endpoint,
    });
    const parsed = IrohEndpointDescriptorV1Schema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
}

export type MachineCarrierRoute = Readonly<
    | { kind: 'standard' }
    | {
        kind: 'iroh_peer';
        acquire: (input: Readonly<{
            operationId: string;
            flow: MachineCarrierTransferFlow;
            maxBytes: number;
            signal?: AbortSignal;
        }>) => Promise<MachineCarrierHttpLease>;
    }
>;

/** Reads the captured route without giving downstream callers a second decision. */
export function isIrohMachineCarrierRoute(
    route: MachineCarrierRoute | null | undefined,
): boolean {
    return route?.kind === 'iroh_peer';
}

/** One route decision for the whole transfer. Callers never reselect after prepare. */
export async function resolveMachineCarrierRoute(machineId: string, serverId?: string | null): Promise<MachineCarrierRoute> {
    const server = resolveTargetServer(serverId);
    if (!server || !readTargetIrohEndpoint(server.serverId, machineId)) {
        return { kind: 'standard' };
    }
    if (!await probeIrohMachineHttpLifecycleAvailability()) {
        return { kind: 'standard' };
    }
    const serverFeatures = await getReadyServerFeatures({ serverId: server.serverId });
    const availableNow = { status: 'viable' as const, checkedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER };
    const decision = resolveTransferRouteDecision({
        serverFeatures,
        directPeerRoute: availableNow,
        directPeerRouteKinds: ['iroh_peer'],
        machineRpcDirectRoute: availableNow,
    });
    if (decision.kind !== 'selected' || decision.preferredRouteKind !== 'iroh_peer') {
        return { kind: 'standard' };
    }
    return {
        kind: 'iroh_peer',
        acquire: async (input) => await acquireMachineCarrierHttpLease({
            ...input,
            machineId,
            serverId,
        }),
    };
}

/**
 * Production account-client lease owner. The existing transfer prepare owns
 * operationId/maxBytes; this function only binds them into V2 authorization
 * and starts one native HTTP lifecycle lease on the shared app endpoint.
 */
export const acquireMachineCarrierHttpLease: AcquireMachineCarrierHttpLease = async (input) => {
    const server = resolveTargetServer(input.serverId);
    if (!server) throw new Error(MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR);
    const credentials = await TokenStorage.getCredentialsForServerUrl(server.serverUrl, { serverId: server.serverId });
    const targetEndpoint = readTargetIrohEndpoint(server.serverId, input.machineId);
    if (!credentials || !targetEndpoint) throw new Error(MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR);
    const accountScope = createServerAccountScope(server.serverId, parseToken(credentials.token));
    if (!accountScope) throw new Error(MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR);

    const authority = await captureSessionRequestAuthorityForServerAccountScope({
        scope: accountScope,
        activeRequest: async (path, init) => await serverFetch(path, init),
    });

    try {
        const applicationEndpoint = await getIrohApplicationEndpoint({ relayUrls: targetEndpoint.relayUrls });
        const proofHandle = createEphemeralPeerRouteProofHandleV2({ randomBytes: getRandomBytes });
        try {
            const request = DirectRouteGrantRequestV2Schema.parse({
                v: 2,
                kind: 'ephemeral_ed25519',
                ephemeralPublicKeyBase64Url: proofHandle.publicKeyBase64Url,
                machineId: input.machineId,
                flowKind: 'bounded_transfer',
                routeKind: 'iroh_peer',
                endpointFingerprint: targetEndpoint.endpointId,
                ttlMs: DIRECT_ROUTE_GRANT_TTL_MS.boundedTransferSingle,
                scope: {
                    kind: 'bounded_transfer',
                    mode: 'single',
                    transferId: input.operationId,
                    maxBytes: input.maxBytes,
                },
                iroh: {
                    initiator: { kind: 'account_client', endpointId: applicationEndpoint.endpointId },
                    target: { machineId: input.machineId, endpointId: targetEndpoint.endpointId },
                    operationKind: input.flow,
                },
            });
            const granted = await requestPeerRouteGrantV2({ authority, request });
            if (!granted.ok) throw new Error(granted.reasonCode);
            const proof = proofHandle.sign(granted.value);
            const currentTarget = readTargetIrohEndpoint(server.serverId, input.machineId);
            if (!currentTarget || JSON.stringify(currentTarget) !== JSON.stringify(targetEndpoint)) {
                throw new Error('Target Iroh endpoint changed while authorizing transfer');
            }
            const handshake = IrohMachineHandshakeV1Schema.parse({
                v: 1,
                accountId: granted.value.payload.accountId,
                initiator: granted.value.payload.iroh?.initiator,
                target: granted.value.payload.iroh?.target,
                flow: input.flow,
                operationId: input.operationId,
                grant: granted.value,
                proof,
            });
            return await startIrohMachineHttpTunnel({
                endpointId: targetEndpoint.endpointId,
                directAddresses: targetEndpoint.directAddresses,
                relayUrls: targetEndpoint.relayUrls,
                handshakeJson: JSON.stringify(handshake),
            });
        } finally {
            proofHandle.dispose();
        }
    } finally {
        await authority.release();
    }
};

export function normalizeMachineCarrierGrantMaxBytes(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : null;
}

/** Accepts only an explicit loopback HTTP origin owned by the native machine tunnel. */
export function normalizeMachineCarrierHttpLocalOrigin(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const match = /^http:\/\/(127\.0\.0\.1|localhost):(\d{1,5})\/?$/i.exec(value.trim());
    if (!match) {
        return null;
    }
    const port = Number(match[2]);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        return null;
    }
    return `http://${match[1]!.toLowerCase()}:${port}`;
}

/** Replaces only the origin; the prepared transfer path and query remain authoritative. */
export function rebaseMachineCarrierHttpEndpoint(endpoint: string, localOrigin: string): string {
    const normalizedOrigin = normalizeMachineCarrierHttpLocalOrigin(localOrigin);
    if (!normalizedOrigin) {
        throw new Error('Machine carrier returned an invalid local HTTP origin');
    }
    const endpointUrl = new URL(endpoint);
    const originUrl = new URL(normalizedOrigin);
    endpointUrl.protocol = originUrl.protocol;
    endpointUrl.username = '';
    endpointUrl.password = '';
    endpointUrl.host = originUrl.host;
    return endpointUrl.toString();
}
