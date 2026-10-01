import type { AccountContinuationIntent } from '@happier-dev/cli-common/accountService';
import { normalizeAccountDirectoryEndpoint, parseAccountContinuationIntent } from '@/auth/storage/tokenStorage';
import { normalizeInternalReturnPath } from '@/utils/path/routeUtils';

export type AccountServiceRouteInput = Readonly<{
    endpoint: string;
    serverIdentityId: string;
    intent: AccountContinuationIntent;
}>;

export function parseAccountServiceRouteInput(params: Readonly<Record<string, unknown>>): AccountServiceRouteInput | null {
    const endpoint = typeof params.accountServiceEndpoint === 'string' ? normalizeAccountDirectoryEndpoint(params.accountServiceEndpoint) : null;
    const serverIdentityId = typeof params.accountServiceIdentity === 'string' ? params.accountServiceIdentity.trim() : '';
    if (!endpoint || !serverIdentityId || typeof params.accountIntent !== 'string') return null;
    try {
        const intent = parseAccountContinuationIntent(JSON.parse(params.accountIntent));
        return intent ? { endpoint, serverIdentityId, intent } : null;
    } catch {
        return null;
    }
}

export function createAccountServiceReturn(pending: Readonly<{
    endpoint: string;
    serverIdentityId: string;
    entryIntent: AccountContinuationIntent;
    returnTo?: string;
    accountEntryReturnTo?: string;
}>): Readonly<{ pathname: string; params: Readonly<Record<string, string>> }> | null {
    const pathname = normalizeInternalReturnPath(pending.returnTo);
    const accountEntryReturnTo = normalizeInternalReturnPath(pending.accountEntryReturnTo);
    if (pending.accountEntryReturnTo !== undefined && !accountEntryReturnTo) return null;
    const endpoint = normalizeAccountDirectoryEndpoint(pending.endpoint);
    const intent = parseAccountContinuationIntent(pending.entryIntent);
    if (!pathname || !endpoint || !intent || !pending.serverIdentityId.trim()) return null;
    return {
        pathname,
        params: {
            // A pending sign-in stored before account entry moved to `/homes/sign-in` still names the
            // wizard path; it keeps the mode that path's redirect recognizes.
            ...(pathname === '/setup/wizard' ? { mode: 'account-entry' } : {}),
            ...(accountEntryReturnTo ? { accountEntryReturnTo } : {}),
            accountServiceEndpoint: endpoint,
            accountServiceIdentity: pending.serverIdentityId.trim(),
            accountIntent: JSON.stringify(intent),
            accountServiceReturn: '1',
        },
    };
}
