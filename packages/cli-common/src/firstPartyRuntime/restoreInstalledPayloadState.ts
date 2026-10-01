import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import type { FirstPartyComponentId } from './componentCatalog.js';
import { resolveDefaultManagedReleaseChannelStatePath, resolveDefaultReleaseChannelAfterInstall } from './defaultReleaseChannelState.js';
import { resolveFirstPartyInstallLayout, type FirstPartyInstallLayout } from './installLayout.js';
import { joinPathForPathShape } from '../path/pathShape.js';
import { resolveDesiredShimTargets } from './resolveDesiredShimTargets.js';
import { syncInstalledPayloadPointer } from './syncInstalledPayloadPointer.js';
import { readInstalledVersionMarkers, writeInstalledVersionMarker } from './versionMarkers.js';

export type InstalledPayloadStateSnapshot = Readonly<{
  currentVersionId: string | null;
  previousVersionId: string | null;
  currentPathWasPresent?: boolean;
  unversionedCurrentBackupPath?: string | null;
  unversionedCurrentWasMoved?: boolean;
}>;

export class FirstPartyPayloadStateRestoreIncompleteError extends Error {
  readonly code = 'FIRST_PARTY_PAYLOAD_STATE_RESTORE_INCOMPLETE';
  readonly stateRestored = false;
  readonly mutationError: unknown;
  readonly restorationErrors: readonly unknown[];

  constructor(params: Readonly<{
    mutationError: unknown;
    restorationErrors: readonly unknown[];
  }>) {
    super('First-party payload mutation failed and the prior installed state could not be completely restored.', {
      cause: params.mutationError,
    });
    this.name = 'FirstPartyPayloadStateRestoreIncompleteError';
    this.mutationError = params.mutationError;
    this.restorationErrors = params.restorationErrors;
  }
}

async function pathExists(path: string): Promise<boolean> {
  return await lstat(path).then(() => true).catch(() => false);
}

async function restoreVersionPointer(params: Readonly<{
  layout: FirstPartyInstallLayout;
  pointerPath: string;
  versionId: string | null;
}>): Promise<void> {
  if (!params.versionId) {
    await rm(params.pointerPath, { recursive: true, force: true });
    return;
  }
  await syncInstalledPayloadPointer({
    layout: params.layout,
    pointerPath: params.pointerPath,
    versionPath: joinPathForPathShape(params.layout.versionsDir, params.versionId),
  });
}

export async function restoreInstalledPayloadState(params: Readonly<{
  layout: FirstPartyInstallLayout;
  snapshot: InstalledPayloadStateSnapshot;
}>): Promise<void> {
  const restorationErrors: unknown[] = [];
  const attempt = async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      restorationErrors.push(error);
    }
  };

  if (params.snapshot.unversionedCurrentWasMoved) {
    await attempt(async () => {
      const backupPath = params.snapshot.unversionedCurrentBackupPath;
      if (!backupPath || !(await pathExists(backupPath))) {
        throw new Error('The unversioned current payload backup is missing.');
      }
      await rm(params.layout.currentPath, { recursive: true, force: true });
      await rename(backupPath, params.layout.currentPath);
    });
  } else if (params.snapshot.currentVersionId) {
    await attempt(async () => await restoreVersionPointer({
      layout: params.layout,
      pointerPath: params.layout.currentPath,
      versionId: params.snapshot.currentVersionId,
    }));
  } else if (params.snapshot.currentPathWasPresent !== true) {
    await attempt(async () => await rm(params.layout.currentPath, {
      recursive: true,
      force: true,
    }));
  }

  await attempt(async () => await restoreVersionPointer({
    layout: params.layout,
    pointerPath: params.layout.previousPath,
    versionId: params.snapshot.previousVersionId,
  }));
  await attempt(async () => await writeInstalledVersionMarker({
    layout: params.layout,
    marker: 'current',
    versionId: params.snapshot.currentVersionId,
  }));
  await attempt(async () => await writeInstalledVersionMarker({
    layout: params.layout,
    marker: 'previous',
    versionId: params.snapshot.previousVersionId,
  }));

  if (restorationErrors.length > 0) {
    throw new AggregateError(
      restorationErrors,
      'The prior first-party payload state could not be completely restored.',
    );
  }
}

export async function restoreInstalledPayloadStateAfterFailure(params: Readonly<{
  layout: FirstPartyInstallLayout;
  snapshot: InstalledPayloadStateSnapshot;
  mutationError: unknown;
}>): Promise<never> {
  try {
    await restoreInstalledPayloadState({
      layout: params.layout,
      snapshot: params.snapshot,
    });
  } catch (restorationError) {
    const restorationErrors = restorationError instanceof AggregateError
      ? restorationError.errors
      : [restorationError];
    throw new FirstPartyPayloadStateRestoreIncompleteError({
      mutationError: params.mutationError,
      restorationErrors,
    });
  }
  throw params.mutationError;
}

/**
 * Everything an update activation may change, captured before it runs (plan R13 f): the
 * `current`/`previous` markers (which also name the pointer targets, restored by
 * `restoreInstalledPayloadState` above), the command shims the activation will rewrite, and the
 * default-channel record.
 *
 * The shims are moved aside rather than copied. Moving is what a Windows shim needs — the service
 * runs that `.exe` (a hard link or a copy of the payload binary), which cannot be deleted while it
 * runs but can be renamed — and on POSIX a moved symlink restores exactly as it was. The set-aside
 * directory belongs to this one transaction (`<home>/bin/.update-rollback/<uuid>`): nothing else
 * writes or removes it, so another channel's update — or a later one after a crash — can never
 * touch this transaction's recovery launchers.
 */
