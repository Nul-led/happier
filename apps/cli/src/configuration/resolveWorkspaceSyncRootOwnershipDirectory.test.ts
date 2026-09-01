import { describe, expect, it } from 'vitest';

import { resolveWorkspaceSyncRootOwnershipDirectory } from './resolveWorkspaceSyncRootOwnershipDirectory';

describe('resolveWorkspaceSyncRootOwnershipDirectory', () => {
  it('uses the OS-user home rather than an installation-specific Happier home', () => {
    expect(resolveWorkspaceSyncRootOwnershipDirectory({
      HOME: '/Users/alice',
      HAPPIER_HOME_DIR: '/tmp/isolated-happier-installation',
    }, 'darwin')).toBe('/Users/alice/.happier/runtime/workspace-sync-root-ownership');
  });

  it('uses the canonical Windows user-home environment shape', () => {
    expect(resolveWorkspaceSyncRootOwnershipDirectory({
      USERPROFILE: 'C:\\Users\\Alice',
      HAPPIER_HOME_DIR: 'D:\\Happier-Second-Install',
    }, 'win32')).toBe('C:\\Users\\Alice\\.happier\\runtime\\workspace-sync-root-ownership');
  });
});
