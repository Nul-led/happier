import { isAcceptedHappierUrlProtocol } from '@/utils/url/appScheme';

export type ParsedAccountConnectDeepLink = Readonly<{
    publicKeyB64Url: string;
}>;

export const ACCOUNT_CONNECT_ROUTE_PARAM = 'accountConnectKey';

export class LegacyAccountConnectUnavailableError extends Error {
    readonly code = 'legacy_provisioning_unavailable' as const;

    constructor() {
        super('Legacy reverse account QR issuance is unavailable; use a canonical Home device QR');
        this.name = 'LegacyAccountConnectUnavailableError';
    }
}

function isValidAccountLinkTarget(url: URL): boolean {
    if (!isAcceptedHappierUrlProtocol(url.protocol)) return false;

    const pathname = url.pathname ?? '';
    const hostname = url.hostname ?? '';

    if (pathname === '/account') return true;
    if (hostname === 'account' && (pathname === '' || pathname === '/')) return true;

    return false;
}

export function parseAccountConnectDeepLink(rawLink: string): ParsedAccountConnectDeepLink | null {
    let url: URL;
    try {
        url = new URL(rawLink);
    } catch {
        return null;
    }

    if (!isValidAccountLinkTarget(url)) return null;

    const tail = String(url.search ?? '').replace(/^\?/, '').trim();
    if (!tail) return null;

    return { publicKeyB64Url: tail };
}

export function buildAccountConnectDeepLink(input: Readonly<{ publicKeyB64Url: string }>): string {
    void input;
    throw new LegacyAccountConnectUnavailableError();
}

export function buildAccountConnectRoutePath(input: Readonly<{ publicKeyB64Url: string }>): string {
    const publicKeyB64Url = String(input.publicKeyB64Url ?? '').trim();
    return `/account?${ACCOUNT_CONNECT_ROUTE_PARAM}=${encodeURIComponent(publicKeyB64Url)}`;
}
