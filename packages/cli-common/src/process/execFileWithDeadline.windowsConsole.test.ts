import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
// Only OS execution is replaced; the command deadline and completion owner stays real.
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(), execFile: execFileMock,
}));
import { execFileWithDeadline } from './execFileWithDeadline.js';

describe('deadline command console policy', () => {
  it('defaults captured commands to hidden while preserving explicit visible launches and output', async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      const child = Object.assign(new EventEmitter(), { stdout: null, stderr: null, exitCode: null, signalCode: null });
      queueMicrotask(() => { callback(null, 'ready', ''); child.emit('close', 0, null); });
      return child;
    });
    for (const windowsHide of [undefined, false]) {
      expect(await execFileWithDeadline('happier-server.exe', ['--attest-personal-home-readiness'], { windowsHide })).toEqual({ stdout: 'ready', stderr: '' });
      expect(execFileMock.mock.lastCall?.[2].windowsHide).toBe(windowsHide !== false);
    }
  });
});
