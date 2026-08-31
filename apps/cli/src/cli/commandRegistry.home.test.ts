import { describe, expect, it, vi } from 'vitest';

const handleHomeCliCommand = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('./commands/home', () => ({ handleHomeCliCommand }));

import { commandRegistry, listRegisteredCommandSurfaceEntries } from './commandRegistry';

describe('Personal Home command registration', () => {
  it('registers one lazy top-level home command and dispatches to its handler', async () => {
    expect(handleHomeCliCommand).not.toHaveBeenCalled();
    expect(listRegisteredCommandSurfaceEntries()).toContainEqual(expect.objectContaining({
      command: 'home',
      rootHelpLabel: 'happier home',
    }));

    await commandRegistry.home?.({
      args: ['home', 'status'],
      rawArgv: ['happier', 'home', 'status'],
      terminalRuntime: null,
    });

    expect(handleHomeCliCommand).toHaveBeenCalledOnce();
  });
});
