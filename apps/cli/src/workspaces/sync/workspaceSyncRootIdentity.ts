import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

/** Stable identity for the filesystem object currently occupying one canonical root. */
export async function computeWorkspaceSyncRootFingerprint(canonicalRoot: string): Promise<string> {
  const rootStat = await stat(canonicalRoot);
  const identity = `${String(rootStat.dev)}:${String(rootStat.ino)}:${String(rootStat.birthtimeMs)}`;
  return createHash('sha256')
    .update('workspace-root-v1\0')
    .update(process.platform)
    .update('\0')
    .update(canonicalRoot)
    .update('\0')
    .update(identity)
    .digest('hex');
}

/**
 * Stable identity for a canonical root that currently holds no filesystem
 * object. It never collides with a present root's fingerprint, so an approval
 * stamped against an absent destination cannot be replayed once something
 * occupies that path.
 */
export function computeWorkspaceSyncAbsentRootFingerprint(canonicalRoot: string): string {
  return createHash('sha256')
    .update('workspace-root-absent-v1\0')
    .update(process.platform)
    .update('\0')
    .update(canonicalRoot)
    .digest('hex');
}
