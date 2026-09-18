import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withConfinedWorkspaceSyncParent } from './workspaceSyncConfinedFileSystem';
import {
  runNativeConfinedWorkspaceSyncDelete,
  type RunNativeConfinedDeleteInput,
} from './workspaceSyncNativeConfinedFileSystem';

export type DeleteWorkspaceSyncConflictLoserAtRootInput = Readonly<{
  rootPath: string;
  relativePath: string;
  expectedKind: 'missing' | 'file' | 'directory' | 'symlink';
  expectedDigest?: string;
  /** Revalidates the settings-owned root fence at the final mutation boundary. */
  assertCurrentAuthority?: () => Promise<void>;
}>;

export type DeleteWorkspaceSyncConflictLoserAtRootDependencies = Readonly<{
  runNativeConfinedDelete?: (input: RunNativeConfinedDeleteInput) => Promise<void>;
}>;

function conflictError(code: 'conflict_changed' | 'conflict_resolution_unsupported', message: string): Error {
  return Object.assign(new Error(message), { code });
}

function conflictRecoveryError(cause: unknown, recoveryPath: string): Error {
  return Object.assign(
    new Error(`conflict loser could not be safely finalized; recovery material remains at ${recoveryPath}`),
    { code: 'conflict_changed', cause, recoveryPath },
  );
}

function kindOf(stats: Awaited<ReturnType<typeof lstat>>): DeleteWorkspaceSyncConflictLoserAtRootInput['expectedKind'] | 'other' {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

function hasSameObjectIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function sha1File(
  path: string,
  admitted: Awaited<ReturnType<typeof lstat>>,
): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP' || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw conflictError('conflict_changed', 'conflict loser changed before digest verification');
    }
    throw error;
  });
  try {
    const before = await handle.stat();
    if (!before.isFile() || !hasSameObjectIdentity(admitted, before)) {
      throw conflictError('conflict_changed', 'conflict loser changed before digest verification');
    }
    const hash = createHash('sha1');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      !hasSameObjectIdentity(before, after)
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
    ) {
      throw conflictError('conflict_changed', 'conflict loser changed during digest verification');
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export async function deleteWorkspaceSyncConflictLoserAtRoot(
  input: DeleteWorkspaceSyncConflictLoserAtRootInput,
  dependencies: DeleteWorkspaceSyncConflictLoserAtRootDependencies = {},
): Promise<void> {
  if (input.expectedKind === 'file' && input.expectedDigest === undefined) {
    throw conflictError('conflict_resolution_unsupported', 'file conflict deletion requires an expected digest');
  }
  if (input.expectedKind !== 'file' && input.expectedDigest !== undefined) {
    throw conflictError('conflict_resolution_unsupported', 'non-file conflict deletion does not accept a digest');
  }
  if (process.platform === 'win32' || process.platform === 'darwin') {
    await (dependencies.runNativeConfinedDelete ?? runNativeConfinedWorkspaceSyncDelete)({
      rootPath: input.rootPath,
      relativePath: input.relativePath,
      expectedKind: input.expectedKind,
      ...(input.expectedDigest === undefined ? {} : { expectedDigest: input.expectedDigest }),
      ...(input.assertCurrentAuthority ? { assertCurrentAuthority: input.assertCurrentAuthority } : {}),
    }).catch((error: unknown) => {
      if ((error as { code?: unknown }).code === 'workspace_root_unsafe') {
        throw conflictError('conflict_resolution_unsupported', (error as Error).message);
      }
      throw error;
    });
    return;
  }
  await withConfinedWorkspaceSyncParent({
    rootPath: input.rootPath,
    relativePath: input.relativePath,
    run: async ({ parentHandlePath, finalName }) => {
  const candidate = resolve(parentHandlePath, finalName);
  const stats = await lstat(candidate).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!stats) {
    if (input.expectedKind === 'missing') return;
    throw conflictError('conflict_changed', 'conflict loser is now missing');
  }
  const actualKind = kindOf(stats);
  if (actualKind !== input.expectedKind) throw conflictError('conflict_changed', 'conflict loser type changed');
  if (input.expectedDigest !== undefined) {
    if (actualKind !== 'file') throw conflictError('conflict_changed', 'digest precondition is unavailable for this conflict type');
    if (await sha1File(candidate, stats) !== input.expectedDigest) throw conflictError('conflict_changed', 'conflict loser digest changed');
  }
  await input.assertCurrentAuthority?.();
  const quarantineName = `.happier-delete-${randomUUID()}`;
  const quarantine = resolve(parentHandlePath, quarantineName);
  const physicalRecoveryParent = await realpath(parentHandlePath);
  let recoveryPath = resolve(physicalRecoveryParent, quarantineName);
  await rename(candidate, quarantine).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw conflictError('conflict_changed', 'conflict loser changed before deletion');
    throw error;
  });
  try {
    // Refresh the reported path after the rename in case an admitted ancestor
    // was moved while its retained directory handle remained authoritative.
    recoveryPath = resolve(await realpath(parentHandlePath), quarantineName);
    const quarantinedStats = await lstat(quarantine);
    const quarantinedKind = kindOf(quarantinedStats);
    if (quarantinedKind !== actualKind) throw conflictError('conflict_changed', 'conflict loser changed before deletion');
    if (!hasSameObjectIdentity(stats, quarantinedStats)) {
      throw conflictError('conflict_changed', 'conflict loser changed before deletion');
    }
    if (input.expectedDigest !== undefined && await sha1File(quarantine, quarantinedStats) !== input.expectedDigest) {
      throw conflictError('conflict_changed', 'conflict loser changed before deletion');
    }
    await rm(quarantine, { recursive: actualKind === 'directory', force: false });
  } catch (error) {
    // A replacement can legitimately appear at the public pathname after the
    // admitted loser has been quarantined. Never rename back across that name:
    // portable rename would overwrite the replacement atomically. Preserve the
    // isolated bytes and expose their confined recovery path instead.
    throw conflictRecoveryError(error, recoveryPath);
  }
    },
  }).catch((error: unknown) => {
    if ((error as { code?: unknown }).code === 'workspace_root_unsafe') {
      throw conflictError('conflict_resolution_unsupported', (error as Error).message);
    }
    throw error;
  });
}
