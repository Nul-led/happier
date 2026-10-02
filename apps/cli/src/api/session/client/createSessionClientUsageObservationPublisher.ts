import type { SessionClientTransport } from './transport/sessionClientTransport';
import { createUsageObservationPublisher } from '@/usage/createUsageObservationPublisher';

export function createSessionClientUsageObservationPublisher(
    params: Readonly<{
        token: string;
        transport: SessionClientTransport;
        getSocket: () => { connected: boolean; emit: (event: 'usage-report', report: unknown) => void };
    }>,
) {
    return createUsageObservationPublisher({
        token: params.token,
        apiServerUrl: params.transport.serverUrl,
        ...(params.transport.resolveToken ? { resolveToken: params.transport.resolveToken } : {}),
        emitLegacyUsageReport: (report) => {
            const socket = params.getSocket();
            if (!socket.connected) {
                return false;
            }
            socket.emit('usage-report', report);
            return true;
        },
    });
}
