import { spawn } from 'node:child_process';

import { resolveWindowsCommandInvocation } from '@happier-dev/cli-common/process';

import { killProcessTree } from '@/agent/runtime/process/killProcessTree';
import { logger } from '@/ui/logger';
import { createTerminalLaunchSpec, discardFailedTerminalLaunch } from './launchSpec';

type BorrowedTerminalChild = Readonly<{
  pid?: number;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}>;

export type BorrowedTerminalProcess = Readonly<{
  whenExited: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
  terminate(): Promise<void>;
}>;

export async function launchBorrowedTerminalProcess(params: Readonly<{
  spawnArgv: readonly string[];
  workingDirectory: string;
  spawnEnv: Readonly<Record<string, string>>;
  spawnProcess?: typeof spawn;
  terminateProcess?: (child: BorrowedTerminalChild) => Promise<void>;
}>): Promise<BorrowedTerminalProcess> {
  const [command, ...args] = params.spawnArgv;
  if (!command) throw new Error('Borrowed terminal launch requires a command');

  const env = { ...params.spawnEnv };
  const invocation = resolveWindowsCommandInvocation({ command, args, env, resolveCommandOnPath: false });
  const launch = await createTerminalLaunchSpec({
    workingDirectory: params.workingDirectory,
    spawnArgv: [invocation.command, ...invocation.args],
    spawnEnv: env,
    envPassthroughKeys: ['TERM', 'COLORTERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION'],
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
  const launcherInvocation = resolveWindowsCommandInvocation({
    command: launch.argv[0]!, args: launch.argv.slice(1), env, resolveCommandOnPath: false,
  });
  let child: BorrowedTerminalChild;
  try {
    child = (params.spawnProcess ?? spawn)(launcherInvocation.command, launcherInvocation.args, {
      cwd: params.workingDirectory,
      env,
      // Child-owned same-pane launches end with their controller; independent hosts
      // use their adapter path and do not receive this lifetime channel.
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      serialization: 'json',
      windowsHide: true,
      ...(launcherInvocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    }) as unknown as BorrowedTerminalChild;
  } catch (error) {
    return discardFailedTerminalLaunch(launch, error);
  }

  let startupSettled = false;
  let resolveStartup: (() => void) | null = null;
  let rejectStartup: ((error: Error) => void) | null = null;
  const startup = new Promise<void>((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });
  const whenExited = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolve, reject) => {
    child.once('error', (error) => {
      if (!startupSettled) {
        startupSettled = true;
        rejectStartup?.(error);
      }
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (!startupSettled) {
        startupSettled = true;
        rejectStartup?.(new Error('Borrowed terminal process exited before startup completed'));
      }
      resolve({ code, signal });
    });
  }).finally(launch.discard);
  void whenExited.catch(() => undefined);
  setImmediate(() => {
    if (startupSettled) return;
    startupSettled = true;
    resolveStartup?.();
  });
  try { await startup; }
  catch (error) { return discardFailedTerminalLaunch(launch, error); }
  // Startup failures are returned to their caller. Later completion/cleanup failures
  // need a file-only diagnostic because lifecycle readers may track only completion.
  void whenExited.catch(() => {
    logger.infoFile('[borrowed-terminal] Owned terminal process completion failed', {
      code: 'terminal_child_completion_failed',
    });
  });

  const terminateProcess = params.terminateProcess
    ?? (async (target: BorrowedTerminalChild) => await killProcessTree(target));
  let termination: Promise<void> | null = null;
  return Object.freeze({
    whenExited,
    terminate: () => {
      termination ??= terminateProcess(child);
      return termination;
    },
  });
}
