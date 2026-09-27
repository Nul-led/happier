/** Normalize a URL that is safe to use as an Account Service endpoint identity. */
export function normalizeAccountDirectoryEndpoint(value: string): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (
            (url.protocol !== 'https:' && url.protocol !== 'http:')
            || url.username
            || url.password
            || url.search
            || url.hash
        ) {
            return null;
        }
        url.pathname = url.pathname.replace(/\/+$/, '');
        return url.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}

/** How a sign-in service without a presented name is shown: its host, never its full URL. */
export function formatAccountServiceHost(value: string): string {
    const normalized = normalizeAccountDirectoryEndpoint(value);
    if (!normalized) return String(value ?? '').trim();
    return new URL(normalized).host;
}
