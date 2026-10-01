import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const executable = vi.hoisted(() => ({ socketPath: '', spawn: vi.fn() }));

// Only installed executable probes and foreground process creation are OS substitutes.
// Admission, exact-socket transport, attachment planning and pane focus stay real.
vi.mock('node:child_process', async (importOriginal) => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return {
    ...await importOriginal<typeof import('node:child_process')>(),
    execFile: Object.assign(vi.fn((_binary: string, args: readonly string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      setImmediate(() => {
        child.emit('exit', 0, null);
        callback(null, args[0] === '--version' ? 'herdr 0.9.2'
          : JSON.stringify({ sessions: [{ name: 'default', socket_path: executable.socketPath, running: true }] }), '');
        child.emit('close', 0, null);
      });
      return child;
    }), {
      [Symbol.for('nodejs.util.promisify.custom')]: async () => ({
        stdout: JSON.stringify({ sessions: [{ name: 'default', socket_path: executable.socketPath, running: true }] }),
        stderr: '',
      }),
    }),
    spawn: executable.spawn,
  };
});

import { EventEmitter } from 'node:events';
import { handleHerdrCliCommand } from '@/cli/commands/herdr';
import { runHerdrAttach } from '@/terminal/attachment/herdrAttach';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { withHerdrApi } from './herdrApi.testkit';

const envScope = createEnvKeyScope(['HERDR_ENV', 'HERDR_SOCKET_PATH', 'HERDR_PANE_ID', 'HERDR_BIN_PATH']);
beforeEach(() => {
  envScope.patch({ HERDR_ENV: undefined, HERDR_SOCKET_PATH: undefined, HERDR_PANE_ID: undefined, HERDR_BIN_PATH: undefined });
  executable.spawn.mockReset();
  executable.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  });
});
afterEach(() => envScope.restore());

describe('Herdr CLI entrypoint admission', () => {
  it.skipIf(process.platform === 'win32').each(['command', 'foreground_attach', 'inside_focus'] as const)(
    'refuses an older exact server before %s despite a supported installed executable', async (entrypoint) => {
      await withHerdrApi(async (api) => {
        executable.socketPath = api.socketPath;
        api.setServerVersion('0.9.1');
        api.panes.add('managed');
        if (entrypoint === 'inside_focus') envScope.patch({ HERDR_SOCKET_PATH: api.socketPath, HERDR_PANE_ID: 'managed' });
        const operation = entrypoint === 'command'
          ? handleHerdrCliCommand({ args: ['herdr'], rawArgv: [], terminalRuntime: null })
          : runHerdrAttach({ terminal: { mode: 'herdr', herdr: { sessionName: 'work', socketPath: api.socketPath, terminalId: 'terminal_1' } } });
        await expect(operation).rejects.toMatchObject({ code: 'unsupported_server_version' });
        expect(executable.spawn).not.toHaveBeenCalled();
        expect(api.requests.some((request) => request.method === 'pane.focus' || request.method === 'layout.apply')).toBe(false);
        expect([...api.panes]).toEqual(['managed']);
      });
    },
  );

  it.skipIf(process.platform === 'win32').each(['command', 'foreground_attach', 'inside_focus'] as const)(
    'admits the stable exact server for %s without creating another pane', async (entrypoint) => {
      await withHerdrApi(async (api) => {
        executable.socketPath = api.socketPath;
        api.panes.add('managed');
        if (entrypoint === 'inside_focus') envScope.patch({ HERDR_SOCKET_PATH: api.socketPath, HERDR_PANE_ID: 'managed' });
        if (entrypoint === 'command') await handleHerdrCliCommand({ args: ['herdr'], rawArgv: [], terminalRuntime: null });
        else await expect(runHerdrAttach({ terminal: { mode: 'herdr', herdr: {
          sessionName: 'work', socketPath: api.socketPath, terminalId: 'terminal_1',
        } } })).resolves.toBe(0);
        expect(api.requests.some((request) => request.method === 'session.snapshot')).toBe(true);
        expect(api.requests.some((request) => request.method === 'layout.apply')).toBe(false);
        if (entrypoint === 'inside_focus') {
          expect(executable.spawn).not.toHaveBeenCalled();
          expect(api.requests.some((request) => request.method === 'pane.focus')).toBe(true);
        } else expect(executable.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array),
          expect.objectContaining({ env: expect.objectContaining({ HERDR_SOCKET_PATH: api.socketPath }) }));
      });
    },
  );
});
