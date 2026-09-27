import { t } from '@/text';
import { readServerProfileHomeName, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';

/**
 * How the app names a Home to a person: the name it was given, else "Personal Home" for this
 * device's Personal Home, else null. It never offers the Home's address as its name; a caller with
 * no name says "this Home" in a sentence, or shows the address only where it must tell Homes apart.
 */
export function resolveHomeDisplayName(profile: ServerProfile | null | undefined): string | null {
    if (!profile) return null;
    const named = readServerProfileHomeName(profile);
    if (named) return named;
    if (profile.personalHomeBootstrapCompleted === true) return t('personalHome.settings.defaultHomeLabel');
    return null;
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

/**
 * What a Home's monogram mark is drawn from: its display name, else a host that starts with a letter
 * ("devbox.internal" → D), else its label ("Home on 127.0.0.1" → H).
 */
export function resolveHomeMarkSource(profile: ServerProfile | null | undefined, fallbackId: string): string {
    const name = resolveHomeDisplayName(profile);
    if (name) return name;
    const host = readHomeHost(profile?.serverUrl ?? '');
    return /^\p{L}/u.test(host) ? host : resolveHomeDisplayLabel(profile, fallbackId);
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
