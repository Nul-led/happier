import type { AccountContinuationIntent } from '@happier-dev/cli-common/accountService';

import {
    createAccountServiceReturn,
    parseAccountServiceRouteInput,
} from '@/auth/accountDirectory/accountDirectoryNavigation';
import { normalizeInternalReturnPath } from '@/utils/path/routeUtils';

export const AUTHENTICATED_ACCOUNT_ENTRY_ROUTE = '/setup/wizard' as const;

export type AuthenticatedAccountEntryRequest = Readonly<{
    service: Readonly<{
        endpointUrl: string;
        serverIdentityId: string;
    }>;
    intent: AccountContinuationIntent;
    returnTo: string;
}>;

export type AuthenticatedAccountEntryHref = Readonly<{
    pathname: typeof AUTHENTICATED_ACCOUNT_ENTRY_ROUTE;
    params: Readonly<Record<string, string> & {
        mode: 'account-entry';
    }>;
}>;

const ROUTE_KEYS = new Set([
    'mode',
    'accountServiceEndpoint',
    'accountServiceIdentity',
    'accountIntent',
    'accountServiceReturn',
    'accountEntryReturnTo',
]);

function readSingle(value: string | string[] | undefined): string | null {
    return typeof value === 'string' ? value.trim() || null : null;
}

function readServerIdentity(value: unknown): string | null {
    const identity = typeof value === 'string' ? value.trim() : '';
    return identity || null;
}

export function parseAuthenticatedAccountEntryRoute(
    params: Readonly<Record<string, string | string[] | undefined>>,
): AuthenticatedAccountEntryRequest | null {
    if (Object.keys(params).some((key) => !ROUTE_KEYS.has(key))) return null;
    if (readSingle(params.mode) !== 'account-entry') return null;
    const returnMarker = readSingle(params.accountServiceReturn);
    if (returnMarker !== null && returnMarker !== '1') return null;
    const parsed = parseAccountServiceRouteInput(params);
    const returnTo = normalizeInternalReturnPath(readSingle(params.accountEntryReturnTo));
    if (!parsed || !returnTo || !readServerIdentity(parsed.serverIdentityId)) return null;
    return {
        service: { endpointUrl: parsed.endpoint, serverIdentityId: parsed.serverIdentityId },
        intent: parsed.intent,
        returnTo,
    };
}

export function buildAuthenticatedAccountEntryHref(
    request: AuthenticatedAccountEntryRequest,
): AuthenticatedAccountEntryHref {
    const serverIdentityId = readServerIdentity(request.service.serverIdentityId);
    const homeServerIdentityId = request.intent.kind === 'enter'
        ? request.intent.target.kind === 'explicit'
            ? readServerIdentity(request.intent.target.homeServerIdentityId)
            : null
        : request.intent.kind === 'refresh' ? null : readServerIdentity(request.intent.homeServerIdentityId);
    const requiresHomeIdentity = request.intent.kind !== 'refresh'
        && (request.intent.kind !== 'enter' || request.intent.target.kind === 'explicit');
    if (!serverIdentityId || (requiresHomeIdentity && !homeServerIdentityId)) {
        throw new Error('Authenticated Account entry requires exact stable service and Home identities');
    }
    const destination = createAccountServiceReturn({
        endpoint: request.service.endpointUrl,
        serverIdentityId,
        entryIntent: request.intent,
        returnTo: AUTHENTICATED_ACCOUNT_ENTRY_ROUTE,
    });
    if (!destination || destination.pathname !== AUTHENTICATED_ACCOUNT_ENTRY_ROUTE) {
        throw new Error('Authenticated Account entry requires a valid service endpoint');
    }
    return {
        pathname: AUTHENTICATED_ACCOUNT_ENTRY_ROUTE,
        params: {
            mode: 'account-entry',
            accountServiceEndpoint: destination.params.accountServiceEndpoint,
            accountServiceIdentity: destination.params.accountServiceIdentity,
            accountIntent: destination.params.accountIntent,
            accountEntryReturnTo: request.returnTo,
        },
    };
}
