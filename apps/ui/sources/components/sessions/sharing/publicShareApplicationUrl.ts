import { sanitizeServerUrlForShareableLink } from '@/sync/domains/server/url/shareableServerUrl';

export function buildPublicShareApplicationUrl(params: Readonly<{
    applicationBaseUrl: string;
    token: string;
    serverUrl?: string | null;
}>): string {
    const applicationBaseUrl = params.applicationBaseUrl.replace(/\/+$/, '');
    const path = `${applicationBaseUrl}/share/${encodeURIComponent(params.token)}`;
    const serverUrl = sanitizeServerUrlForShareableLink(params.serverUrl);
    return serverUrl
        ? `${path}?${new URLSearchParams({ server: serverUrl }).toString()}`
        : path;
}
