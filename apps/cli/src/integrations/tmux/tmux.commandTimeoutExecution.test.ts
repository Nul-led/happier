import { EventEmitter } from 'node:events';
import type { SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('child_process', () => ({ spawn: spawnMock }));

describe('TmuxUtilities command execution timeout', () => {
  it('settles when killing a stuck child does not emit close', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { end: () => void };
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => undefined };
    child.kill = vi.fn();
    spawnMock.mockReset().mockImplementation((_command: string, _args: readonly string[], _options: SpawnOptions) => child);

    try {
      vi.resetModules();
      const { TmuxUtilities } = await import('@/integrations/tmux');
      const resultPromise = new TmuxUtilities().executeTmuxCommand(['list-sessions']);
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(resultPromise).resolves.toMatchObject({ returncode: 1, timedOut: true });
      expect(child.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
