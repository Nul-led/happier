import { getServerProfileById, listServerProfiles } from '@/sync/domains/server/serverProfiles';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';

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

    const targetKey = createServerUrlComparableKey(params.serverUrl);
    if (!targetKey) return null;
    const matches = listServerProfiles().filter(
        (profile) => createServerUrlComparableKey(profile.serverUrl) === targetKey,
    );
    return matches.length === 1
        ? { id: matches[0]!.id, serverUrl: matches[0]!.serverUrl }
        : null;
}
