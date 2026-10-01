import { getServerProfileById, resolveUniqueServerProfileByUrl } from '@/sync/domains/server/serverProfiles';

/**
 * The one rule for naming the saved Home a notification belongs to.
 *
 * A device-local notification carries the saved Home id this device assigned.
 * A rich push names its Home only by client URL, so it resolves to a saved
 * profile only when exactly one profile has that URL; duplicate or unknown URLs
 * fail closed rather than borrowing the focused Home.
 */
export function resolveNotificationSavedHome(params: Readonly<{
    serverId: string | null | undefined;
    serverUrl: string;
}>): { id: string; serverUrl: string } | null {
    const serverId = String(params.serverId ?? '').trim();
    if (serverId) {
        const profile = getServerProfileById(serverId);
        if (!profile) return null;
        return { id: profile.id, serverUrl: profile.serverUrl };
    }

    const profile = resolveUniqueServerProfileByUrl(params.serverUrl);
    return profile ? { id: profile.id, serverUrl: profile.serverUrl } : null;
}
