import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from './commandRegistry';

const { authHandlerSpy, homeHandlerSpy, pluginsHandlerSpy, setupHandlerSpy } = vi.hoisted(() => ({
  authHandlerSpy: vi.fn(async (_context: CommandContext) => {}),
  homeHandlerSpy: vi.fn(async (_context: CommandContext) => {}),
  pluginsHandlerSpy: vi.fn(async (_context: CommandContext) => {}),
  setupHandlerSpy: vi.fn(async (_context: CommandContext) => {}),
}));

vi.mock('@/cli/commandRegistry', () => ({
  commandRegistry: {
    auth: authHandlerSpy,
    home: homeHandlerSpy,
    plugins: pluginsHandlerSpy,
    setup: setupHandlerSpy,
  },
  ensureMergedAgentCommandRegistryLoaded: vi.fn(async () => {}),
  findCommandDispatchDescriptor: vi.fn((command: string) => {
    const handler = command === 'auth'
      ? authHandlerSpy
      : command === 'home'
        ? homeHandlerSpy
        : command === 'plugins'
          ? pluginsHandlerSpy
          : command === 'setup'
            ? setupHandlerSpy
            : null;
    if (!handler) return null;
    return {
      id: command,
      command,
      handler,
    };
  }),
  resolveAdmittedActionCliCommand: vi.fn(async () => null),
  resolvePluginCommandTmuxMode: vi.fn(() => null),
}));

import { dispatchCli } from './dispatch';

describe('dispatchCli plugins dev cancellation', () => {
  beforeEach(() => {
    authHandlerSpy.mockClear();
    homeHandlerSpy.mockClear();
    pluginsHandlerSpy.mockClear();
    setupHandlerSpy.mockClear();
  });

  it('owns an interrupt signal for the long-running static development command', async () => {
    const sigintListenersBefore = process.listenerCount('SIGINT');
    const sigtermListenersBefore = process.listenerCount('SIGTERM');
    pluginsHandlerSpy.mockImplementationOnce(async (context) => {
      if (!context?.signal || context.signal.aborted) return;
      await new Promise<void>((resolveAbort) => {
        context.signal?.addEventListener('abort', () => resolveAbort(), { once: true });
      });
    });
    let settled = false;
    const command = dispatchCli({
      args: ['plugins', 'dev', '.'],
      rawArgv: ['happier', 'plugins', 'dev', '.'],
      terminalRuntime: null,
    }).then(() => {
      settled = true;
    });

    try {
      await vi.waitFor(() => expect(pluginsHandlerSpy).toHaveBeenCalled());
      await Promise.resolve();
      expect(settled).toBe(false);
      process.emit('SIGINT');
      await expect(command).resolves.toBeUndefined();
      expect(settled).toBe(true);
      expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore);
    } finally {
      if (!settled) {
        process.emit('SIGINT');
        await command;
      }
    }
  });

  it.each([
    ['auth', authHandlerSpy],
    ['setup', setupHandlerSpy],
    ['home', homeHandlerSpy],
  ] as const)('owns and cleans up an interrupt signal for %s commands', async (root, handler) => {
    const sigintListenersBefore = process.listenerCount('SIGINT');
    const sigtermListenersBefore = process.listenerCount('SIGTERM');
    handler.mockImplementationOnce(async (context) => {
      await new Promise<void>((resolveAbort) => {
        context.signal?.addEventListener('abort', () => resolveAbort(), { once: true });
      });
    });
    const command = dispatchCli({
      args: [root],
      rawArgv: ['happier', root],
      terminalRuntime: null,
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    const context = handler.mock.calls[0]?.[0];
    expect(context?.signal).toBeDefined();
    expect(context?.signal?.aborted).toBe(false);
    process.emit('SIGTERM');

    await expect(command).resolves.toBeUndefined();
    expect(context?.signal?.aborted).toBe(true);
    expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore);
  });

  it('preserves an explicit parent signal without installing process listeners', async () => {
    const sigintListenersBefore = process.listenerCount('SIGINT');
    const sigtermListenersBefore = process.listenerCount('SIGTERM');
    const caller = new AbortController();

    await dispatchCli({
      args: ['auth'],
      rawArgv: ['happier', 'auth'],
      terminalRuntime: null,
      signal: caller.signal,
    });

    expect(authHandlerSpy).toHaveBeenCalledWith(expect.objectContaining({ signal: caller.signal }));
    expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore);
  });

  it('cleans up owned interrupt listeners when a command fails', async () => {
    const sigintListenersBefore = process.listenerCount('SIGINT');
    const sigtermListenersBefore = process.listenerCount('SIGTERM');
    authHandlerSpy.mockRejectedValueOnce(new Error('auth failed'));

    await expect(dispatchCli({
      args: ['auth'],
      rawArgv: ['happier', 'auth'],
      terminalRuntime: null,
    })).rejects.toThrow('auth failed');

    expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore);
  });
});
