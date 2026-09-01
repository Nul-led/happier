import { isAcceptedHappierUrlProtocol, resolveAppUrlScheme } from '@/utils/url/appScheme';
import { normalizeServerIdentityIdCapability } from '@happier-dev/protocol';

export type ParsedTerminalConnectUrl = Readonly<{
    publicKeyB64Url: string;
    serverUrl: string | null;
    serverIdentityId?: string;
    pairing?: Readonly<{
        secretB64Url: string;
        createdAtMs: number;
        expiresAtMs: number;
    }>;
    supportsTokenOnly?: true;
}>;

export type TerminalConnectRouteParams = Readonly<Record<string, string | string[] | undefined>>;

const SAFE_SERVER_PROTOCOLS = new Set(['http:', 'https:']);
const TERMINAL_CONNECT_WEB_PATH = '/terminal/connect';

function normalizeServerUrl(raw: string): string | null {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (!SAFE_SERVER_PROTOCOLS.has(parsed.protocol)) return null;
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
}

export function normalizeTerminalConnectPathname(pathname: string): string {
    let value = String(pathname ?? '').trim();
    if (!value.startsWith('/')) {
        value = `/${value}`;
    }
    return value.replace(/\/+$/, '') || '/';
}

export function isTerminalConnectWebPathname(pathname: string): boolean {
    return normalizeTerminalConnectPathname(pathname) === TERMINAL_CONNECT_WEB_PATH;
}

