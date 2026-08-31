import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkspaceSyncConflictListV1 } from './workspaceSyncTypes';

export const MAX_WORKSPACE_SYNC_CONFLICTS = 100;
export function normalizeWorkspaceSyncConflictList(value: unknown, relationshipId: string): WorkspaceSyncConflictListV1 {
  if (!value || typeof value !== 'object') throw new Error('Invalid workspace sync conflict list');
  const input = value as Record<string, unknown>;
  if (input.relationshipId !== relationshipId || !Array.isArray(input.conflicts)) throw new Error('Invalid workspace sync conflict list');
  const totalCount = Number(input.totalCount); const conflicts = input.conflicts.slice(0, MAX_WORKSPACE_SYNC_CONFLICTS) as WorkspaceSyncConflictListV1['conflicts'];
  if (!Number.isSafeInteger(totalCount) || totalCount < conflicts.length) throw new Error('Invalid workspace sync conflict count');
  return { relationshipId, totalCount, shownCount: conflicts.length, truncatedCount: Math.max(0, totalCount - conflicts.length), conflicts };
}

export type DeleteWorkspaceSyncConflictLoserAtRootInput = Readonly<{
  rootPath: string;
  relativePath: string;
  expectedKind: 'missing' | 'file' | 'directory' | 'symlink';
  expectedDigest?: string;
  /** Revalidates the settings-owned root fence at the final mutation boundary. */
  assertCurrentAuthority?: () => Promise<void>;
}>;

function conflictError(code: 'conflict_changed' | 'conflict_resolution_unsupported', message: string): Error {
  return Object.assign(new Error(message), { code });
}

function kindOf(stats: Awaited<ReturnType<typeof lstat>>): DeleteWorkspaceSyncConflictLoserAtRootInput['expectedKind'] | 'other' {
  if (stats.isSymbolicLink()) return 'symlink';
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

async function sha1File(path: string): Promise<string> {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function deleteWorkspaceSyncConflictLoserAtRoot(
  input: DeleteWorkspaceSyncConflictLoserAtRootInput,
): Promise<void> {
  if (!input.rootPath.trim() || !input.relativePath.trim() || isAbsolute(input.relativePath)) {
    throw conflictError('conflict_resolution_unsupported', 'conflict path must be root-relative');
  }
  const canonicalRoot = await realpath(resolve(input.rootPath));
  const candidate = resolve(canonicalRoot, input.relativePath);
  const rest = relative(canonicalRoot, candidate);
  if (rest === '' || rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest)) {
    throw conflictError('conflict_resolution_unsupported', 'conflict path escapes or identifies the workspace root');
  }
  // Resolve the parent, not the candidate: deleting a losing symlink must not
  // follow it, while a replaced parent must still fail confinement.
  const canonicalParent = await realpath(resolve(candidate, '..')).catch(() => null);
  if (!canonicalParent) throw conflictError('conflict_changed', 'conflict parent changed');
  const parentRest = relative(canonicalRoot, canonicalParent);
  if (parentRest === '..' || parentRest.startsWith(`..${sep}`) || isAbsolute(parentRest)) {
    throw conflictError('conflict_resolution_unsupported', 'conflict parent escapes the workspace root');
  }
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
    if (await sha1File(candidate) !== input.expectedDigest) throw conflictError('conflict_changed', 'conflict loser digest changed');
  }
  await input.assertCurrentAuthority?.();
  await rm(candidate, { recursive: actualKind === 'directory', force: false });
}
