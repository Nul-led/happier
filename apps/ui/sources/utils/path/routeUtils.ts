const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/** Single owner for app-internal navigation destinations from persisted or remote input. */
export function normalizeInternalReturnPath(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (CONTROL_CHARACTER_PATTERN.test(trimmed) || trimmed.includes('\\')) return null;

    let decoded: string;
    try {
        decoded = decodeURIComponent(trimmed);
    } catch {
        return null;
    }

    if (CONTROL_CHARACTER_PATTERN.test(decoded) || decoded.includes('\\')) return null;
    if (decoded.includes(':')) return null;
    if (!decoded.startsWith('/')) return null;
    if (decoded.startsWith('//')) return null;
    if (decoded.includes('//')) return null;

    return decoded;
}

export function coerceRelativeRoute(raw: string): string | null {
    return normalizeInternalReturnPath(raw);
}