function parseTerminalConnectWebUrl(raw: string): ParsedTerminalConnectUrl | null {
    try {
        const parsed = new URL(raw);
        if (!SAFE_SERVER_PROTOCOLS.has(parsed.protocol)) return null;
        if (!isTerminalConnectWebPathname(parsed.pathname)) return null;

        const hashTail = String(parsed.hash ?? '').replace(/^#/, '');
        const source = hashTail || String(parsed.search ?? '').replace(/^\?/, '');
        if (!source) return null;

        const params = new URLSearchParams(source);
        const key = (params.get('key') ?? '').trim();
        if (!key) return null;

        const serverUrl = normalizeServerUrl(params.get('server') ?? '');
        return withPairingContext({ publicKeyB64Url: key, serverUrl }, params);
    } catch {
        return null;
    }
}

function parsePairingContext(params: URLSearchParams): ParsedTerminalConnectUrl['pairing'] {
    const secretB64Url = (params.get('pairingSecret') ?? '').trim();
    const createdAtMs = Number(params.get('createdAt'));
    const expiresAtMs = Number(params.get('expiresAt'));
    if (
        !secretB64Url
        || !Number.isSafeInteger(createdAtMs)
        || !Number.isSafeInteger(expiresAtMs)
        || createdAtMs < 0
        || expiresAtMs <= createdAtMs
    ) {
        return undefined;
    }
    return { secretB64Url, createdAtMs, expiresAtMs };
}

function withPairingContext(
    base: Omit<ParsedTerminalConnectUrl, 'pairing' | 'supportsTokenOnly' | 'serverIdentityId'>,
    params: URLSearchParams,
): ParsedTerminalConnectUrl | null {
    const pairing = parsePairingContext(params);
    const hasPairingInput = ['pairingSecret', 'createdAt', 'expiresAt', 'serverIdentityId', 'supportsTokenOnly']
        .some((key) => params.has(key));
    if (!pairing) return hasPairingInput ? null : base;
    const serverIdentityId = normalizeServerIdentityIdCapability(params.get('serverIdentityId'));
    if (!serverIdentityId) return null;
    return {
        ...base,
        serverIdentityId,
        pairing,
        ...(params.get('supportsTokenOnly') === '1' ? { supportsTokenOnly: true } : {}),
    };
}

function buildPairingQuerySuffix(
    pairing: ParsedTerminalConnectUrl['pairing'],
    supportsTokenOnly: boolean,
    serverIdentityId: string | null | undefined,
): string {
    if (!pairing) return '';
    const normalizedServerIdentityId = normalizeServerIdentityIdCapability(serverIdentityId);
    if (!normalizedServerIdentityId) {
        throw new Error('Authenticated terminal pairing requires a stable Home identity');
    }
    return `&pairingSecret=${encodeURIComponent(pairing.secretB64Url)}`
        + `&createdAt=${pairing.createdAtMs}`
        + `&expiresAt=${pairing.expiresAtMs}`
        + `&serverIdentityId=${encodeURIComponent(normalizedServerIdentityId)}`
        + (supportsTokenOnly ? '&supportsTokenOnly=1' : '');
}

export function buildTerminalConnectDeepLink(params: Readonly<{
    publicKeyB64Url: string;
    serverUrl: string | null | undefined;
    pairing?: ParsedTerminalConnectUrl['pairing'];
    supportsTokenOnly?: boolean;
    serverIdentityId?: string;
}>): string {
    const terminalPrefix = `${resolveAppUrlScheme()}://terminal?`;
    const publicKeyB64Url = String(params.publicKeyB64Url ?? '').trim();
    const safeServerUrl = normalizeServerUrl(params.serverUrl ?? '');
    const pairingSuffix = buildPairingQuerySuffix(params.pairing, params.supportsTokenOnly === true, params.serverIdentityId);
    if (!safeServerUrl && !pairingSuffix) {
        return `${terminalPrefix}${publicKeyB64Url}`;
    }
    const serverSuffix = safeServerUrl ? `&server=${encodeURIComponent(safeServerUrl)}` : '';
    return `${terminalPrefix}key=${encodeURIComponent(publicKeyB64Url)}${serverSuffix}${pairingSuffix}`;
}

export function buildTerminalConnectWebHref(params: Readonly<{
    publicKeyB64Url: string;
    serverUrl: string | null | undefined;
    pairing?: ParsedTerminalConnectUrl['pairing'];
    supportsTokenOnly?: boolean;
    serverIdentityId?: string;
}>): string {
    const publicKeyB64Url = String(params.publicKeyB64Url ?? '').trim();
    const safeServerUrl = normalizeServerUrl(params.serverUrl ?? '');

    const serverSuffix = safeServerUrl ? `&server=${encodeURIComponent(safeServerUrl)}` : '';
    const hash =
        `#key=${encodeURIComponent(publicKeyB64Url)}${serverSuffix}`
        + `${buildPairingQuerySuffix(params.pairing, params.supportsTokenOnly === true, params.serverIdentityId)}`;

    return `${TERMINAL_CONNECT_WEB_PATH}${hash}`;
}

export function buildTerminalConnectAuthRedirectHref(params: Readonly<{
    serverUrl: string | null | undefined;
}>): string {
    const safeServerUrl = normalizeServerUrl(params.serverUrl ?? '');
    if (!safeServerUrl) return '/';
    return `/?server=${encodeURIComponent(safeServerUrl)}`;
}

export function parseTerminalConnectUrl(url: string): ParsedTerminalConnectUrl | null {
    const raw = String(url ?? '');
    let parsed: URL | null = null;
    try {
        parsed = new URL(raw);
    } catch {
        parsed = null;
    }

    if (!parsed || !isAcceptedHappierUrlProtocol(parsed.protocol) || parsed.hostname !== 'terminal') {
        return parseTerminalConnectWebUrl(raw);
    }

    const tail = raw.slice(`${parsed.protocol}//terminal?`.length);
    if (!tail) return null;

    // Legacy format: happier://terminal?<publicKeyB64Url>
    // Canonical format: happier://terminal?key=<publicKeyB64Url>&server=<encodedServerUrl>
    const looksLikeQuery = tail.includes('=') || tail.includes('&');
    if (!looksLikeQuery) {
        return { publicKeyB64Url: tail, serverUrl: null };
    }

    const params = new URLSearchParams(tail);
    const key = (params.get('key') ?? '').trim();
    if (!key) return null;

    const serverUrl = normalizeServerUrl(params.get('server') ?? '');
    return withPairingContext({ publicKeyB64Url: key, serverUrl }, params);
}

const TERMINAL_CONNECT_ROUTE_PARAM_NAMES = new Set([
    'key',
    'server',
    'serverIdentityId',
    'pairingSecret',
    'createdAt',
    'expiresAt',
    'supportsTokenOnly',
]);

function readFirstRouteParam(value: string | string[] | undefined): string {
    return typeof value === 'string'
        ? value
        : Array.isArray(value)
            ? String(value[0] ?? '')
            : '';
}

/**
 * Adapts Expo Router's decoded search-parameter projection to the canonical
 * terminal deep-link parser. The route owns no pairing or capability rules.
 */
export function parseTerminalConnectRouteParams(
    searchParams: TerminalConnectRouteParams,
): ParsedTerminalConnectUrl | null {
    const params = new URLSearchParams();
    for (const name of TERMINAL_CONNECT_ROUTE_PARAM_NAMES) {
        const value = readFirstRouteParam(searchParams[name]);
        if (value) params.set(name, value);
    }

    if (!params.get('key')?.trim()) {
        const legacyKeys = Object.keys(searchParams)
            .filter((name) => !TERMINAL_CONNECT_ROUTE_PARAM_NAMES.has(name));
        if (legacyKeys.length !== 1) return null;
        const legacyKey = legacyKeys[0]?.trim();
        if (!legacyKey) return null;
        params.set('key', legacyKey);
    }

    return parseTerminalConnectUrl(`${resolveAppUrlScheme()}://terminal?${params.toString()}`);
}
