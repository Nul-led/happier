import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Duplex, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { killProcessTree as defaultKillProcessTree } from '@/agent/runtime/process/killProcessTree';
import {
  createManagedChildProcess as defaultCreateManagedChildProcess,
  type ManagedChildProcess,
} from '@/subprocess/supervision/managedChildProcess';
import {
  createProcessCustodyHandshakePath as defaultCreateProcessCustodyHandshakePath,
  createWindowsJobCustodyName as defaultCreateWindowsJobCustodyName,
  removeProcessCustodyHandshakeFile as defaultRemoveProcessCustodyHandshakeFile,
  resolveProcessCustodyRuntimeExecutable as defaultResolveProcessCustodyRuntimeExecutable,
  terminateProcessCustodyByJob as defaultTerminateProcessCustodyByJob,
  waitForProcessCustodyHandshake as defaultWaitForProcessCustodyHandshake,
  type ProcessCustodySpawnSpec,
} from '@/subprocess/supervision/processCustody';
import { logger } from '@/utils/logger';
import type { LaunchWorkspaceSyncLocalAgent } from './createDaemonWorkspaceSyncRuntime';
import type { SpawnWorkspaceSyncSidecar } from '@/workspaces/sync/workspaceSyncSidecarLifecycle';

type SpawnNativeProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

type NativeProcessLauncherDependencies = Readonly<{
  platform?: NodeJS.Platform;
  spawn?: SpawnNativeProcess;
  createManagedChildProcess?: (child: ChildProcess) => ManagedChildProcess;
  killProcessTree?: (
    child: ChildProcess,
    options?: Readonly<{ graceMs?: number; ownedProcessGroup?: boolean }>,
  ) => Promise<void>;
  resolveProcessCustodyRuntimeExecutable?: (platform?: NodeJS.Platform) => string | null;
  createWindowsJobCustodyName?: (instanceId: string) => string;
  createProcessCustodyHandshakePath?: () => string;
  waitForProcessCustodyHandshake?: typeof defaultWaitForProcessCustodyHandshake;
  removeProcessCustodyHandshakeFile?: (handshakePath: string) => Promise<void>;
  terminateProcessCustodyByJob?: typeof defaultTerminateProcessCustodyByJob;
  logStderr?: (label: 'workspace-sync-sidecar' | 'workspace-sync-agent', byteLength: number) => void;
}>;

export type WorkspaceSyncNativeProcessLaunchers = Readonly<{
  spawnSidecar: SpawnWorkspaceSyncSidecar;
  launchLocalAgent: LaunchWorkspaceSyncLocalAgent;
  stopRetainedNativeProcesses(): Promise<void>;
}>;

function assertNativeExecutablePath(executablePath: string): void {
  if (!isAbsolute(executablePath)) {
    throw new Error('Workspace sync native process requires an absolute verified executable path');
  }
}

function createAbortError(): Error {
  const error = new Error('Workspace sync native process launch was aborted');
  error.name = 'AbortError';
  return error;
}

function processGroupOptions(platform: NodeJS.Platform): Readonly<{ ownedProcessGroup: true }> | undefined {
  return platform === 'win32' ? undefined : { ownedProcessGroup: true };
}

function withoutBrokerDescriptorArgument(args: readonly string[]): readonly string[] {
  const result: string[] = [];
  let found = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--broker-descriptor') {
      if (found || index + 1 >= args.length) throw new Error('Workspace sync sidecar has an invalid broker descriptor argument');
      found = true;
      index += 1;
      continue;
    }
    if (argument.startsWith('--broker-descriptor=')) {
      if (found) throw new Error('Workspace sync sidecar has duplicate broker descriptor arguments');
      found = true;
      continue;
    }
    result.push(argument);
  }
  if (!found) throw new Error('Workspace sync sidecar requires a broker descriptor argument');
  return result;
}

function drainStderr(
  child: ChildProcess,
  label: 'workspace-sync-sidecar' | 'workspace-sync-agent',
  logStderr: (label: 'workspace-sync-sidecar' | 'workspace-sync-agent', byteLength: number) => void,
): void {
  child.stderr?.on('data', (chunk: Buffer | Uint8Array | string) => {
    const byteLength = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
    if (byteLength > 0) logStderr(label, byteLength);
  });
}

async function writeAndCloseDescriptor(stream: Writable, descriptor: Uint8Array): Promise<void> {
  const completion = finished(stream, { cleanup: true });
  stream.end(Buffer.from(descriptor));
  await completion;
}

