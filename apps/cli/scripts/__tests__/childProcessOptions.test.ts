import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('scripts/childProcessOptions.cjs', () => {
  it('adds windowsHide on win32', () => {
    const mod = require('../childProcessOptions.cjs') as {
      withWindowsHide: (options: Record<string, unknown>, platform?: string) => Record<string, unknown>;
    };
    expect(mod.withWindowsHide({ foo: 'bar' }, 'win32')).toEqual({ foo: 'bar', windowsHide: true });
  });

  it('does not add windowsHide on non-win32', () => {
    const mod = require('../childProcessOptions.cjs') as {
      withWindowsHide: (options: Record<string, unknown>, platform?: string) => Record<string, unknown>;
    };
    expect(mod.withWindowsHide({ foo: 'bar' }, 'darwin')).toEqual({ foo: 'bar' });
  });

  it('maps signal-only child termination to an unsuccessful exit code', () => {
    const mod = require('../childProcessOptions.cjs') as {
      normalizeChildProcessExitCode: (code: number | null) => number;
    };

    expect(mod.normalizeChildProcessExitCode(null)).toBe(1);
    expect(mod.normalizeChildProcessExitCode(0)).toBe(0);
    expect(mod.normalizeChildProcessExitCode(7)).toBe(7);
  });
});
