import { describe, expect, it, vi } from 'vitest';

import { detectDevinCliAuthStatus } from './status.js';

describe('detectDevinCliAuthStatus', () => {
  it('recognizes authenticated Devin output without exposing it', async () => {
    const runCommand = vi.fn(async () => ({
      ok: true,
      stdout: 'Authenticated',
      stderr: '',
      exitCode: 0,
    }));

    await expect(detectDevinCliAuthStatus({ runCommand })).resolves.toEqual({
      state: 'logged_in', method: 'oauth_cli', source: 'command',
    });
    expect(runCommand).toHaveBeenCalledWith(['auth', 'status'], { timeoutMs: 2_000 });
  });

  it('recognizes Devin 3000.10 logged-out output even though the command exits successfully', async () => {
    await expect(detectDevinCliAuthStatus({
      runCommand: async () => ({
        ok: true,
        stdout: 'Not logged in.\n  Credentials path: /private/credentials.toml\nRun `devin auth login` to authenticate.\n',
        stderr: '',
        exitCode: 0,
      }),
    })).resolves.toEqual({
      state: 'logged_out', reason: 'missing_credentials', source: 'command',
    });
  });

  it('distinguishes a failed or crashing probe from a logged-out status', async () => {
    await expect(detectDevinCliAuthStatus({
      runCommand: async () => ({ ok: false, stdout: '', stderr: 'panic', exitCode: 101 }),
    })).resolves.toEqual({
      state: 'unknown', reason: 'probe_failed', source: 'command',
    });
  });
});
