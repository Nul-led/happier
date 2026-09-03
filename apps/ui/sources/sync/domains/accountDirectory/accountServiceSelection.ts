import { resolveSelectedAccountServiceEndpoint } from '@/sync/domains/server/serverProfiles';
import { createAccountDirectoryServiceKey } from './accountDirectorySession';

/**
 * True while `serviceKey` still names the selected sign-in service. A continuation or entry
 * intent belongs to the service that started it, so a later selection must never inherit it.
 */
export function isSelectedAccountServiceKey(serviceKey: string): boolean {
    const selected = resolveSelectedAccountServiceEndpoint();
    return createAccountDirectoryServiceKey({
        endpoint: selected.url,
        serverIdentityId: selected.serverIdentityId ?? null,
    }) === serviceKey;
}
