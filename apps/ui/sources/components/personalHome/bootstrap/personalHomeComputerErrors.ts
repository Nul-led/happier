import type { ThisComputerConnection } from '@/sync/domains/server/relayDrift/thisComputerConnection';

/**
 * A prepare-computer failure that is a fact about this computer's daemon, not a transient error.
 * `code` is the shared drift status and `thisComputer` carries the exact names, so the recovery
 * strip renders the same localized sentence every other surface uses; `message` is diagnostic
 * text for Details only.
 */
export type ThisComputerConnectionError = Error & Readonly<{
    code: ThisComputerConnection['status'];
    thisComputer: ThisComputerConnection;
}>;

export function createThisComputerConnectionError(connection: ThisComputerConnection): ThisComputerConnectionError {
    const message = connection.status === 'daemon_url_mismatch'
        ? `The daemon on this computer is connected to a different Home (${connection.daemonHomeLabel ?? 'unknown'}).`
        : connection.status === 'daemon_account_mismatch'
            ? `The daemon on this computer is signed in to a different account (${connection.daemonAccountLabel ?? 'unknown'}).`
            : `The daemon on this computer is not ready for this Home (${connection.status}).`;
    return Object.assign(new Error(message), { code: connection.status, thisComputer: connection });
}

export function readThisComputerConnectionFromError(error: unknown): ThisComputerConnection | null {
    if (!error || typeof error !== 'object' || !('thisComputer' in error)) return null;
    const candidate = (error as { thisComputer?: unknown }).thisComputer;
    if (!candidate || typeof candidate !== 'object') return null;
    const connection = candidate as Partial<ThisComputerConnection>;
    return typeof connection.status === 'string' && typeof connection.homeLabel === 'string'
        ? candidate as ThisComputerConnection
        : null;
}
