import { execFileWithDeadline } from '@happier-dev/cli-common/process';

export async function openComputerPrivacySettings(permission: 'capture' | 'input', signal?: AbortSignal) {
  if (process.platform !== 'darwin') return { status: 'failed' as const, code: 'platform_unsupported' };
  try {
    const pane = permission === 'capture' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility';
    await execFileWithDeadline('/usr/bin/open', [`x-apple.systempreferences:com.apple.preference.security?${pane}`],
      signal ? { signal } : {});
    return { status: 'dispatched' as const };
  } catch {
    return { status: 'failed' as const, code: signal?.aborted ? 'cancelled' : 'settings_dispatch_failed' };
  }
}
