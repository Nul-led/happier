import { describe, expect, it, vi } from 'vitest';
import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

const resolveSessionTransportContext = vi.fn();
const readExecutionRunStream = vi.fn();

vi.mock('@/session/services/resolveSessionTransportContext', () => ({ resolveSessionTransportContext }));
vi.mock('@/session/services/executionRuns', () => ({ readExecutionRunStream }));

describe('happier session run stream-read arguments', () => {
  it.each([
    ['a malformed cursor', ['session', 'run', 'sess-prefix', 'run-1', 'stream-1', '--cursor', '0oops']],
    ['a non-positive max-events value', ['session', 'run', 'sess-prefix', 'run-1', 'stream-1', '--cursor', '0', '--max-events', '0']],
  ])('rejects %s before reading credentials', async (_label, argv) => {
    const readCredentialsFn = vi.fn(async () => null);
    const { handleSessionCommand } = await import('../handleSessionCommand');
    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand(['run', 'stream-read', ...argv.slice(2), '--json'], { readCredentialsFn });
      expect(output.json()).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
      expect(readCredentialsFn).not.toHaveBeenCalled();
      expect(resolveSessionTransportContext).not.toHaveBeenCalled();
      expect(readExecutionRunStream).not.toHaveBeenCalled();
    } finally {
      output.restore();
      process.exitCode = undefined;
    }
  });
});
