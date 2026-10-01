import { access, rmdir, unlink } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const inventory = vi.hoisted(() => ({ socketPath: '' }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: async () => ({
      stdout: JSON.stringify({ sessions: [{ name: 'work', socket_path: inventory.socketPath, running: true }] }),
      stderr: '',
    }),
  }),
}));

import { isTerminalHostStartupError } from '@/integrations/terminal/host/errors';

import { createHerdrTerminalHostAdapter } from './adapter';
import { withHerdrApi } from './herdrApi.testkit';

const launch = { sessionName: 'work', workingDirectory: tmpdir(), spawnArgv: [process.execPath, '--version'], spawnEnv: {}, isolatedEnv: true };
const adapterFor = (socketPath: string) => {
  inventory.socketPath = socketPath;
  return createHerdrTerminalHostAdapter({ binary: 'herdr', sessionName: 'work', actionTimeoutMs: 100, startupTimeoutMs: 100 });
};

function readSpecPath(requests: readonly Readonly<{ method: string; params: Record<string, unknown> }>[]): string {
  const layout = requests.find((request) => request.method === 'layout.apply');
  const root = layout?.params.root as { command?: string[] } | undefined;
  return root?.command?.[2] ?? '';
}

async function discardSpec(specPath: string): Promise<void> {
  if (!specPath) return;
  await unlink(specPath).catch(() => {});
  await rmdir(dirname(specPath)).catch(() => {});
}

describe('Herdr terminal host creation', () => {
  it.skipIf(process.platform === 'win32')('preserves stopped disposition and both causes when launch handoff removal fails', async () => {
    await withHerdrApi(async (api) => {
      api.faults.set('pane.get', 'error');
      api.beforeResponse.set('pane.get', () => chmodSync(dirname(readSpecPath(api.requests)), 0o500));
      try {
        const error = await adapterFor(api.socketPath).createOrAttachHost(launch).catch((failure: unknown) => failure);
        expect(error).toMatchObject({
          launchDisposition: 'stopped', cleanupIncomplete: true,
          errors: [expect.objectContaining({ code: 'pane.get_failed' }), expect.objectContaining({ code: 'EACCES' })],
        });
        expect([...api.panes]).toEqual([]);
        await expect(access(readSpecPath(api.requests))).resolves.toBeUndefined();
      } finally {
        const specPath = readSpecPath(api.requests);
        if (specPath) chmodSync(dirname(specPath), 0o700);
        await discardSpec(specPath);
      }
    });
  });

  it('binds the attachment to the requested named Herdr session', async () => {
    await withHerdrApi(async (api) => {
      try {
        await expect(adapterFor(api.socketPath).createOrAttachHost(launch)).resolves.toMatchObject({
          kind: 'herdr', sessionName: 'work', socketPath: api.socketPath, terminalId: 'terminal_1',
        });
      } finally {
        await discardSpec(readSpecPath(api.requests));
      }
    });
  });

  it('keeps the requested server namespace separate from each pane display label', async () => {
    await withHerdrApi(async (api) => {
      try {
        const adapter = adapterFor(api.socketPath);
        for (const label of ['happier-claude-first', 'happier-codex-second']) {
          const request = { ...launch, label };
          await expect(adapter.createOrAttachHost(request)).resolves.toMatchObject({
            kind: 'herdr', sessionName: 'work', socketPath: api.socketPath,
          });
          expect(api.requests.filter((request) => request.method === 'layout.apply').at(-1)?.params).toMatchObject({
            tab_label: label, root: { label },
          });
        }
      } finally {
        for (const request of api.requests.filter((request) => request.method === 'layout.apply')) {
          const root = request.params.root as { command?: string[] } | undefined;
          await discardSpec(root?.command?.[2] ?? '');
        }
      }
    });
  });

  it('discards the unread secret-bearing spec once failed creation is confirmed stopped', async () => {
    await withHerdrApi(async (api) => {
      api.faults.set('pane.get', 'error');
      await expect(adapterFor(api.socketPath).createOrAttachHost({
        ...launch, spawnEnv: { HERDR_TEST_SECRET: 'sensitive-test-value' },
      })).rejects.toMatchObject({ launchDisposition: 'stopped' });
      const specPath = readSpecPath(api.requests);
      expect(specPath).not.toBe('');
      await expect(access(specPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it.each(['timeout', 'disconnect'] as const)('keeps the launch handoff and blocks startup retry after an unconfirmed %s', async (fault) => {
    await withHerdrApi(async (api) => {
      api.faults.set('layout.apply', fault);
      try {
        const error = await adapterFor(api.socketPath).createOrAttachHost({
          ...launch, spawnEnv: { HERDR_TEST_SECRET: 'sensitive-test-value' },
        }).catch((failure: unknown) => failure);
        const specPath = readSpecPath(api.requests);
        expect(specPath).not.toBe('');
        await expect(access(specPath)).resolves.toBeUndefined();
        expect(error).toMatchObject({ launchDisposition: 'unconfirmed' });
        expect(isTerminalHostStartupError(error)).toBe(false);
        expect(String(error)).not.toContain('sensitive-test-value');
        expect([...api.panes]).toEqual(['managed']);
      } finally {
        await discardSpec(readSpecPath(api.requests));
      }
    });
  });
});
