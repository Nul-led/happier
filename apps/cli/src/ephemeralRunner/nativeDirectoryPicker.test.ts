import { describe, expect, it, vi } from 'vitest';

import { selectDirectoryWithNativeDialog } from './nativeDirectoryPicker';
import { resolveEphemeralRunnerDirectoryChoicePresentation } from './endpointTerminalUi';

const DIALOG_TITLE = resolveEphemeralRunnerDirectoryChoicePresentation().dialogTitle;

describe('ephemeral Runner native directory picker', () => {
  it('uses the platform folder dialog and returns its exact selected path', async () => {
    const run = vi.fn(async () => ({ status: 'completed' as const, exitCode: 0, stdout: '/Users/alice/ Project \n' }));

    await expect(selectDirectoryWithNativeDialog({
      platform: 'darwin',
      graphicalSession: true,
      signal: new AbortController().signal,
      dialogTitle: DIALOG_TITLE,
      run,
    })).resolves.toEqual({ status: 'selected', directory: '/Users/alice/ Project ' });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ executable: '/usr/bin/osascript' }), expect.any(AbortSignal));
  });

  it('distinguishes user cancellation from an unavailable host dialog', async () => {
    const cancelled = vi.fn(async () => ({ status: 'completed' as const, exitCode: 1, stdout: '' }));
    await expect(selectDirectoryWithNativeDialog({
      platform: 'win32',
      graphicalSession: true,
      signal: new AbortController().signal,
      dialogTitle: DIALOG_TITLE,
      run: cancelled,
    })).resolves.toEqual({ status: 'cancelled' });

    await expect(selectDirectoryWithNativeDialog({
      platform: 'linux',
      graphicalSession: false,
      signal: new AbortController().signal,
      dialogTitle: DIALOG_TITLE,
      run: vi.fn(),
    })).resolves.toEqual({ status: 'unavailable' });
  });

  it('falls through between supported Linux desktop dialog owners without inventing a file browser', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ status: 'unavailable' as const })
      .mockResolvedValueOnce({ status: 'completed' as const, exitCode: 0, stdout: '/home/alice/work\n' });

    await expect(selectDirectoryWithNativeDialog({
      platform: 'linux',
      graphicalSession: true,
      signal: new AbortController().signal,
      dialogTitle: DIALOG_TITLE,
      run,
    })).resolves.toEqual({ status: 'selected', directory: '/home/alice/work' });

    expect(run.mock.calls.map(([spec]) => spec.executable)).toEqual(['zenity', 'kdialog']);
  });

  it('titles every platform dialog from the caller-supplied endpoint copy', async () => {
    // The dialog title is endpoint chrome. Repeating it per platform inside this
    // adapter made the OS dialog a fourth copy owner that no presentation owner
    // could reach.
    const dialogTitle = 'Choisir le dossier de travail de Happier Runner';
    const captured: string[] = [];
    const run = vi.fn(async (spec: { executable: string; args: readonly string[] }) => {
      captured.push(spec.args.join(' '));
      return { status: 'completed' as const, exitCode: 1, stdout: '' };
    });

    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      await selectDirectoryWithNativeDialog({
        platform,
        graphicalSession: true,
        signal: new AbortController().signal,
        run,
        dialogTitle,
      });
    }

    expect(captured).toHaveLength(3);
    for (const args of captured) expect(args).toContain(dialogTitle);
  });
});
