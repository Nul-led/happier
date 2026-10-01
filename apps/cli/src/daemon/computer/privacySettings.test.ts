import { afterEach, expect, it, vi } from 'vitest';
import { execFileWithDeadline } from '@happier-dev/cli-common/process';
import { openComputerPrivacySettings } from './privacySettings';

// OS process launch is the genuine boundary; pane selection and result handling stay real.
vi.mock('@happier-dev/cli-common/process', () => ({ execFileWithDeadline: vi.fn(async () => ({ stdout: '', stderr: '' })) }));
afterEach(() => vi.restoreAllMocks());

it('dispatches both privacy panes on the daemon Mac, even without a terminal', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  expect(await openComputerPrivacySettings('capture')).toEqual({ status: 'dispatched' });
  expect(execFileWithDeadline).toHaveBeenLastCalledWith('/usr/bin/open',
    ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'], {});
  expect(await openComputerPrivacySettings('input')).toEqual({ status: 'dispatched' });
  expect(execFileWithDeadline).toHaveBeenLastCalledWith('/usr/bin/open',
    ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], {});
});

it('does not claim dispatch on an unsupported host or failed OS launch', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
  expect(await openComputerPrivacySettings('capture')).toEqual({ status: 'failed', code: 'platform_unsupported' });
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  vi.mocked(execFileWithDeadline).mockRejectedValueOnce(new Error('OS refused'));
  expect(await openComputerPrivacySettings('input')).toEqual({ status: 'failed', code: 'settings_dispatch_failed' });
});
