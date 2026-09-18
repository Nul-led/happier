import { downloadBulkJsonPayloadViaDirectExport } from '../plumbing/directTransferExportDownload';
import { resolveMachineCarrierRoute } from '../plumbing/machineCarrierHttpLease';
import { downloadBulkJsonPayloadViaMachineRpc } from './downloadBulkJsonPayloadViaMachineRpc';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { assertRpcResponseWithSuccess } from '@/sync/runtime/assertRpcResponseWithSuccess';

type DirectExportDownloadParams = Parameters<typeof downloadBulkJsonPayloadViaDirectExport>[0];
type DirectExportRequest = DirectExportDownloadParams['request'];

type MachineJsonCarrierDownloadParams<TPayload> = Readonly<{
    machineId: string;
    serverId?: string | null;
    timeoutMs?: number;
    parsePayload: (value: unknown) => TPayload | null;
    signal?: AbortSignal | null;
    predecessorRpc?: Readonly<{
        payloadWithRecipient: (recipientPublicKeyBase64: string) => object;
        initMethod: string;
        chunkMethod: string;
        finalizeMethod: string;
        abortMethod: string;
    }>;
}>;

async function callPredecessorDownloadRpc<TResponse extends { success: boolean }>(params: Readonly<{
    machineId: string;
    serverId?: string | null;
    timeoutMs?: number;
    method: string;
    payload: object;
}>): Promise<TResponse> {
    return assertRpcResponseWithSuccess<TResponse>(await machineRpcWithServerScope({
        machineId: params.machineId,
        serverId: params.serverId,
        timeoutMs: params.timeoutMs,
        method: params.method,
        preferScoped: false,
        payload: params.payload,
    }));
}

async function downloadViaPredecessorRpc<TPayload>(
    params: MachineJsonCarrierDownloadParams<TPayload>,
    predecessorRpc: NonNullable<MachineJsonCarrierDownloadParams<TPayload>['predecessorRpc']>,
) {
    const call = async <TResponse extends { success: boolean }>(method: string, payload: object) =>
        await callPredecessorDownloadRpc<TResponse>({
            machineId: params.machineId,
            serverId: params.serverId,
            timeoutMs: params.timeoutMs,
            method,
            payload,
        });
    return await downloadBulkJsonPayloadViaMachineRpc({
        init: async ({ recipientPublicKeyBase64 }) => await call(
            predecessorRpc.initMethod,
            predecessorRpc.payloadWithRecipient(recipientPublicKeyBase64),
        ),
        readChunk: async (request) => await call(predecessorRpc.chunkMethod, request),
        finalize: async (request) => await call(predecessorRpc.finalizeMethod, request),
        abort: async (request) => await call(predecessorRpc.abortMethod, request),
        parsePayload: params.parsePayload,
        signal: params.signal ?? null,
    });
}

/** Downloads one JSON payload through the mandatory finite machine/1 carrier. */
export async function downloadJsonPayloadViaMachineCarrier<
    TPayload,
    TDirectExportRequest extends DirectExportRequest,
>(
    params: MachineJsonCarrierDownloadParams<TPayload> & Readonly<{
        directExportRequest: TDirectExportRequest;
    }>,
) {
    if (params.signal?.aborted) {
        return { ok: false as const, error: 'Download canceled' };
    }

    const machineRoute = await resolveMachineCarrierRoute(params.machineId, params.serverId);
    if (machineRoute.kind === 'legacy_machine_rpc' && params.predecessorRpc) {
        return await downloadViaPredecessorRpc(params, params.predecessorRpc);
    }
    if (machineRoute.kind !== 'iroh_peer') {
        return {
            ok: false as const,
            error: machineRoute.kind === 'unavailable'
                ? machineRoute.error
                : 'This transfer requires a newer machine runtime',
            ...(machineRoute.kind === 'unavailable' ? { errorCode: machineRoute.errorCode } : {}),
        };
    }

    return await downloadBulkJsonPayloadViaDirectExport({
        machineId: params.machineId,
        ...(typeof params.serverId === 'string' ? { serverId: params.serverId } : {}),
        ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {}),
        request: params.directExportRequest,
        parsePayload: params.parsePayload,
        signal: params.signal ?? null,
        acquirePreparedCarrier: async ({ operationId }) => await machineRoute.acquire({
            operationId,
            signal: params.signal ?? undefined,
        }),
    });
}
