import { posix, win32 } from 'node:path';

import { resolveHomeDirFromEnvironment } from '@/utils/path/expandHomeDirPath';

/**
 * Workspace roots can be shared by independent Happier installations owned by
 * the same OS user. Keep their mutation inventory outside any installation's
 * configurable data directory so every daemon arbitrates through one path.
 */
export function resolveWorkspaceSyncRootOwnershipDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const path = platform === 'win32' ? win32 : posix;
  return path.join(
    resolveHomeDirFromEnvironment(env, platform),
    '.happier',
    'runtime',
    'workspace-sync-root-ownership',
  );
}
