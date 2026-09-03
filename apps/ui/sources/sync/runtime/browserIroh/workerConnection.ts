/**
 * The SharedWorker side of the browser Iroh command boundary (A7.2/A7.3).
 *
 * One connection handler per worker global, one client per connected port. Every
 * port talks to the same {@link BrowserIrohSharedEndpointOwner}, which is what
 * makes the endpoint shared rather than per tab.
 *
 * Ownership is explicit: a port releases only its own leases, so closing one tab
 * never tears down a sibling's, and a lease id crossing the wire is not a
 * capability another port may spend — the client id this handler assigns is.
 * Terminating the worker global itself is the browser's decision, not this
 * module's — there is no idle timer.
 */

import {
    parseBrowserIrohClientCommand,
    type BrowserIrohClientCommand,
    type BrowserIrohErrorCode,
    type BrowserIrohWorkerReply,
} from './protocol';
import { BrowserIrohOwnerError, type BrowserIrohSharedEndpointOwner } from './sharedEndpointOwner';

/** The part of a `MessagePort` this handler uses. */
export type BrowserIrohMessagePort = Readonly<{
    postMessage: (message: unknown) => void;
    addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void;
    start?: () => void;
}>;

function toErrorCode(error: unknown): BrowserIrohErrorCode {
    return error instanceof BrowserIrohOwnerError ? error.code : 'endpoint_unavailable';
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function runCommand(
    owner: BrowserIrohSharedEndpointOwner,
    clientId: string,
    command: BrowserIrohClientCommand,
): Promise<BrowserIrohWorkerReply> {
    const { requestId } = command;
    try {
        switch (command.kind) {
            case 'acquireLease': {
                const lease = await owner.acquireLease({ clientId, relayUrls: command.relayUrls });
                return {
                    v: 1,
                    kind: 'leaseAcquired',
                    requestId,
                    leaseId: lease.leaseId,
                    endpointId: lease.endpointId,
                    appliedRelayUrls: lease.appliedRelayUrls,
                };
            }
            case 'releaseLease':
                // The client id comes from this port, never from the message:
                // a lease id on the wire cannot name whose lease it is.
                await owner.releaseLease({ clientId, leaseId: command.leaseId });
                return { v: 1, kind: 'released', requestId };
            case 'releaseClient':
                await owner.releaseClient(clientId);
                return { v: 1, kind: 'released', requestId };
            case 'configureRelays': {
                const configured = await owner.configureRelays(command.relayUrls);
                return {
                    v: 1,
                    kind: 'relaysConfigured',
                    requestId,
                    endpointId: configured.endpointId,
                    appliedRelayUrls: configured.appliedRelayUrls,
                };
            }
            case 'openStream': {
                const opened = await owner.openStream({
                    clientId,
                    leaseId: command.leaseId,
                    // The protocol the client named, carried through unchanged.
                    // The worker never chooses or defaults it.
                    streamKind: command.streamKind,
                    endpointId: command.endpointId,
                    relayUrls: command.relayUrls,
                });
                return { v: 1, kind: 'streamOpened', requestId, ...opened };
            }
            case 'cancelRequest':
                // Open-request cancellation is coordinated by the connection
                // handler, which retains custody of a late stream handle.
                return { v: 1, kind: 'requestCancelled', requestId };
            case 'readStream': {
                const read = await owner.readStream({
                    clientId,
                    streamId: command.streamId,
                    maxBytes: command.maxBytes,
                });
                return { v: 1, kind: 'streamRead', requestId, ...read };
            }
            case 'writeStream':
                await owner.writeStream({ clientId, streamId: command.streamId, bytes: command.bytes });
                return { v: 1, kind: 'streamWritten', requestId };
            case 'finishStreamWrite':
                await owner.finishStreamWrite({ clientId, streamId: command.streamId });
                return { v: 1, kind: 'streamWriteFinished', requestId };
            case 'cancelStream':
                await owner.cancelStream({ clientId, streamId: command.streamId });
                return { v: 1, kind: 'streamCancelled', requestId };
            case 'closeStream':
                await owner.closeStream({ clientId, streamId: command.streamId });
                return { v: 1, kind: 'streamClosed', requestId };
            case 'status':
                return { v: 1, kind: 'status', requestId, status: owner.status() };
            case 'clearApplicationData':
                await owner.clearApplicationData();
                return { v: 1, kind: 'cleared', requestId };
        }
    } catch (error) {
        return {
            v: 1,
            kind: 'error',
            requestId,
            code: toErrorCode(error),
            message: toErrorMessage(error),
        };
    }
}

/**
 * Creates the `onconnect` handler for the browser Iroh SharedWorker. `newClientId`
 * is injected so a test can name clients; production uses a random id whose only
 * job is lease custody within this worker global.
 */
export function createBrowserIrohWorkerConnectionHandler(
    owner: BrowserIrohSharedEndpointOwner,
    newClientId: () => string = defaultClientId,
): (port: BrowserIrohMessagePort) => void {
    return (port) => {
        const clientId = newClientId();
        const activeOpenRequests = new Set<string>();
        const cancelledOpenRequests = new Set<string>();
        port.addEventListener('message', (event) => {
            const command = parseBrowserIrohClientCommand(event.data);
            if (command === null) {
                // A port is reachable by any script on the origin. An
                // unrecognized message is refused, never guessed at, and never
                // allowed to reach the endpoint owner.
                port.postMessage({
                    v: 1,
                    kind: 'error',
                    requestId: readRequestIdForRefusal(event.data),
                    code: 'protocol_violation',
                    message: 'Unrecognized browser Iroh command',
                } satisfies BrowserIrohWorkerReply);
                return;
            }
            if (command.kind === 'cancelRequest') {
                if (activeOpenRequests.has(command.targetRequestId)) {
                    cancelledOpenRequests.add(command.targetRequestId);
                }
                port.postMessage({
                    v: 1,
                    kind: 'requestCancelled',
                    requestId: command.requestId,
                } satisfies BrowserIrohWorkerReply);
                return;
            }
            if (command.kind === 'openStream') activeOpenRequests.add(command.requestId);
            void runCommand(owner, clientId, command).then((reply) => {
                if (command.kind === 'openStream') activeOpenRequests.delete(command.requestId);
                if (command.kind === 'openStream' && cancelledOpenRequests.delete(command.requestId)) {
                    if (reply.kind === 'streamOpened') {
                        void owner.closeStream({ clientId, streamId: reply.streamId }).catch(() => undefined);
                    }
                    return;
                }
                port.postMessage(reply);
            });
        });
        port.start?.();
    };
}

/**
 * A refusal still has to be correlatable when the sender supplied a plausible
 * request id, otherwise a client that sent a slightly wrong command waits
 * forever instead of failing.
 */
function readRequestIdForRefusal(data: unknown): string {
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
        const requestId = (data as Record<string, unknown>).requestId;
        if (typeof requestId === 'string' && requestId.length > 0) return requestId;
    }
    return 'unknown';
}

function defaultClientId(): string {
    const cryptoRandomUUID = globalThis.crypto?.randomUUID;
    if (typeof cryptoRandomUUID === 'function') {
        return cryptoRandomUUID.call(globalThis.crypto);
    }
    return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
