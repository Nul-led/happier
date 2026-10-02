import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

function createRunnerScriptHarness() {
  const scriptPath = resolve(__dirname, '../../../scripts/terminal_launch_spec_runner.cjs');
  const source = readFileSync(scriptPath, 'utf8').replace(/^#!.*\n/, '');
  const scriptRequire = createRequire(scriptPath);
  const child = new EventEmitter();
  const spawn = vi.fn(() => child);
  const fakeProcess = Object.assign(new EventEmitter(), {
    argv: ['node', scriptPath],
    env: {},
    exit: vi.fn(),
    cwd: vi.fn(() => '/tmp/workspace'),
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
  });
  const module = { exports: {} as Record<string, unknown> };
  const fakeRequire = Object.assign((id: string) => {
    if (id === 'node:child_process') return { spawn };
    if (id === 'node:fs') return require(id);
    if (id === 'node:fs/promises') return require(id);
    if (id === 'node:os') return require(id);
    if (id === 'node:path') return require(id);
    if (id === './process_tree.cjs') return scriptRequire(id);
    throw new Error(`unexpected require: ${id}`);
  }, { main: {} });

  vm.runInNewContext(source, {
    console,
    module,
    exports: module.exports,
    process: fakeProcess,
    require: fakeRequire,
  });

  return { child, fakeProcess, module, spawn };
}

describe('terminal_launch_spec_runner.cjs', () => {
  it('preserves inherited native stderr instead of changing its terminal identity', async () => {
    const { child, module, spawn } = createRunnerScriptHarness();
    const runLaunchSpec = module.exports.runLaunchSpec as (spec: {
      command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; inheritStderr: boolean;
    }) => Promise<number>;
    const directory = await mkdtemp(join(tmpdir(), 'happier-native-stderr-'));
    const specPath = join(directory, 'launch.json');
    const readLaunchSpecFile = module.exports.readLaunchSpecFile as (path: string) => Promise<Parameters<typeof runLaunchSpec>[0]>;
    await writeFile(specPath, JSON.stringify({ command: 'native', args: [], cwd: directory, env: {}, inheritStderr: true }));
    try {
      const result = runLaunchSpec(await readLaunchSpecFile(specPath));
      expect(spawn).toHaveBeenCalledWith('native', [], expect.objectContaining({ stdio: ['inherit', 'inherit', 'inherit'] }));
      child.emit('close', 0, null);
      await result;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('forwards Windows verbatim argument handling to the child process', async () => {
    const { child, module, spawn } = createRunnerScriptHarness();
    const runLaunchSpec = module.exports.runLaunchSpec as (spec: {
      command: string;
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
      windowsVerbatimArguments?: boolean;
    }) => Promise<number>;

    const result = runLaunchSpec({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\Users\\alice\\AppData\\Roaming\\npm\\claude.cmd"'],
      cwd: 'C:\\workspace',
      env: {},
      windowsVerbatimArguments: true,
    });

    expect(spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      expect.any(Array),
      expect.objectContaining({ windowsVerbatimArguments: true }),
    );
    child.emit('close', 0, null);
    await expect(result).resolves.toBe(0);
  });

  it('ignores terminal interrupt signals while the child is alive', async () => {
    const { child, fakeProcess, module } = createRunnerScriptHarness();
    const runLaunchSpec = module.exports.runLaunchSpec as (spec: {
      command: string;
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
    }) => Promise<number>;

    const result = runLaunchSpec({ command: 'child', args: [], cwd: '/tmp/workspace', env: {} });

    expect(fakeProcess.listenerCount('SIGINT')).toBe(1);
    expect(fakeProcess.listenerCount('SIGQUIT')).toBe(1);
    expect(fakeProcess.listenerCount('SIGTSTP')).toBe(0);
    fakeProcess.emit('SIGINT');
    child.emit('close', 0, null);

    await expect(result).resolves.toBe(0);
    expect(fakeProcess.listenerCount('SIGINT')).toBe(0);
    expect(fakeProcess.listenerCount('SIGQUIT')).toBe(0);
    expect(fakeProcess.listenerCount('SIGTSTP')).toBe(0);
  });
});
