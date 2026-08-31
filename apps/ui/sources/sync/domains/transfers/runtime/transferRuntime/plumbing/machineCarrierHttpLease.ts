export type MachineCarrierTransferFlow = 'file_transfer' | 'attachment_transfer';

/** Stable user-facing failure copy for an operation pinned to machine/1. */
export const MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR = 'A direct machine connection is required for this transfer.';
export const MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR = 'The direct machine connection was interrupted. Retry the transfer.';

export type MachineCarrierHttpLease = Readonly<{
    localOrigin: string;
    release: () => Promise<void> | void;
}>;

export type AcquireMachineCarrierHttpLease = (input: Readonly<{
    operationId: string;
    machineId: string;
    flow: MachineCarrierTransferFlow;
    /** Existing transfer ceiling bound into the single-use signed grant. */
    maxBytes: number;
    signal?: AbortSignal;
}>) => Promise<MachineCarrierHttpLease>;

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
