import { chmod } from 'node:fs/promises';

import {
  createWindowsProtectedAclBoundary,
  type WindowsProtectedAclBoundary,
  type WindowsProtectedPathKind,
} from '../../fs/windowsProtectedAcl.js';

export type PersonalHomePathProtection = (
  path: string,
  kind: WindowsProtectedPathKind,
) => Promise<void>;

export function createPersonalHomePathProtection(params: Readonly<{
  platform?: NodeJS.Platform;
  windowsAcl?: WindowsProtectedAclBoundary;
}> = {}): PersonalHomePathProtection {
  const platform = params.platform ?? process.platform;
  if (platform === 'win32') {
    const windowsAcl = params.windowsAcl ?? createWindowsProtectedAclBoundary();
    return async (path, kind) => windowsAcl.applyAndVerify({ path, kind });
  }
  return async (path, kind) => chmod(path, kind === 'directory' ? 0o700 : 0o600);
}
