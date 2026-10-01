import { t } from '@/text';
import { getCachedServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import {
    readServerProfileHomeName,
    resolveUniqueServerProfileByUrl,
    resolveServerProfileScopeId,
    resolveServerProfileForPortableIdentity,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';

/**
 * How the app names a Home to a person: the name the Home itself publishes (`homePresentation`, set
 * in its Home settings, so every device says the same), else the name this device gave it, else
 * "Personal Home" for this device's Personal Home, else null. It never offers the Home's address as
 * its name; a caller with no name says "this Home" in a sentence, or shows the address only where it
 * must tell Homes apart. The published name is read from the Home's last features answer.
 */
export function resolveHomeDisplayName(profile: ServerProfile | null | undefined): string | null {
    if (!profile) return null;
    const published = getCachedServerFeaturesSnapshot({ serverId: resolveServerProfileScopeId(profile) });
    const publishedName = published?.status === 'ready' ? published.features.homePresentation?.displayName.trim() : '';
    if (publishedName) return publishedName;
    const named = readServerProfileHomeName(profile);
    if (named) return named;
    if (profile.personalHomeBootstrapCompleted === true) return t('personalHome.settings.defaultHomeLabel');
    return null;
}

/**
 * The display name of the Home a portable server identity belongs to (a machine target's Home), or
 * null when this device has no single named profile for it; callers then say "this Home".
 */
export function resolveHomeDisplayNameForServerIdentity(serverIdentityId: string): string | null {
    const resolution = resolveServerProfileForPortableIdentity(serverIdentityId);
    return resolution.kind === 'resolved' ? resolveHomeDisplayName(resolution.profile) : null;
}

/**
 * A label for a Home wherever one must be shown even without a name (lists that tell Homes apart):
 * the display name when there is one, else a sentence naming the Home by its host ("Home on
 * devbox.internal"), never the bare address; the Home's id only when it has no address at all.
 */
export function resolveHomeDisplayLabel(profile: ServerProfile | null | undefined, fallbackId: string): string {
    const name = resolveHomeDisplayName(profile);
    if (name) return name;
    const host = readHomeHost(profile?.serverUrl ?? '');
    return host ? t('server.homeOnHost', { host }) : fallbackId;
}

function readHomeHost(serverUrl: string): string {
    const display = toServerUrlDisplay(serverUrl);
    if (!display) return '';
    try {
        return new URL(display).host;
    } catch {
        return display;
    }
}

/**
 * The display name of the saved Home at a relay address, or `null` when it has none — including
 * when two saved Homes share the address (the canonical URL resolver never guesses, A13-05).
 */
export function resolveHomeDisplayNameForRelayUrl(relayUrl: string): string | null {
    return resolveHomeDisplayName(resolveUniqueServerProfileByUrl(relayUrl));
}