export type ActivationStateSnapshot = Readonly<{
  layout: FirstPartyInstallLayout;
  payload: InstalledPayloadStateSnapshot;
  setAsideDir: string;
  shims: ReadonlyArray<Readonly<{ shimPath: string; setAsidePath: string | null }>>;
  defaultReleaseChannelStatePath: string;
  defaultReleaseChannelState: string | null;
}>;

function resolveShimSetAsideDir(layout: FirstPartyInstallLayout, transactionId: string): string {
  return joinPathForPathShape(layout.shimDir, '.update-rollback', transactionId);
}

/**
 * Capture before activating. The caller holds the install root's lock and the home-wide activation
 * lock. If moving any shim aside fails, every shim already moved is put back before the error is
 * rethrown, so a failed capture leaves the launchers exactly as they were.
 */
export async function captureActivationStateForUpdate(params: Readonly<{
  componentId: FirstPartyComponentId;
  channel: PublicReleaseRingId;
  processEnv?: NodeJS.ProcessEnv;
}>): Promise<ActivationStateSnapshot> {
  const layout = resolveFirstPartyInstallLayout({ componentId: params.componentId, releaseRing: params.channel, processEnv: params.processEnv });
  const { currentVersionId, previousVersionId } = await readInstalledVersionMarkers(layout);
  const defaultReleaseChannelStatePath = resolveDefaultManagedReleaseChannelStatePath({ processEnv: params.processEnv });
  const defaultReleaseChannelState = await readFile(defaultReleaseChannelStatePath, 'utf8').catch(() => null);

  // The same resolution the activation performs, so exactly the shims it rewrites are captured.
  const targets = await resolveDesiredShimTargets({
    componentId: params.componentId,
    channel: params.channel,
    processEnv: params.processEnv,
    defaultReleaseChannelOverride: await resolveDefaultReleaseChannelAfterInstall({
      componentId: params.componentId,
      installedChannel: params.channel,
      selectAsDefault: false,
      processEnv: params.processEnv,
    }),
  });
  const setAsideDir = resolveShimSetAsideDir(layout, randomUUID());

  const shims: Array<Readonly<{ shimPath: string; setAsidePath: string | null }>> = [];
  try {
    for (const { shimPath } of targets) {
      if (!(await pathExists(shimPath))) {
        shims.push({ shimPath, setAsidePath: null });
        continue;
      }
      await mkdir(setAsideDir, { recursive: true });
      const setAsidePath = joinPathForPathShape(setAsideDir, basename(shimPath));
      await rename(shimPath, setAsidePath);
      shims.push({ shimPath, setAsidePath });
    }
  } catch (error) {
    const putBackFailures: unknown[] = [];
    for (const { shimPath, setAsidePath } of shims) {
      if (!setAsidePath) continue;
      await rename(setAsidePath, shimPath).catch((putBackError: unknown) => { putBackFailures.push(putBackError); });
    }
    if (putBackFailures.length === 0) {
      await rm(setAsideDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    throw new AggregateError(
      [error, ...putBackFailures],
      `Could not set the Happier commands aside, nor put them all back; the rest are in ${setAsideDir}.`,
    );
  }

  return {
    layout,
    payload: { currentVersionId, previousVersionId, currentPathWasPresent: currentVersionId !== null },
    setAsideDir,
    shims,
    defaultReleaseChannelStatePath,
    defaultReleaseChannelState,
  };
}

/**
 * Put back everything `captureActivationStateForUpdate` recorded. Every piece is attempted even
 * when an earlier one fails; the failures are thrown together at the end, so a caller never reports
 * a restore that did not complete.
 */
export async function restoreActivationStateAfterUpdate(snapshot: ActivationStateSnapshot): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      if (error instanceof AggregateError) failures.push(...error.errors);
      else failures.push(error);
    }
  };

  await attempt(async () => await restoreInstalledPayloadState({ layout: snapshot.layout, snapshot: snapshot.payload }));

  for (const { shimPath, setAsidePath } of snapshot.shims) {
    await attempt(async () => {
      if (await pathExists(shimPath)) {
        // The activated shim may be running (the new daemon); move it aside too instead of deleting.
        await mkdir(snapshot.setAsideDir, { recursive: true });
        await rename(shimPath, joinPathForPathShape(snapshot.setAsideDir, `${basename(shimPath)}.activated-${randomUUID()}`));
      }
      if (setAsidePath) {
        await mkdir(dirname(shimPath), { recursive: true });
        await rename(setAsidePath, shimPath);
      }
    });
  }

  await attempt(async () => {
    if (snapshot.defaultReleaseChannelState === null) {
      await rm(snapshot.defaultReleaseChannelStatePath, { force: true });
      return;
    }
    await writeFile(snapshot.defaultReleaseChannelStatePath, snapshot.defaultReleaseChannelState, 'utf8');
  });

  if (failures.length > 0) {
    throw new AggregateError(failures, 'The previous Happier CLI install could not be completely restored.');
  }
}

/**
 * Commit, or after a completed restore: this transaction's set-aside launchers are no longer
 * needed. Best-effort — a Windows `.exe` still running stays until it exits; nothing else is touched.
 */
export async function discardActivationStateSnapshot(snapshot: ActivationStateSnapshot): Promise<void> {
  await rm(snapshot.setAsideDir, { recursive: true, force: true }).catch(() => undefined);
}