export function createWorkspaceSyncNativeProcessLaunchers(
  dependencies: NativeProcessLauncherDependencies = {},
): WorkspaceSyncNativeProcessLaunchers {
  const platform = dependencies.platform ?? process.platform;
  const spawn = dependencies.spawn ?? nodeSpawn;
  const createManagedChildProcess = dependencies.createManagedChildProcess ?? defaultCreateManagedChildProcess;
  const killProcessTree = dependencies.killProcessTree ?? defaultKillProcessTree;
  const resolveProcessCustodyRuntimeExecutable = dependencies.resolveProcessCustodyRuntimeExecutable
    ?? defaultResolveProcessCustodyRuntimeExecutable;
  const createWindowsJobCustodyName = dependencies.createWindowsJobCustodyName
    ?? defaultCreateWindowsJobCustodyName;
  const createProcessCustodyHandshakePath = dependencies.createProcessCustodyHandshakePath
    ?? defaultCreateProcessCustodyHandshakePath;
  const waitForProcessCustodyHandshake = dependencies.waitForProcessCustodyHandshake
    ?? defaultWaitForProcessCustodyHandshake;
  const removeProcessCustodyHandshakeFile = dependencies.removeProcessCustodyHandshakeFile
    ?? defaultRemoveProcessCustodyHandshakeFile;
  const terminateProcessCustodyByJob = dependencies.terminateProcessCustodyByJob
    ?? defaultTerminateProcessCustodyByJob;
  const logStderr = dependencies.logStderr ?? ((label, byteLength) => {
    logger.debug(`[${label}] stderr drained`, { byteLength });
  });

  const createWindowsCustody = (role: 'sidecar' | 'agent'): ProcessCustodySpawnSpec => {
    const executablePath = resolveProcessCustodyRuntimeExecutable('win32');
    if (!executablePath) {
      throw new Error('Workspace sync native process custody helper is unavailable on Windows');
    }
    return Object.freeze({
      executablePath,
      jobName: createWindowsJobCustodyName(`workspace-sync-${role}-${randomUUID()}`),
      handshakePath: createProcessCustodyHandshakePath(),
    });
  };

  const stopWindowsCustody = async (child: ChildProcess, custody: ProcessCustodySpawnSpec): Promise<void> => {
    const outcome = await terminateProcessCustodyByJob({
      executablePath: custody.executablePath,
      jobName: custody.jobName,
    });
    if (outcome !== 'absent') {
      // Killing the helper closes its last Job Object handle. KILL_ON_JOB_CLOSE
      // then retires the already-contained target and every descendant.
      await killProcessTree(child);
    }
  };

  const retainedNativeProcessStops = new Set<() => Promise<void>>();
  const spawnSidecar: SpawnWorkspaceSyncSidecar = async (input) => {
    assertNativeExecutablePath(input.executablePath);
    const custody = platform === 'win32' ? createWindowsCustody('sidecar') : null;
    const child = spawn(custody?.executablePath ?? input.executablePath, custody
      ? [
          'run',
          `--job=${custody.jobName}`,
          `--handshake=${custody.handshakePath}`,
          '--target-inherited-stdin-arg=--broker-descriptor',
          '--',
          input.executablePath,
          ...withoutBrokerDescriptorArgument(input.args),
        ]
      : [...input.args], {
      detached: platform !== 'win32',
      shell: false,
      stdio: custody ? ['pipe', 'ignore', 'pipe'] : ['ignore', 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stopPromise: Promise<void> | null = null;
    const stop = (): Promise<void> => {
      if (stopPromise) return stopPromise;
      const attempt = custody
        ? stopWindowsCustody(child, custody)
        : killProcessTree(child, processGroupOptions(platform));
      stopPromise = attempt.then(() => {
        retainedNativeProcessStops.delete(stop);
      }, (error: unknown) => {
        stopPromise = null;
        throw error;
      });
      return stopPromise;
    };
    retainedNativeProcessStops.add(stop);

    try {
      const managed = createManagedChildProcess(child);
      if (managed.pid === null) {
        throw new Error('Workspace sync sidecar launch did not provide a process id');
      }
      const custodyFacts = custody
        ? await waitForProcessCustodyHandshake({
            handshakePath: custody.handshakePath,
            jobName: custody.jobName,
          })
        : null;
      if (custody && custodyFacts === null) {
        throw new Error('Workspace sync sidecar Job Object custody could not be established');
      }
      const targetPid = custodyFacts?.pid ?? managed.pid;
      input.onSpawned?.(targetPid);
      const descriptor = custody ? child.stdin : child.stdio[3];
      if (!(descriptor instanceof Writable)) {
        throw new Error('Workspace sync sidecar inherited broker descriptor is unavailable');
      }
      drainStderr(child, 'workspace-sync-sidecar', logStderr);
      await writeAndCloseDescriptor(descriptor, input.inheritedBrokerDescriptor);
      retainedNativeProcessStops.delete(stop);
      return Object.freeze({
        pid: targetPid,
        waitForTermination: managed.waitForTermination,
        stop,
      });
    } catch (error) {
      const cleanupFailures: unknown[] = [];
      if (custody) {
        await removeProcessCustodyHandshakeFile(custody.handshakePath).catch((cleanupError: unknown) => {
          cleanupFailures.push(cleanupError);
        });
      }
      await stop().catch((cleanupError: unknown) => { cleanupFailures.push(cleanupError); });
      if (cleanupFailures.length > 0) {
        throw new AggregateError([error, ...cleanupFailures], 'Workspace sync sidecar launch cleanup failed');
      }
      throw error;
    }
  };

  const launchLocalAgent: LaunchWorkspaceSyncLocalAgent = async (input) => {
    assertNativeExecutablePath(input.executablePath);
    if (input.signal?.aborted) throw createAbortError();
    const custody = platform === 'win32' ? createWindowsCustody('agent') : null;
    const child = spawn(custody?.executablePath ?? input.executablePath, custody
      ? [
          'run',
          `--job=${custody.jobName}`,
          `--handshake=${custody.handshakePath}`,
          '--',
          input.executablePath,
          ...input.args,
        ]
      : [...input.args], {
      detached: platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stopPromise: Promise<void> | null = null;
    const stop = (): Promise<void> => {
      if (stopPromise) return stopPromise;
      const attempt = custody
        ? stopWindowsCustody(child, custody)
        : killProcessTree(child, processGroupOptions(platform));
      stopPromise = attempt.then(() => {
        retainedNativeProcessStops.delete(stop);
      }, (error: unknown) => {
        stopPromise = null;
        throw error;
      });
      return stopPromise;
    };
    retainedNativeProcessStops.add(stop);

    try {
      const managed = createManagedChildProcess(child);
      if (managed.pid === null) {
        throw new Error('Workspace sync local agent launch did not provide a process id');
      }
      if (custody) {
        const custodyFacts = await waitForProcessCustodyHandshake({
          handshakePath: custody.handshakePath,
          jobName: custody.jobName,
          ...(input.signal ? { isAborted: () => input.signal!.aborted } : {}),
        });
        if (custodyFacts === null) {
          throw new Error('Workspace sync local agent Job Object custody could not be established');
        }
      }
      if (!child.stdin || !child.stdout || !child.stderr) {
        throw new Error('Workspace sync local agent stdio pipes are unavailable');
      }
      drainStderr(child, 'workspace-sync-agent', logStderr);
      // Node supports a { readable, writable } pair here at runtime; the
      // retained compiler API declaration does not yet include that overload.
      const stream = Duplex.from({
        readable: child.stdout,
        writable: child.stdin,
      } as unknown as NodeJS.ReadWriteStream);
      const cleanup = (): void => {
        input.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        stream.destroy(createAbortError());
      };
      const termination = managed.waitForTermination();
      void termination.then(cleanup, cleanup);
      stream.once('close', () => {
        cleanup();
        void stop().catch(() => undefined);
      });
      input.signal?.addEventListener('abort', onAbort, { once: true });
      if (input.signal?.aborted) onAbort();
      retainedNativeProcessStops.delete(stop);
      return Object.freeze({
        stream,
        stop,
      });
    } catch (error) {
      const cleanupFailures: unknown[] = [];
      if (custody) {
        await removeProcessCustodyHandshakeFile(custody.handshakePath).catch((cleanupError: unknown) => {
          cleanupFailures.push(cleanupError);
        });
      }
      await stop().catch((cleanupError: unknown) => { cleanupFailures.push(cleanupError); });
      if (cleanupFailures.length > 0) {
        throw new AggregateError([error, ...cleanupFailures], 'Workspace sync local agent launch cleanup failed');
      }
      throw error;
    }
  };

  const stopRetainedNativeProcesses = async (): Promise<void> => {
    const results = await Promise.allSettled([...retainedNativeProcessStops].map(async (stop) => await stop()));
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Workspace sync local agent cleanup failed');
  };

  return Object.freeze({ spawnSidecar, launchLocalAgent, stopRetainedNativeProcesses });
}

const defaultLaunchers = createWorkspaceSyncNativeProcessLaunchers();

export const spawnWorkspaceSyncSidecar = defaultLaunchers.spawnSidecar;
export const launchWorkspaceSyncLocalAgent = defaultLaunchers.launchLocalAgent;
export const stopRetainedWorkspaceSyncNativeProcesses = defaultLaunchers.stopRetainedNativeProcesses;
