import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

type ChildProcessLike = {
  pid?: number;
  killed?: boolean;
  kill: (signal: NodeJS.Signals) => void;
};

type ProcessLike = {
  platform: NodeJS.Platform;
  on: (event: NodeJS.Signals, handler: () => void) => void;
};

type ClaudeVersionUtilsModule = {
  attachChildSignalForwarding: (child: ChildProcessLike, proc?: ProcessLike) => void;
};

const require = createRequire(import.meta.url);
const claudeVersionUtils = require('./claude_version_utils.cjs') as ClaudeVersionUtilsModule;
const { attachChildSignalForwarding } = claudeVersionUtils;

describe('claude_version_utils attachChildSignalForwarding', () => {
  it('forwards SIGTERM and SIGINT to child', () => {
    const handlers = new Map<NodeJS.Signals, (() => void)[]>();
    const proc: ProcessLike = {
      platform: 'darwin',
      on: (event, handler) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    };

    const child: ChildProcessLike = {
      pid: 123,
      killed: false,
      kill: vi.fn(),
    };

    attachChildSignalForwarding(child, proc);

    for (const handler of handlers.get('SIGTERM') ?? []) handler();
    for (const handler of handlers.get('SIGINT') ?? []) handler();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('does not register SIGHUP on Windows', () => {
    const handlers = new Map<NodeJS.Signals, (() => void)[]>();
    const proc: ProcessLike = {
      platform: 'win32',
      on: (event, handler) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    };

    const child: ChildProcessLike = { pid: 123, killed: false, kill: vi.fn() };
    attachChildSignalForwarding(child, proc);

    expect(handlers.has('SIGHUP')).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('exits unsuccessfully when the Claude binary is terminated by a signal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-claude-exit-'));
    const harnessPath = join(root, 'run-claude.cjs');
    await writeFile(
      harnessPath,
      `require(${JSON.stringify(require.resolve('./claude_version_utils.cjs'))}).runClaudeCli(process.execPath);\n`,
      'utf8',
    );
    try {
      const result = spawnSync(
        process.execPath,
        [harnessPath, '-e', "process.kill(process.pid, 'SIGTERM')"],
        { encoding: 'utf8' },
      );

      expect(result.status).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
