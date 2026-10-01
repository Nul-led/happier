import { DEFAULT_HAPPIER_CLOUD_SERVER_URL } from '@happier-dev/cli-common/happierCloud';

export function resolveWebappUrlFromServerUrl(serverUrl: string): string {
    const normalized = String(serverUrl ?? '').trim();
    if (!normalized) return normalized;

    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return normalized;
        }
        const origin = parsed.origin.replace(/\/+$/, '');
        if (origin === DEFAULT_HAPPIER_CLOUD_SERVER_URL) {
            return 'https://cloud.happier.dev';
        }
        return origin;
    } catch {
        return normalized;
    }
}
