import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  children: [] as EventEmitter[],
  killProcessTree: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: mocks.spawn,
}));

vi.mock('@/agent/runtime/process/killProcessTree', () => ({
  killProcessTree: mocks.killProcessTree,
}));

import { runScmCommand } from './runtime';

type FakeChild = EventEmitter & Readonly<{
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: Readonly<{
    writable: boolean;
    destroyed: boolean;
    once: () => void;
    write: () => void;
    end: () => void;
  }>;
  kill: () => boolean;
}>;

function createFakeChild(pid: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.assign(child, {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { writable: true, destroyed: false, once: () => undefined, write: () => undefined, end: () => undefined },
    kill: () => true,
  });
  return child;
}

describe('runScmCommand cancellation', () => {
  it('does not spawn when the operation was already aborted', async () => {
    mocks.spawn.mockReset();
    mocks.killProcessTree.mockReset();
    const controller = new AbortController();
    controller.abort();

    await expect(runScmCommand({
      bin: 'git',
      cwd: process.cwd(),
      args: ['log'],
      signal: controller.signal,
    })).resolves.toEqual(expect.objectContaining({
      success: false,
      stderr: 'SCM command was aborted',
    }));
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.killProcessTree).not.toHaveBeenCalled();
  });

  it('terminates every command sharing an AbortSignal through the process-tree owner', async () => {
    const children = [createFakeChild(41001), createFakeChild(41002)];
    mocks.spawn.mockReset();
    mocks.spawn.mockImplementation(() => {
      const child = children[mocks.spawn.mock.calls.length - 1];
      if (!child) throw new Error('Unexpected SCM spawn');
      return child;
    });
    mocks.killProcessTree.mockReset();
    mocks.killProcessTree.mockImplementation(async (child: FakeChild) => {
      queueMicrotask(() => child.emit('close', null));
    });
    const controller = new AbortController();

    const commands = [
      runScmCommand({ bin: 'git', cwd: process.cwd(), args: ['log'], signal: controller.signal }),
      runScmCommand({ bin: 'git', cwd: process.cwd(), args: ['log'], signal: controller.signal }),
    ];
    controller.abort();
    const results = await Promise.all(commands);

    expect(mocks.killProcessTree.mock.calls.map(([child]) => child)).toEqual(children);
    expect(results).toEqual([
      expect.objectContaining({ success: false }),
      expect.objectContaining({ success: false }),
    ]);
  });
});
