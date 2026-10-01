import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished, vi } from 'vitest';
import { bundleInstalledPackageWithRuntimeDependencies, bundleWorkspacePackagesWithRuntimeDependencies } from '@happier-dev/cli-common/workspaces';

import { launchBorrowedTerminalProcess } from './borrowedTerminalProcess';
import { killProcessTree } from '@/agent/runtime/process/killProcessTree';
import { isPidAlive, waitForProcessExit } from '@/testkit/process/spawn';
import { bindProcessLogger, Logger } from '@/ui/logger';
import { waitForCondition } from '@/testkit/async/waitFor';

describe('launchBorrowedTerminalProcess', () => {
  it('reports late handoff cleanup failure to the default file diagnostic without disturbing the terminal', async () => {
    if (process.platform === 'win32') return; // Real POSIX directory permissions.
    const directory = await mkdtemp(join(tmpdir(), 'happier-borrowed-diagnostic-'));
    const logPath = join(directory, 'diagnostic.log');
    const scopedLogger = new Logger({ logFilePath: logPath, allowDangerousRemoteLogging: false, pruneCurrentProcessLogs: false });
    const restoreLogger = bindProcessLogger(scopedLogger);
    const child = Object.assign(new EventEmitter(), { pid: undefined });
    let specPath: string | undefined;
    const spawnProcess = vi.fn((_command: string, args: readonly string[], _options: SpawnOptions) => {
      specPath = args[1]!;
      return child as unknown as ChildProcess; // Genuine OS-spawn/exit boundary.
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const launched = await launchBorrowedTerminalProcess({
        spawnArgv: ['/native/agent', 'private-native-argument'], workingDirectory: tmpdir(),
        spawnEnv: { PRIVATE_NATIVE_SECRET: 'private-native-value' }, spawnProcess,
      });
      chmodSync(dirname(specPath!), 0o500);
      child.emit('exit', 0, null);
      await expect(launched.whenExited).rejects.toMatchObject({ code: 'EACCES' });
      scopedLogger.flushSync();
      const diagnostic = await readFile(logPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
      expect(diagnostic).toContain('terminal_child_completion_failed');
      expect(diagnostic).not.toContain('private-native');
      expect(diagnostic).not.toContain(specPath!);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      restoreLogger();
      if (specPath) {
        chmodSync(dirname(specPath), 0o700);
        await rm(dirname(specPath), { recursive: true, force: true });
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['sync', 'error-event'] as const)('preserves startup failure when private handoff cleanup also fails (%s)', async (failureMode) => {
    if (process.platform === 'win32') return; // Real POSIX directory permissions, not an internal mock.
    const failure = new Error('native spawn refused');
    let specPath: string | undefined;
    const child = Object.assign(new EventEmitter(), { pid: undefined });
    const spawnProcess = vi.fn((_command: string, args: readonly string[], _options: SpawnOptions): ChildProcess => {
      specPath = args[1]!;
      chmodSync(dirname(specPath), 0o500);
      if (failureMode === 'sync') throw failure;
      queueMicrotask(() => child.emit('error', failure));
      return child as unknown as ChildProcess; // Genuine failed OS-spawn boundary.
    });
    try {
      const result = launchBorrowedTerminalProcess({
        spawnArgv: ['/missing/native-agent'], workingDirectory: tmpdir(), spawnEnv: {}, spawnProcess,
      });
      const error = await result.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(AggregateError);
      const errors = (error as AggregateError).errors as unknown[];
      expect(errors).toContain(failure);
      expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EACCES' })]));
    } finally {
      if (specPath) {
        chmodSync(dirname(specPath), 0o700);
        await rm(dirname(specPath), { recursive: true, force: true });
      }
    }
  });

  const bunProbe = spawnSync('bun', ['-p', 'process.execPath'], { encoding: 'utf8' });
  const bunPath = bunProbe.status === 0 ? bunProbe.stdout.trim() : null;
  describe('controller lifetime', () => {
    let assetsDirectory: string;
    let runnerPath: string;
    beforeAll(async () => {
      // All runtime pairs consume the same read-only current-source assets. Copying
      // their identical dependency closure per case adds no isolation or coverage.
      assetsDirectory = await mkdtemp(join(tmpdir(), 'happier-borrowed-assets-'));
      const scriptsDirectory = join(assetsDirectory, 'scripts');
      await mkdir(scriptsDirectory);
      for (const filename of ['terminal_launch_spec_runner.cjs', 'process_tree.cjs']) {
        await cp(resolve('scripts', filename), join(scriptsDirectory, filename));
      }
      const nodeModulesDirectory = join(assetsDirectory, 'node_modules');
      bundleInstalledPackageWithRuntimeDependencies({
        packageName: 'ps-list', resolveFromPackageJsonPath: resolve('package.json'),
        destNodeModulesDir: nodeModulesDirectory,
      });
      bundleWorkspacePackagesWithRuntimeDependencies({ bundles: [{
        packageName: '@happier-dev/cli-common',
        srcDir: resolve('../../packages/cli-common'),
        destDir: join(nodeModulesDirectory, '@happier-dev/cli-common'),
      }] });
      runnerPath = join(scriptsDirectory, 'terminal_launch_spec_runner.cjs');
    });
    afterAll(async () => {
      if (assetsDirectory) await rm(assetsDirectory, { recursive: true, force: true });
    });
    it('reports controller-loss cleanup failure with a fixed diagnostic, without native launch values', async () => {
      if (process.platform === 'win32') return; // Real unavailable POSIX discovery commands.
      const directory = await mkdtemp(join(tmpdir(), 'happier-terminal-guardian-'));
      const pidPath = join(directory, 'native.pid');
      const mod = createRequire(import.meta.url)(runnerPath) as {
        runLaunchSpec: (spec: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }, signal: AbortSignal) => Promise<number>;
      };
      const controller = new AbortController();
      const previousPath = process.env.PATH;
      let ownedPid: number | undefined;
      let diagnostic = '';
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
        diagnostic += values.map(String).join(' ') + '\n';
      });
      let cleanupPromise: Promise<void> | undefined;
      const cleanup = () => cleanupPromise ??= (async () => {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        consoleError.mockRestore();
        if (!ownedPid && existsSync(pidPath)) ownedPid = Number(readFileSync(pidPath, 'utf8'));
        if (ownedPid) {
          try { process.kill(ownedPid, 'SIGKILL'); } catch { /* already gone */ }
        }
        await rm(directory, { recursive: true, force: true });
      })();
      onTestFinished(cleanup);
      try {
        const native = mod.runLaunchSpec({
          command: process.execPath,
          args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', pidPath, 'private-native-value'],
          cwd: directory,
          env: { ...process.env, PRIVATE_NATIVE_VALUE: 'private-native-value' },
        }, controller.signal);
        await waitForCondition(() => existsSync(pidPath), { timeoutMs: 10_000, label: 'native guardian fixture startup' });
        ownedPid = Number(readFileSync(pidPath, 'utf8'));
        process.env.PATH = '';
        controller.abort();
        await native;
        expect(diagnostic).toContain('terminal_controller_cleanup_incomplete');
        expect(diagnostic).not.toContain('private-native-value');
        expect(diagnostic).not.toContain(pidPath);
      } finally { await cleanup(); }
    });

    it.each([
      { controllerRuntime: process.execPath, launcherRuntime: process.execPath, lifetime: true },
      ...(bunPath ? [
        { controllerRuntime: bunPath, launcherRuntime: process.execPath, lifetime: true },
        { controllerRuntime: process.execPath, launcherRuntime: bunPath, lifetime: true },
        { controllerRuntime: bunPath, launcherRuntime: bunPath, lifetime: true },
      ] : []),
      { controllerRuntime: process.execPath, launcherRuntime: process.execPath, lifetime: false },
    ])('handles controller loss with controller=$controllerRuntime launcher=$launcherRuntime lifetime=$lifetime, preserving shell and final native environment', async ({ controllerRuntime, launcherRuntime, lifetime }) => {
      if (process.platform === 'win32') return; // This controller-only SIGKILL proof is POSIX-specific.
      const directory = await mkdtemp(join(tmpdir(), 'happier-borrowed-lifetime-'));
      const readyPath = join(directory, 'ready.json');
      const ownerUrl = pathToFileURL(resolve('src/terminal/host/borrowedTerminalProcess.ts')).href;
      const descendant = 'process.send(process.pid); setInterval(() => {}, 1000);';
      const provider = `
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        child.once('message', pid => require('node:fs').writeFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ launcher: process.ppid, provider: process.pid, descendant: pid, env: { TEST_SECRET: process.env.TEST_SECRET, HERDR_ENV: process.env.HERDR_ENV } })));
        process.on('SIGTERM', () => { child.once('exit', () => process.exit(0)); child.kill('SIGTERM'); });
        setInterval(() => {}, 1000);
      `;
      const source = lifetime ? `
        process.stderr.write('test phase: importing current borrowed owner\\n');
        const { launchBorrowedTerminalProcess } = await import(${JSON.stringify(ownerUrl)});
        process.stderr.write('test phase: borrowed owner imported\\n');
        const { spawn } = await import('node:child_process');
        process.send('source-owner-ready');
        const launched = await launchBorrowedTerminalProcess({ spawnArgv: [${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(provider)}], spawnEnv: { PATH: process.env.PATH, TEST_SECRET: 'private-native-value' }, workingDirectory: ${JSON.stringify(directory)},
          spawnProcess: (command, args, options) => {
            process.stderr.write('test phase: spawning native launcher\\n');
            return spawn(command, [${JSON.stringify(runnerPath)}, ...args.slice(1)], options);
          } });
        process.stderr.write('test phase: native launcher started\\n');
        await launched.whenExited;
      ` : `
        const { spawn } = await import('node:child_process');
        process.send('source-owner-ready');
        const launcher = spawn(${JSON.stringify(launcherRuntime)}, [${JSON.stringify(runnerPath)}, ${JSON.stringify(join(directory, 'launch.json'))}], { stdio: 'ignore' });
        await new Promise(resolve => launcher.once('exit', resolve));
      `;
      if (!lifetime) await writeFile(join(directory, 'launch.json'), JSON.stringify({
        command: process.execPath, args: ['-e', provider], cwd: directory,
        env: { PATH: process.env.PATH ?? '', TEST_SECRET: 'private-native-value' },
      }));
      const controllerArgs = controllerRuntime === bunPath ? ['-e', source] : ['--import', 'tsx', '--input-type=module', '-e', source];
      const controller = spawn(controllerRuntime, controllerArgs, {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        serialization: 'json',
        env: { ...process.env, NODE_PATH: '', HERDR_ENV: 'must-not-return', HAPPIER_JS_RUNTIME_PATH: launcherRuntime },
      });
      let stderr = '';
      controller.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      let phase = 'current-source controller import';
      onTestFailed(() => {
        console.error(`Controller lifetime fixture failed during ${phase}; exit=${controller.exitCode}; stderr=${stderr}`);
      });
      const sourceReady = new Promise<void>((resolve, reject) => {
        controller.once('message', (message) => {
          if (message === 'source-owner-ready') resolve();
          else reject(new Error('Controller emitted an unexpected readiness phase'));
        });
        controller.once('error', reject);
        controller.once('exit', () => reject(new Error(`Source controller exited before readiness: ${stderr}`)));
      });
      const sentinel = spawn('/bin/sh', ['-c', 'sleep 600'], { stdio: 'ignore' });
      let tree: { launcher: number; provider: number; descendant: number; env: Record<string, string> } | undefined;
      let cleanup: Promise<void> | undefined;
      const cleanOwnedProcesses = () => cleanup ??= (async () => {
        if (tree && isPidAlive(tree.launcher)) await killProcessTree({ pid: tree.launcher });
        else if (tree && isPidAlive(tree.provider)) await killProcessTree({ pid: tree.provider });
        if (controller.exitCode === null && controller.signalCode === null) await killProcessTree(controller);
        await killProcessTree(sentinel);
        await rm(directory, { recursive: true, force: true });
      })();
      onTestFinished(cleanOwnedProcesses);
      try {
        // Cold author-source imports belong to the unchanged overall test budget,
        // not the native process readiness phase. The test hook also cleans a timed-out import.
        await sourceReady;
        phase = 'native provider readiness';
        await vi.waitFor(async () => {
          try { tree = JSON.parse(await readFile(readyPath, 'utf8')); }
          catch (error) { throw new Error(`Native process not ready (exit=${controller.exitCode}; stderr=${stderr})`, { cause: error }); }
        }, { timeout: 10_000 });
        expect(tree!.env).toEqual({ TEST_SECRET: 'private-native-value' });
        expect(isPidAlive(tree!.descendant)).toBe(true);
        phase = 'controller-only SIGKILL and owned tree cleanup';
        controller.kill('SIGKILL');
        await expect(waitForProcessExit(controller.pid!, { timeoutMs: 10_000 })).resolves.toBe(true);
        if (lifetime) {
          await expect(waitForProcessExit(tree!.provider, { timeoutMs: 3_000 })).resolves.toBe(true);
          await expect(waitForProcessExit(tree!.descendant, { timeoutMs: 3_000 })).resolves.toBe(true);
        } else {
          await expect(waitForProcessExit(tree!.provider, { timeoutMs: 3_000 })).resolves.toBe(false);
          expect(isPidAlive(tree!.descendant)).toBe(true);
        }
        expect(isPidAlive(sentinel.pid!)).toBe(true);
        phase = 'fixture teardown';
      } finally {
        await cleanOwnedProcesses();
      }
    });
  });

  it('observes normal native close without ending its controller or retaining a private handoff', async () => {
    const launched = await launchBorrowedTerminalProcess({
      spawnArgv: [process.execPath, '-e', 'process.exit(0)'],
      spawnEnv: {}, workingDirectory: tmpdir(),
    });
    await expect(launched.whenExited).resolves.toEqual({ code: 0, signal: null });
  });

  it('runs the launch argv in the current terminal and terminates only its process tree', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 42 });
    const spawnProcess = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => child);
    const terminateProcess = vi.fn(async () => undefined);

    const launched = await launchBorrowedTerminalProcess({
      spawnArgv: ['/managed/agent', 'opaque arg'],
      spawnEnv: { PATH: '/bin', TERM: 'xterm-256color' },
      workingDirectory: '/workspace/project',
      spawnProcess: spawnProcess as never,
      terminateProcess,
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      expect.any(String),
      [expect.stringContaining('terminal_launch_spec_runner.cjs'), expect.any(String)],
      expect.objectContaining({
        cwd: '/workspace/project',
        env: { PATH: '/bin', TERM: 'xterm-256color' },
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      }),
    );

    const specPath = spawnProcess.mock.calls[0]![1]![1] as string;
    expect(JSON.parse(await readFile(specPath, 'utf8'))).toMatchObject({
      command: '/managed/agent', args: ['opaque arg'],
      env: { PATH: '/bin', TERM: 'xterm-256color' },
      envPassthroughKeys: ['TERM', 'COLORTERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION'],
    });

    child.emit('exit', 0, null);
    await expect(launched.whenExited).resolves.toEqual({ code: 0, signal: null });
    await expect(readFile(specPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await launched.terminate();
    await launched.terminate();
    expect(terminateProcess).toHaveBeenCalledOnce();
    expect(terminateProcess).toHaveBeenCalledWith(child);
  });

  it('reports a spawn failure through startup without leaking an unhandled exit rejection', async () => {
    const child = Object.assign(new EventEmitter(), { pid: undefined });
    const failure = new Error('spawn failed');
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit('error', failure));
      return child;
    });

    await expect(launchBorrowedTerminalProcess({
      spawnArgv: ['/missing/managed-node'],
      spawnEnv: { PATH: '/bin' },
      workingDirectory: '/workspace/project',
      spawnProcess: spawnProcess as never,
    })).rejects.toBe(failure);
  });
});
