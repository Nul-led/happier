import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { buildRealmQualifiedSessionLocalPreferenceKey } from '@/sync/domains/settings/sessionLocalPreferenceKey';

/**
 * Companion preferences share the realm-qualified Session-local preference key
 * owner with the mobile-surface selection; only the prefix differs, so the two
 * families cannot collide inside one local-settings map and neither invents a
 * second delimiter scheme.
 */
const SESSION_COMPANION_PREFERENCE_KEY_PREFIX = 'session-companion:v1';

export function buildRealmQualifiedSessionCompanionPreferenceKey(
    scope: ServerAccountScope,
    sessionId: string | null | undefined,
): string | null {
    return buildRealmQualifiedSessionLocalPreferenceKey({
        prefix: SESSION_COMPANION_PREFERENCE_KEY_PREFIX,
        kind: 'session',
        scope,
        ownerId: sessionId,
    });
}
