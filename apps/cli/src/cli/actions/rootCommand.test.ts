import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureConsoleText } from '@/testkit/logger/captureOutput';

import { handleActionCliRootCommand } from './rootCommand';

describe('Action CLI family root commands', () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('keeps help and JSON-looking bytes after -- literal', async () => {
    const output = captureConsoleText();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await handleActionCliRootCommand('credentials', {
        args: ['credentials', 'unexpected', '--', '--help', '--json'],
        rawArgv: ['happier', 'credentials', 'unexpected', '--', '--help', '--json'],
        terminalRuntime: null,
      });
      expect(output.text()).toBe('');
      expect(error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Unknown command: happier credentials unexpected.'),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      output.restore();
      error.mockRestore();
    }
  });
});
