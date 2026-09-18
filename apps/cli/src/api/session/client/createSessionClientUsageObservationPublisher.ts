import { serializeAxiosErrorForLog } from '@/api/client/serializeAxiosErrorForLog';
import type { SessionClientTransport } from './transport/sessionClientTransport';
import { createUsageObservationPublisher } from '@/usage/createUsageObservationPublisher';
import { logger } from '@/ui/logger';

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
                return;
            }
            socket.emit('usage-report', report);
        },
        onPublishError: (error) => {
            logger.debug('[SOCKET] Failed to publish usage observation (non-fatal)', serializeAxiosErrorForLog(error));
        },
    });
}
