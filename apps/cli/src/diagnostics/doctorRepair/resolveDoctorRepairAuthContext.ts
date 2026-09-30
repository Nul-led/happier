import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { configuration } from '@/configuration';
import { readCredentials, readSettings } from '@/persistence';
import type { AuthSignalsForProfile } from './classifyAuth';
import { checkAuthLive } from './authLiveCheck';

/**
 * Assemble auth signals for every configured server profile + the active
 * server URL, reading from persisted settings. A `machineId` present in
 * `machineIdByServerId` is treated as "machine registered" for that profile.
 *
 * Live-check policy: when a non-empty token exists we make a single
 * `GET /v1/account/profile` call for the *active* profile only, with a 3s
 * timeout. A 401/403 flips `isExpired` to true; anything else leaves it
 * false so the `auth_expired_for_active_profile` finding doesn't false-fire
 * offline. Non-active profiles don't get a live check — their `isExpired`
 * remains unknown (false) here; expiry on those is surfaced lazily when
 * the user actually switches to them.
 */
export async function resolveDoctorRepairAuthContext(params: Readonly<{
  /**
   * When set, the auth signals are built as if this profile were active —
   * driving live-check, expiry, and `isActive` flags off it instead of
   * the runtime selection. Surfaces absence: when no profile matches,
   * `targetProfileExists` is `false`.
   */
  targetServerId: string | null;
} > = { targetServerId: null }): Promise<Readonly<{
  activeServerUrl: string | null;
  authSignals: readonly AuthSignalsForProfile[];
  hasAnyServerProfile: boolean;
  /**
   * `null` when no `targetServerId` was passed (unscoped report).
   * `true` when the requested server profile exists in settings.
   * `false` when the requested server profile is not configured — the
   * caller emits `server_profile_missing` in this case.
   */
  targetProfileExists: boolean | null;
}>> {
  const [settings, credentials] = await Promise.all([
    readSettings().catch(() => null),
    readCredentials().catch(() => null),
  ]);
  const servers = settings?.servers ?? {};
  const runtimeServerId = configuration.activeServerId;
  const machineIdByServerId = settings?.machineIdByServerId ?? {};
  const lastTokenSubByServerId = settings?.lastTokenSubByServerId ?? {};
  const profiles = Object.values(servers).filter((p): p is NonNullable<typeof p> => Boolean(p));
  // Runtime selection is authoritative even when an env-selected profile is not saved yet.
  if (!profiles.some((profile) => profile.id === runtimeServerId)) {
    profiles.push({ id: runtimeServerId, name: runtimeServerId, serverUrl: configuration.serverUrl,
      webappUrl: configuration.webappUrl, createdAt: 0, updatedAt: 0, lastUsedAt: 0 });
  }
  const hasAnyServerProfile = profiles.length > 0;

  // When `--server <id>` is set, the report treats THAT profile as active
  // for the purpose of finding generation. Settings aren't mutated; only
  // the in-memory snapshot used to build this report.
  const effectiveActiveServerId = params.targetServerId ?? runtimeServerId;
  const activeProfile = profiles.find((p) => p.id === effectiveActiveServerId) ?? null;
  const targetProfileExists = params.targetServerId === null
    ? null
    : activeProfile !== null;
  const activeServerUrl = activeProfile?.id === runtimeServerId ? configuration.serverUrl : activeProfile?.serverUrl ?? null;

  // Credentials belong to the runtime-selected profile, not the saved default.
  // Probe only that store against its effective API endpoint.
  // Reachability tells the renderer whether we actually
  // confirmed the auth state — critical when the relay is down, so users
  // don't see a misleading "signed in" when we couldn't verify.
  const activeToken = String(credentials?.token ?? '').trim();
  let activeExpired = false;
  let activeReachability: 'verified' | 'unreachable' | 'not-probed' = 'not-probed';
  if (activeProfile && activeProfile.id === runtimeServerId && activeToken) {
    const result = await checkAuthLive({
      serverUrl: resolveServerHttpBaseUrl(),
      token: activeToken,
    });
    activeExpired = result === 'expired';
    // 'ok' and 'expired' are both definitive answers from the server.
    // 'unknown' means the server didn't respond — don't claim verified.
    activeReachability = result === 'unknown' ? 'unreachable' : 'verified';
  }

  const signals: AuthSignalsForProfile[] = profiles.map((profile) => {
    // Other profiles expose only historical metadata; never attribute the runtime
    // credential to another profile just because it shares an endpoint.
    const lastSub = String(lastTokenSubByServerId[profile.id] ?? '').trim();
    const machineId = String(profile.id === runtimeServerId ? settings?.machineId ?? '' : machineIdByServerId[profile.id] ?? '').trim();
    const isActive = profile.id === effectiveActiveServerId;
    const isRuntimeProfile = profile.id === runtimeServerId;
    const hasCredentials = isRuntimeProfile ? activeToken.length > 0 : lastSub.length > 0;
    return {
      serverId: profile.id,
      serverName: profile.name || profile.id,
      serverUrl: isRuntimeProfile ? configuration.serverUrl : profile.serverUrl,
      hasCredentials,
      isExpired: isActive ? activeExpired : false,
      machineRegistered: machineId.length > 0,
      credentialEvidence: isRuntimeProfile ? 'active-store' : 'historical-record',
      isActive,
      reachability: isActive ? activeReachability : 'not-probed',
    };
  });

  return { activeServerUrl, authSignals: signals, hasAnyServerProfile, targetProfileExists };
}
