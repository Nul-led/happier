import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { useSessionServerId } from '@/sync/store/hooks';

export type PreferredSessionServerTarget = SessionAddress | Readonly<{
    serverId?: string | null;
    sessionId: string;
}>;

/** Legacy boundary for callers that genuinely have only a Home-local Session id. */
export function useLegacyUniqueServerIdForBareSessionId(
    sessionId: string,
    enabled = true,
): string | null {
    return useSessionServerId(sessionId, enabled);
}

export function usePreferredServerIdForSession(
    target: PreferredSessionServerTarget,
    enabled = true,
): string | null {
    const exactAddress = normalizeSessionAddress(target.serverId, target.sessionId);
    const legacyServerId = useLegacyUniqueServerIdForBareSessionId(
        target.sessionId,
        enabled && exactAddress === null,
    );

    return enabled ? exactAddress?.serverId ?? legacyServerId : null;
}
