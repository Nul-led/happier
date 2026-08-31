import {
    MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
    MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR,
    type AcquireMachineCarrierHttpLease,
    type MachineCarrierHttpLease,
    type MachineCarrierTransferFlow,
    normalizeMachineCarrierGrantMaxBytes,
    normalizeMachineCarrierHttpLocalOrigin,
} from '../plumbing/machineCarrierHttpLease';

type JsonPayloadResult<TPayload> =
    | Readonly<{ ok: true; payload: TPayload }>
    | Readonly<{ ok: false; error: string; errorCode?: string }>;

export async function downloadJsonPayloadWithCarrierFallbacks<TPayload>(params: Readonly<{
    downloadViaDirectExport: (httpOriginOverride?: string) => Promise<JsonPayloadResult<TPayload>>;
    downloadViaServerRelay: () => Promise<JsonPayloadResult<TPayload>>;
    downloadViaChunkRpc?: (() => Promise<JsonPayloadResult<TPayload>>) | null;
    /** Pin remote bulk downloads to the authenticated Iroh machine/1 carrier. */
    machineCarrierRequired?: boolean;
    machineCarrierOperationId?: string;
    machineId?: string;
    machineCarrierFlow?: MachineCarrierTransferFlow;
    machineCarrierMaxBytes?: number;
    signal?: AbortSignal | null;
    acquireMachineCarrierHttpLease?: AcquireMachineCarrierHttpLease | null;
}>): Promise<JsonPayloadResult<TPayload>> {
    const normalizeThrownError = (error: unknown): JsonPayloadResult<TPayload> => ({
        ok: false,
        error: error instanceof Error ? error.message : 'Downloaded transfer payload returned an unsupported response',
    });

    if (params.machineCarrierRequired) {
        const maxBytes = normalizeMachineCarrierGrantMaxBytes(params.machineCarrierMaxBytes);
        if (!params.acquireMachineCarrierHttpLease || !params.machineId || maxBytes === null) {
            return { ok: false, error: MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR, errorCode: 'machine_carrier_unavailable' };
        }
        let lease: MachineCarrierHttpLease | null = null;
        try {
            lease = await params.acquireMachineCarrierHttpLease({
                operationId: params.machineCarrierOperationId ?? 'transfer',
                machineId: params.machineId,
                flow: params.machineCarrierFlow ?? 'file_transfer',
                maxBytes,
                signal: params.signal ?? undefined,
            });
            const localOrigin = normalizeMachineCarrierHttpLocalOrigin(lease.localOrigin);
            if (!localOrigin) {
                throw new Error('Machine carrier returned an invalid local HTTP origin');
            }
            const result = await params.downloadViaDirectExport(localOrigin);
            return result.ok
                ? result
                : { ok: false, error: MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR, errorCode: 'machine_carrier_transport_failed' };
        } catch {
            return { ok: false, error: MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR, errorCode: 'machine_carrier_transport_failed' };
        } finally {
            if (lease) {
                try {
                    await lease.release();
                } catch {
                    // Lease cleanup must not replace the authoritative transfer outcome.
                }
            }
        }
    }

    let directExportResult: JsonPayloadResult<TPayload>;
    try {
        directExportResult = await params.downloadViaDirectExport();
    } catch (error) {
        directExportResult = normalizeThrownError(error);
    }
    if (directExportResult.ok) {
        return directExportResult;
    }

    let relayResult: JsonPayloadResult<TPayload>;
    try {
        relayResult = await params.downloadViaServerRelay();
    } catch (error) {
        relayResult = normalizeThrownError(error);
    }
    if (relayResult.ok) {
        return relayResult;
    }

    if (!params.downloadViaChunkRpc) {
        return relayResult;
    }

    try {
        return await params.downloadViaChunkRpc();
    } catch (error) {
        return normalizeThrownError(error);
    }
}
