/**
 * Hardened SCM remote URL parser shared across first-party SCM hosting provider plugins.
 *
 * It produces the corridor's **transport identity**: how git reaches a repository, parsed
 * exactly as configured and never re-spelled. It is deliberately NOT a forge identity — the
 * API base URL a provider reads from comes from the connected account's binding, never from a
 * remote's authority.
 *
 * Rejected shapes, each closing a distinct bypass:
 * - a URL-shaped input that fails policy is rejected outright and must NOT fall through to the
 *   scp-syntax branch (`https://host:8443` would otherwise parse as `scp(host='https')`)
 * - search params or hash fragments — never valid for a Git remote
 * - embedded password (any scheme) — credentials come from the descriptor materializer
 * - embedded username on `https:` — same reason; SSH allows `git@host`, so a username is
 *   preserved on `ssh:`/scp syntax
 * - Windows drive letters (`C:/foo`) reaching the scp-syntax branch as `host='C'`
 *
 * A port is **retained**, not rejected: the return shape carries it as its own field, so no
 * consumer can silently fold `ssh://git@forge.example:2222/team/repo.git` into `forge.example`.
 * Comparison and reconstruction sites read `port` explicitly. `https:` is a special scheme, so
 * the platform URL parser already erases its default `:443`; `ssh:` is not, so `:22` survives
 * here and a comparison owner is what coalesces it with an unnamed ssh port.
 *
 * Field semantics: `host` is lowercased (hostnames are case-insensitive per RFC 3986); `path`
 * has leading/trailing slashes trimmed, is percent-decoded, and has any `.git` suffix stripped —
 * its case is preserved, because a repository path segment is case-bearing. Ambiguous or
 * non-canonical input returns `null` so the adapter can fall back to other detection paths
 * instead of inheriting a half-parsed shape.
 */

/** Every remote spelling this parser understands. `scp:` is a syntax, not a URL protocol. */
export type ScmRemoteUrlScheme = 'https:' | 'ssh:' | 'scp:';

/**
 * Transport identity: the remote exactly as configured, parsed, never re-spelled.
 *
 * The arms make invalid states unrepresentable rather than runtime-rejected: the scp arm has no
 * `port` field at all, because scp syntax does not carry port semantics, and the `https:` arm has
 * no `username`, because an embedded username on HTTPS is a credential the materializer owns.
 */
export type ScmTransportIdentityV1 =
    | Readonly<{
        syntax: 'url';
        protocol: 'https:';
        host: string;
        /** Null means the remote named no port. It never means "the default port". */
        port: number | null;
        path: string;
    }>
    | Readonly<{
        syntax: 'url';
        protocol: 'ssh:';
        host: string;
        port: number | null;
        username: string | null;
        path: string;
    }>
    | Readonly<{
        syntax: 'scp';
        host: string;
        username: string | null;
        path: string;
    }>;

function stripGitSuffix(path: string): string {
    return path.endsWith('.git') ? path.slice(0, -4) : path;
}

function normalizeRemotePath(path: string): string {
    return stripGitSuffix(path.replace(/^\/+/, '').replace(/\/+$/, ''));
}

/** `scheme://` exactly as RFC 3986 spells a scheme, so a scheme-bearing string is never scp. */
const SCHEME_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

function readPort(value: string): number | null | 'invalid' {
    if (value === '') return null;
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 'invalid';
}

type UrlLikeParseOutcome =
    | { kind: 'success'; parsed: ScmTransportIdentityV1 }
    | { kind: 'rejected' }
    | { kind: 'not-url' };

function parseUrlLikeRemote(remoteUrl: string): UrlLikeParseOutcome {
    let parsed: URL;
    try {
        parsed = new URL(remoteUrl);
    } catch {
        // A string that announces a scheme but does not parse is a rejected URL, not an scp
        // remote: falling through would parse `https://host:99999/owner/repo` — which WHATWG
        // refuses for its out-of-range port — as `scp(host='https')`. That is guard G1.
        return SCHEME_PREFIX_PATTERN.test(remoteUrl) ? { kind: 'rejected' } : { kind: 'not-url' };
    }
    // From here on the string was a parseable URL. Any policy failure must reject the
    // whole input — falling back to scp-style parsing would let an attacker bypass the
    // policy by appending `://` shenanigans (e.g. https://host:8443 → scp(host='https')).
    if (!parsed.hostname || !parsed.pathname) return { kind: 'rejected' };
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') return { kind: 'rejected' };
    // Defense-in-depth: search/hash should never appear on a git remote. The port is kept
    // instead of rejected, and travels in its own field so no consumer can drop it.
    if (parsed.search || parsed.hash) return { kind: 'rejected' };
    const port = readPort(parsed.port);
    if (port === 'invalid') return { kind: 'rejected' };
    // Embedded credentials must come from the descriptor materializer, never the URL.
    if (parsed.password) return { kind: 'rejected' };
    if (parsed.protocol === 'https:' && parsed.username) return { kind: 'rejected' };
    // A malformed escape (`%zz`) is non-canonical input, not a different remote: `decodeURIComponent`
    // throws on it, and that rejection belongs here rather than at the caller. Rejecting inside the
    // URL branch is what keeps guard G1 intact — falling through would read the same string as
    // `scp(host='https')`. Only the decode is guarded; every other failure keeps its own branch.
    let decodedPathname: string;
    try {
        decodedPathname = decodeURIComponent(parsed.pathname);
    } catch {
        return { kind: 'rejected' };
    }
    const path = normalizeRemotePath(decodedPathname);
    if (path.includes('?') || path.includes('#')) return { kind: 'rejected' };
    if (!path) return { kind: 'rejected' };
    const host = parsed.hostname.toLowerCase();
    return {
        kind: 'success',
        parsed: parsed.protocol === 'https:'
            ? { syntax: 'url', protocol: 'https:', host, port, path }
            : {
                syntax: 'url',
                protocol: 'ssh:',
                host,
                port,
                username: parsed.username || null,
                path,
            },
    };
}

function parseScpLikeRemote(remoteUrl: string): ScmTransportIdentityV1 | null {
    // Avoid Windows drive letters like "C:/foo"
    if (/^[a-zA-Z]:[\\/]/.test(remoteUrl)) return null;
    const match = /^(?:([^@\s]+)@)?([^:\s]+):(.+)$/.exec(remoteUrl);
    if (!match) return null;
    const username = match[1]?.trim() || null;
    const host = match[2]?.trim().toLowerCase();
    const path = normalizeRemotePath(match[3]?.trim() ?? '');
    if (path.includes('?') || path.includes('#')) return null;
    if (!host || !path) return null;
    return { syntax: 'scp', host, username, path };
}

export function parseScmRemoteUrl(remoteUrl: string): ScmTransportIdentityV1 | null {
    const trimmed = remoteUrl.trim();
    if (!trimmed) return null;
    const urlOutcome = parseUrlLikeRemote(trimmed);
    if (urlOutcome.kind === 'success') return urlOutcome.parsed;
    if (urlOutcome.kind === 'rejected') return null;
    return parseScpLikeRemote(trimmed);
}

export function encodeCompareRef(ref: string): string {
    return encodeURIComponent(ref);
}

export function stripTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}
