import type { AccountContinuationIntent } from '@happier-dev/cli-common/accountService';

import {
    createAccountServiceReturn,
    parseAccountServiceRouteInput,
} from '@/auth/accountDirectory/accountDirectoryNavigation';
import { normalizeInternalReturnPath } from '@/utils/path/routeUtils';

/** Sign in with an account service (find your Homes, link this Home, refresh the account). */
export const AUTHENTICATED_ACCOUNT_ENTRY_ROUTE = '/homes/sign-in' as const;

/**
 * Where account entry lived before it had its own route. Sign-in returns issued before the move still
 * land here with `mode=account-entry`; that route redirects them to `AUTHENTICATED_ACCOUNT_ENTRY_ROUTE`.
 */
export const LEGACY_ACCOUNT_ENTRY_ROUTE = '/setup/wizard' as const;

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
    params: Readonly<Record<string, string>>;
}>;

const ROUTE_KEYS = new Set([
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
            accountServiceEndpoint: destination.params.accountServiceEndpoint,
            accountServiceIdentity: destination.params.accountServiceIdentity,
            accountIntent: destination.params.accountIntent,
            accountEntryReturnTo: request.returnTo,
        },
    };
}

/**
 * The sign-in route for a request still addressed to the legacy path (`/setup/wizard?mode=account-entry&…`):
 * the same params without `mode`. `null` when the params are not a legacy account-entry request.
 */
export function resolveLegacyAccountEntryRedirect(
    params: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<{ pathname: typeof AUTHENTICATED_ACCOUNT_ENTRY_ROUTE; params: Readonly<Record<string, string>> }> | null {
    if (readSingle(params.mode) !== 'account-entry') return null;
    const forwarded: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
        if (key === 'mode' || typeof value !== 'string') continue;
        forwarded[key] = value;
    }
    return { pathname: AUTHENTICATED_ACCOUNT_ENTRY_ROUTE, params: forwarded };
}
