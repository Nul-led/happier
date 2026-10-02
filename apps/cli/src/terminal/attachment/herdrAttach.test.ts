import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withHerdrApi } from '@/integrations/herdr/herdrApi.testkit';
import { createEnvKeyScope } from '@/testkit/env/envScope';

const boundary = vi.hoisted(() => ({ spawn: vi.fn() }));

// Only executable discovery and foreground process creation are replaced; socket/version logic is real.
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: async () => ({ stdout: 'herdr 0.9.2', stderr: '' }),
  }),
  spawn: boundary.spawn,
}));

import { runHerdrAttach } from './herdrAttach';

const envScope = createEnvKeyScope(['HERDR_PANE_ID', 'HERDR_SOCKET_PATH']);

beforeEach(() => {
  envScope.patch({ HERDR_PANE_ID: undefined, HERDR_SOCKET_PATH: undefined });
  boundary.spawn.mockReset();
  boundary.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  });
});

afterEach(() => envScope.restore());

describe('runHerdrAttach server admission', () => {
  it('refuses an older running server even with a supported installed binary', async () => {
    await withHerdrApi(async (api) => {
      await expect(runHerdrAttach({ terminal: {
        mode: 'herdr', herdr: { sessionName: 'work', socketPath: api.socketPath, terminalId: 'terminal_1' },
      } })).rejects.toMatchObject({ code: 'unsupported_server_version' });
      expect(boundary.spawn).not.toHaveBeenCalled();
    }, { serverVersion: '0.9.1' });
  });

  it('attaches through the qualified exact socket without creating a pane', async () => {
    await withHerdrApi(async (api) => {
      await expect(runHerdrAttach({ terminal: {
        mode: 'herdr', herdr: { sessionName: 'work', socketPath: api.socketPath, terminalId: 'terminal_1' },
      } })).resolves.toBe(0);
      expect(api.requests.map((request) => request.method)).toEqual(['session.snapshot']);
      expect(boundary.spawn).toHaveBeenCalledWith(expect.any(String),
        ['--session', 'work', 'terminal', 'attach', 'terminal_1'],
        expect.objectContaining({ env: expect.objectContaining({ HERDR_SOCKET_PATH: api.socketPath }) }));
    });
  });

  it('focuses the existing terminal inside the same qualified server', async () => {
    await withHerdrApi(async (api) => {
      api.panes.add('managed');
      envScope.patch({ HERDR_PANE_ID: 'managed', HERDR_SOCKET_PATH: api.socketPath });
      await expect(runHerdrAttach({ terminal: {
        mode: 'herdr', herdr: { sessionName: 'work', socketPath: api.socketPath, terminalId: 'terminal_1' },
      } })).resolves.toBe(0);
      expect(api.requests.map((request) => request.method)).toEqual(['session.snapshot', 'pane.list', 'pane.focus']);
      expect(boundary.spawn).not.toHaveBeenCalled();
    });
  });
});
