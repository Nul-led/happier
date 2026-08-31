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
