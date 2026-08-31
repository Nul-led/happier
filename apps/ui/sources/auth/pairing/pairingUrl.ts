import {
    encodeHomeQrInviteV2Payload,
    parseHomeQrInviteV2Payload,
    type HomeQrInviteV2,
} from '@happier-dev/protocol';
import { isAcceptedHappierUrlProtocol, resolveAppUrlScheme } from '@/utils/url/appScheme';

type PairingDeepLinkPayload = {
    pairId: string;
    secret: string;
    serverUrl: string | null;
};

export type HomeQrInviteDeepLinkResult = Readonly<{ invite: HomeQrInviteV2 }>;

export const HOME_QR_INVITE_RESTORE_ROUTE_PARAM = 'pairingLink';

function isValidPairingLinkTarget(url: URL): boolean {
    if (!isAcceptedHappierUrlProtocol(url.protocol)) return false;

    const pathname = url.pathname ?? '';
    const hostname = url.hostname ?? '';

    if (pathname === '/pair') return true;
    if (hostname === 'pair' && (pathname === '' || pathname === '/')) return true;

    return false;
}

function normalizeServerUrl(raw: string): string | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;

    const pathname = url.pathname === '/' ? '' : url.pathname;
    const search = url.search ?? '';
    return `${url.origin}${pathname}${search}`;
}

/**
 * Released V1 deep-link reader. V1 exposes `pairId`/`secret` as URL parameters; it remains
 * parse-only reader compatibility. New invites use the opaque bounded V2 payload below.
 */
function parsePairingDeepLink(rawLink: string): PairingDeepLinkPayload | null {
    let url: URL;
    try {
        url = new URL(rawLink);
    } catch {
        return null;
    }

    if (!isValidPairingLinkTarget(url)) return null;

    const version = url.searchParams.get('v');
    if (version != null && version !== '1') return null;

    const pairId = url.searchParams.get('pairId');
    const secret = url.searchParams.get('secret');
    if (!pairId || !secret) return null;

    const server = url.searchParams.get('server');
    const serverUrl = server ? normalizeServerUrl(server) : null;

    return { pairId, secret, serverUrl };
}

export { parsePairingDeepLink };

export class LegacyPairingWriterUnavailableError extends Error {
    readonly code = 'legacy_provisioning_unavailable' as const;

    constructor() {
        super('V1 pairing link issuance is unavailable; create a canonical Home QR invite');
        this.name = 'LegacyPairingWriterUnavailableError';
    }
}

export function buildPairingDeepLink(input: { pairId: string; secret: string; serverUrl?: string | null }): string {
    void input;
    throw new LegacyPairingWriterUnavailableError();
}

/** Build a v2 link carrying one opaque, bounded invite payload. */
export function buildHomeQrInviteDeepLink(input: Readonly<{ invite: HomeQrInviteV2 }>): string {
    const payload = encodeHomeQrInviteV2Payload(input.invite);
    const link = `${resolveAppUrlScheme()}:///pair?v=2&payload=${encodeURIComponent(payload)}`;
    return link;
}

/** Parse only the v2 opaque invite shape; v1 links stay on the compatibility reader. */
export function parseHomeQrInviteDeepLink(rawLink: string): HomeQrInviteDeepLinkResult | null {
    let url: URL;
    try {
        url = new URL(rawLink);
    } catch {
        return null;
    }
    if (!isValidPairingLinkTarget(url)) return null;
    if (url.hash) return null;
    const entries = [...url.searchParams.entries()];
    if (entries.length !== 2 || url.searchParams.get('v') !== '2' || !url.searchParams.has('payload')) return null;
    const invite = parseHomeQrInviteV2Payload(url.searchParams.get('payload') ?? '', { nowMs: Date.now() });
    if (!invite) return null;
    return { invite };
}

/** Route a validated V2 invite to the canonical restore controller without consuming its input. */
export function buildHomeQrInviteRestoreRoutePath(rawLink: string): string | null {
    const link = String(rawLink ?? '').trim();
    if (!parseHomeQrInviteDeepLink(link)) return null;
    return `/restore?${HOME_QR_INVITE_RESTORE_ROUTE_PARAM}=${encodeURIComponent(link)}`;
}
