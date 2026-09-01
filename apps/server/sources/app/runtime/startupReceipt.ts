import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, isAbsolute } from 'node:path';
import type { PersonalHomeAuthenticatedReadiness } from '@happier-dev/cli-common/firstPartyRuntime';

export const SERVER_STARTUP_RECEIPT_PATH_ENV = 'HAPPIER_SERVER_STARTUP_RECEIPT_PATH';
export const SERVER_STARTUP_RECEIPT_NONCE_ENV = 'HAPPIER_SERVER_STARTUP_RECEIPT_NONCE';

export type BoundServerListener = Readonly<{
    host: string;
    port: number;
}>;

type TcpServerAddressOwner = Readonly<{
    server: Readonly<{
        address(): AddressInfo | string | null;
    }>;
}>;

export function resolveBoundServerListener(owner: TcpServerAddressOwner | null | undefined): BoundServerListener | null {
    const address = owner?.server.address();
    if (!address || typeof address === 'string') return null;
    const rawHost = String(address.address ?? '').trim().toLowerCase();
    const host = rawHost.startsWith('::ffff:') ? rawHost.slice('::ffff:'.length) : rawHost;
    const port = address.port;
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return Object.freeze({ host, port });
}

export async function writeStartupReceiptFromEnvironment(
    env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
    listenerOwner: TcpServerAddressOwner | null | undefined,
    personalHomeReadiness?: PersonalHomeAuthenticatedReadiness | null,
): Promise<boolean> {
    const receiptPath = String(env[SERVER_STARTUP_RECEIPT_PATH_ENV] ?? '').trim();
    const nonce = String(env[SERVER_STARTUP_RECEIPT_NONCE_ENV] ?? '').trim();
    const listener = resolveBoundServerListener(listenerOwner);
    if (!receiptPath || !isAbsolute(receiptPath) || !nonce || nonce.length > 256 || !listener) {
        return false;
    }

    const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
    await mkdir(dirname(receiptPath), { recursive: true });
    await rm(temporaryPath, { force: true });
    await writeFile(temporaryPath, `${JSON.stringify({
        nonce,
        pid: process.pid,
        host: listener.host,
        port: listener.port,
        ...(personalHomeReadiness ? { personalHomeReadiness } : {}),
    })}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
    await rename(temporaryPath, receiptPath);
    return true;
}
