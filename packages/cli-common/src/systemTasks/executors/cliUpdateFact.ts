import { spawn } from 'node:child_process';

import { resolvePublicReleaseRingLabelForId, type PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import { resolveHappyHomeDirFromEnvironment } from '../../agents/resolveHappyHomeDir.js';
import { readInstalledVersionMarkersSync, resolveFirstPartyInstallLayout } from '../../firstPartyRuntime/index.js';
import { resolveWindowsCommandInvocation } from '../../process/index.js';
import {
  acquireSingleFlightLock,
  CLI_UPDATE_CHECK_INTERVAL_MS,
  CLI_UPDATE_CHECK_LOCK_TTL_MS,
  readCachedCliUpdateState,
  readUpdateCache,
  resolveCliUpdateCachePath,
  resolveCliUpdateCheckLockPath,
} from '../../update/index.js';
import {
  DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
  resolveExplicitOrInstalledLocalFirstPartyCommand,
} from './happierJsonExecutor.js';
import { applyPublicReleaseRingScopeToEnv } from './releaseRingScopedEnv.js';

/**
 * Whether a newer CLI exists on this channel, from the CLI's own update-check owner
 * (`happier self check` and its per-channel cache). `managed` is true only for the CLI the managed
 * install path placed for this channel — the only CLI the desktop may update in place (R17).
 */
export type LocalCliUpdateFact = Readonly<{
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  managed: boolean;
  /** Where a CLI Happier did not install resolves from (its command path); only when not managed. */
  origin?: string;
}>;

function channelArgs(ring: PublicReleaseRingId): string[] {
  if (ring === 'preview') return ['--preview'];
  if (ring === 'publicdev') return ['--dev'];
  return [];
}

/**
 * Starts the same detached `self check --quiet` the CLI's own update notice starts, under the same
 * per-channel single-flight lock; nothing waits for it and no timer is added. The next status read
 * sees the refreshed cache.
 */
function refreshInBackground(params: Readonly<{
  command: string;
  ring: PublicReleaseRingId;
  happierHomeDir: string;
  processEnv: NodeJS.ProcessEnv;
  nowMs: number;
}>): void {
  const lockPath = resolveCliUpdateCheckLockPath({
    happierHomeDir: params.happierHomeDir,
    channelLabel: resolvePublicReleaseRingLabelForId(params.ring),
  });
  if (!acquireSingleFlightLock({ lockPath, nowMs: params.nowMs, ttlMs: CLI_UPDATE_CHECK_LOCK_TTL_MS, pid: process.pid })) return;
  const env = { ...applyPublicReleaseRingScopeToEnv(params.processEnv, params.ring), HAPPIER_CLI_UPDATE_CHECK_SPAWNED: '1' };
  const invocation = resolveWindowsCommandInvocation({
    command: params.command,
    args: ['self', 'check', '--quiet', ...channelArgs(params.ring)],
    env,
  });
  try {
    const child = spawn(invocation.command, invocation.args, {
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Same contract as the CLI's own notice: a failed refresh leaves the last cached answer, which
    // is still reported; the check never fails a status read.
  }
}

/**
 * Reads the cached update fact for this channel's CLI without a network round trip. A stale cache
 * triggers the existing background refresh (see `refreshInBackground`). `null` when no CLI version
 * is known for this channel.
 */
export function readLocalCliUpdateFact(params: Readonly<{
  releaseRing?: PublicReleaseRingId;
  processEnv?: NodeJS.ProcessEnv;
  nowMs?: number;
  refresh?: (params: Parameters<typeof refreshInBackground>[0]) => void;
}> = {}): LocalCliUpdateFact | null {
  const processEnv = params.processEnv ?? process.env;
  const ring = params.releaseRing ?? 'stable';
  const nowMs = params.nowMs ?? Date.now();
  const happierHomeDir = resolveHappyHomeDirFromEnvironment(processEnv);
  const resolved = resolveExplicitOrInstalledLocalFirstPartyCommand({
    componentId: 'happier-cli',
    processEnv,
    envVarNames: DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES,
    releaseRing: ring,
  });
  const managed = resolved?.provenance === 'managed';
  const cache = readUpdateCache(resolveCliUpdateCachePath({
    happierHomeDir,
    channelLabel: resolvePublicReleaseRingLabelForId(ring),
  }));
  const installedVersion = managed
    ? readInstalledVersionMarkersSync(resolveFirstPartyInstallLayout({
        componentId: 'happier-cli',
        processEnv,
        releaseRing: ring,
      })).currentVersionId
    : null;
  const currentVersion = installedVersion ?? (typeof cache?.current === 'string' && cache.current.trim() ? cache.current.trim() : null);

  const checkedAt = typeof cache?.checkedAt === 'number' ? cache.checkedAt : 0;
  // Only the managed CLI can be updated here, so only its check is refreshed; the CLI's own
  // `HAPPIER_CLI_UPDATE_CHECK=0` switch turns the refresh off exactly as it does for the notice.
  const checksEnabled = String(processEnv.HAPPIER_CLI_UPDATE_CHECK ?? '1').trim() !== '0';
  if (resolved && managed && checksEnabled && (!checkedAt || nowMs - checkedAt > CLI_UPDATE_CHECK_INTERVAL_MS)) {
    (params.refresh ?? refreshInBackground)({ command: resolved.command, ring, happierHomeDir, processEnv, nowMs });
  }

  if (!currentVersion) return null;
  // The one ring-filtered reader (plan R13 S-1): another ring's version reads as unknown, and the
  // comparison is against the version actually installed, never the cached `updateAvailable`.
  const state = readCachedCliUpdateState({ happierHomeDir, publicReleaseRing: ring, currentVersion });
  return {
    currentVersion,
    latestVersion: state?.latestVersion ?? null,
    updateAvailable: state?.updateAvailable === true,
    managed,
    ...(!managed && resolved?.command ? { origin: resolved.command } : {}),
  };
}
