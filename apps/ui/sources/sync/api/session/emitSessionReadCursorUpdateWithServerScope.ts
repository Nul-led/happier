import { createEphemeralServerSocketClient } from '@/sync/runtime/orchestration/serverScopedRpc/createEphemeralServerSocketClient';
import { createScopedSocketConnectParams } from '@/sync/runtime/orchestration/serverScopedRpc/createScopedSocketConnectParams';
import { resolveServerAccountRequestContext } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerAccountRequestContext';
import { scopedSocketEmitWithAck } from '@/sync/runtime/orchestration/serverScopedRpc/scopedSocketEmitWithAck';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { subscribeHomeCredentialMutations } from '@/auth/storage/tokenStorage';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

export type SessionReadCursorUpdateAck = Readonly<{
    result: 'success' | 'forbidden' | 'error';
    lastViewedSessionSeq?: number;
    viewer?: unknown;
}>;

/**
 * Publishes an automatic foreground observation through an exact Home socket.
 * The address is captured by the viewing lifecycle; active-Home state is never
 * consulted here, so focus changes cannot retarget the mutation.
 */
export async function emitSessionReadCursorUpdateWithServerScope(
    address: SessionAddress,
    lastViewedSessionSeq: number,
): Promise<SessionReadCursorUpdateAck> {
    const controller = new AbortController();
    const unsubscribeCredentials = subscribeHomeCredentialMutations((event) => {
        if (areServerProfileIdentifiersEquivalent(event.serverId, address.serverId)) controller.abort();
    });
    let context: Awaited<ReturnType<typeof resolveServerAccountRequestContext>> | null = null;
    let socket: Awaited<ReturnType<typeof createEphemeralServerSocketClient>> | null = null;
    let carrierCustodyTransferred = false;
    try {
        context = await resolveServerAccountRequestContext({
            serverId: address.serverId,
            preferScoped: true,
        });
        if (context.scope !== 'scoped') {
            throw new Error('Exact Session read cursor transport is unavailable');
        }
        // Captured so the narrowed scoped arm survives into the custody callback.
        const scopedContext = context;
        socket = await createEphemeralServerSocketClient(
            createScopedSocketConnectParams(scopedContext, () => {
                carrierCustodyTransferred = true;
                return scopedContext.release;
            }),
        );
        return await scopedSocketEmitWithAck<SessionReadCursorUpdateAck>({
            socket,
            event: 'update-read-cursor',
            timeoutMs: context.timeoutMs,
            payload: {
                sid: address.sessionId,
                lastViewedSessionSeq,
            },
            signal: controller.signal,
        });
    } finally {
        socket?.disconnect();
        if (!carrierCustodyTransferred && context?.scope === 'scoped') await context.release?.();
        unsubscribeCredentials();
    }
}
