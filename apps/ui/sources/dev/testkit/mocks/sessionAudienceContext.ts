import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

type SessionAudienceContextValue = Readonly<{
    scopes: ReadonlyMap<string, ServerAccountScope>;
    labelsVersion: string;
    labelsBySessionKey: ReadonlyMap<string, string | null>;
}>;

/**
 * Binds each requested Home to an Account without reaching device credential
 * storage, which is the real asynchronous boundary behind this hook.
 *
 * The returned value is cached per Home set so consumers keep the referential
 * stability the production hook guarantees.
 */
export function createSessionAudienceContextModuleMock(options?: Readonly<{
    accountIdForServerId?: (serverId: string) => string | null;
}>) {
    const resolveAccountId = options?.accountIdForServerId ?? ((serverId: string) => `account-${serverId}`);
    let cachedKey: string | null = null;
    let cachedValue: SessionAudienceContextValue | null = null;

    return {
        useSessionAudienceContext(addresses: readonly SessionAddress[]): SessionAudienceContextValue {
            const serverIds = [...new Set(addresses
                .map((address) => address.serverId)
                .filter((serverId): serverId is string => typeof serverId === 'string' && serverId.trim().length > 0)
                .map((serverId) => serverId.trim()))].sort();
            const key = JSON.stringify(serverIds);
            if (cachedKey !== key || !cachedValue) {
                const scopes = new Map<string, ServerAccountScope>();
                for (const serverId of serverIds) {
                    const accountId = resolveAccountId(serverId);
                    if (accountId) scopes.set(serverId, { serverId, accountId });
                }
                cachedKey = key;
                cachedValue = {
                    scopes,
                    labelsVersion: key,
                    labelsBySessionKey: new Map<string, string | null>(),
                };
            }
            return cachedValue;
        },
    };
}
