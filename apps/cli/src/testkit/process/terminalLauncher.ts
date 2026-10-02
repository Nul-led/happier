import { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { TerminalSpawnProcess } from '@/terminal/host/borrowedTerminalProcess';

/** External launcher IPC/process boundary; launch-spec and lifecycle owners stay real. */
export function createTerminalLauncherFixture(params: Readonly<{
  autoReady?: boolean;
  onSignal?: (signal: 'SIGINT' | 'SIGKILL', child: ChildProcess) => void;
}> = {}) {
  const child = new ChildProcess();
  let spec: unknown;
  Object.defineProperty(child, 'send', { value: (message: unknown, callback: (error: Error | null) => void) => {
    try {
      if (message && typeof message === 'object' && 'signal' in message
        && (message.signal === 'SIGINT' || message.signal === 'SIGKILL')) {
        params.onSignal?.(message.signal, child);
      }
      callback(null);
    } catch (error) { callback(error instanceof Error ? error : new Error('Fixture signal failed')); }
    return true;
  } });
  Object.defineProperty(child, 'disconnect', { value: () => child.emit('exit', 1, null) });
  const spawnProcess = vi.fn<TerminalSpawnProcess>((_command, args) => {
    if (!Array.isArray(args) || typeof args[1] !== 'string') throw new Error('Expected launcher handoff');
    spec = JSON.parse(readFileSync(args[1], 'utf8')) as unknown;
    if (params.autoReady !== false) queueMicrotask(() => child.emit('message', { type: 'terminal-native-spawned' }));
    return child;
  });
  return { child, spawnProcess, readSpec: () => spec };
}
