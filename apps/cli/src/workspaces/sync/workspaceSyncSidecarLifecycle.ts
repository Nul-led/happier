import { createSupervisedProcess, type SupervisedProcess } from '@/subprocess/supervision/supervisedProcess';
import type { TerminationEvent } from '@/subprocess/supervision/types';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MutagenControlCommandV1 } from './transport/workspaceSyncBrokerProtocol';
import type { WorkspaceSyncBrokerOpenContext } from './transport/workspaceSyncBroker';

export type WorkspaceSyncVerifiedRuntime = Readonly<{
  managerPath: string;
  agentPath: string;
  dataDir: string;
  brokerDir: string;
  manifest: Readonly<{ engineVersion: string; protocolEpoch: string }>;
}>;

export type WorkspaceSyncSidecarBroker = Readonly<{
  /** Strict broker endpoint/identity/secret JSON written only to inherited fd 3. */
  bootstrapDescriptor: Uint8Array;
  setExpectedSidecarPid?(pid: number): void;
  waitForReady(pid: number): Promise<void>;
  command(command: MutagenControlCommandV1, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}>;

export type WorkspaceSyncSidecarProcess = Readonly<{
  pid: number;
  waitForTermination(): Promise<TerminationEvent>;
  stop(): Promise<void>;
}>;

/**
 * The composition root supplies this through the existing managedChildProcess/
 * processCustody spawn owner. `inheritedBrokerDescriptor` is the complete
 * private bootstrap payload on fd/handle 3: implementations must never place
 * it in argv, env, or a file.
 */
export type SpawnWorkspaceSyncSidecar = (input: Readonly<{
  executablePath: string;
  args: readonly string[];
  inheritedBrokerDescriptor: Uint8Array;
  onSpawned?: (pid: number) => void;
  environment?: never;
}>) => Promise<WorkspaceSyncSidecarProcess>;

export type WorkspaceSyncSidecarLifecycleDependencies = Readonly<{
  resolveRuntime(): Promise<WorkspaceSyncVerifiedRuntime>;
  createBroker(input: Readonly<{
    brokerDir: string;
    brokerInstanceId: string;
    launchNonce: string;
    launchSecret: Uint8Array;
    openExternalStream(context: WorkspaceSyncBrokerOpenContext): Promise<NodeJS.ReadWriteStream>;
  }>): Promise<WorkspaceSyncSidecarBroker>;
  openExternalStream(context: WorkspaceSyncBrokerOpenContext): Promise<NodeJS.ReadWriteStream>;
  spawn: SpawnWorkspaceSyncSidecar;
  ensurePrivateDirectory(path: string): Promise<void>;
  randomBytes(length: number): Uint8Array;
  randomId(): string;
  /**
   * Re-runs the daemon-owned settings reconciliation after a replacement
   * sidecar has authenticated. Initial startup is reconciled by the daemon
   * runtime that called start(), so this hook is restart-only.
   */
  onRestartReady(): Promise<void>;
  /** Grace period for the acknowledged sidecar shutdown to exit naturally. */
  shutdownGraceMs?: number;
  /** One deadline for child spawn, authenticated HELLO, and the initial manager probe. */
  startupDeadlineMs?: number;
}>;

export const WORKSPACE_SYNC_SIDECAR_STARTUP_DEADLINE_MS = 15_000;

export class WorkspaceSyncEngineError extends Error {
  constructor(readonly code: 'engine_unavailable', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkspaceSyncEngineError';
  }
}

type Readiness = Readonly<{
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}>;

function readiness(): Readiness {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function engineUnavailable(error: unknown): WorkspaceSyncEngineError {
  if (error instanceof WorkspaceSyncEngineError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new WorkspaceSyncEngineError('engine_unavailable', `Workspace sync engine unavailable: ${message}`, {
    cause: error,
  });
}

export class WorkspaceSyncSidecarLifecycle {
  private readonly supervisor: SupervisedProcess;
  private readonly reconciliationContext = new AsyncLocalStorage<boolean>();
  private spawnAttempt: Promise<Readonly<{ pid: number; waitForTermination(): Promise<TerminationEvent> }>> | null = null;
  private stopAttempt: Promise<void> | null = null;
  private lateSpawnSettlement: Promise<void> | null = null;
  private lateSpawnProcess: WorkspaceSyncSidecarProcess | null = null;
  private activeProcess: WorkspaceSyncSidecarProcess | null = null;
  private activeBroker: WorkspaceSyncSidecarBroker | null = null;
  private currentReadiness: Readiness | null = null;
  private currentAuthenticatedReadiness: Readiness | null = null;
  private authenticated = false;
  private ready = false;
  private stopping = false;
  private completedInitialStart = false;

  constructor(private readonly dependencies: WorkspaceSyncSidecarLifecycleDependencies) {
    this.supervisor = createSupervisedProcess({
      id: 'workspace-sync-mutagen-sidecar',
      policy: {
        kind: 'other',
        restart: { mode: 'on_unexpected_exit', maxRestarts: 5, baseDelayMs: 250, maxDelayMs: 10_000, jitterMs: 250 },
        logging: { logTerminationEvents: true },
        artifacts: { captureStderr: true, stderrLabel: 'workspace-sync-mutagen' },
        terminateGraceMs: 5_000,
      },
      spawn: () => {
        const attempt = this.spawnOne();
        const tracked = attempt.finally(() => {
          if (this.spawnAttempt === tracked) this.spawnAttempt = null;
        });
        this.spawnAttempt = tracked;
        return tracked;
      },
      onTermination: async (event) => await this.onTermination(event),
    });
  }

  async start(): Promise<void> {
    if (this.stopping) throw engineUnavailable(new Error('sidecar lifecycle is stopping'));
    if (this.reconciliationContext.getStore() === true) {
      if (this.authenticated && this.activeProcess) return;
      if (!this.currentAuthenticatedReadiness) this.currentAuthenticatedReadiness = readiness();
      const pending = this.currentAuthenticatedReadiness.promise;
      this.supervisor.start();
      await pending;
      return;
    }
    if (this.ready && this.activeProcess) return;
    if (!this.currentReadiness) this.currentReadiness = readiness();
    const pending = this.currentReadiness.promise;
    this.supervisor.start();
    await pending;
  }

  async runReconciliation<T>(action: () => Promise<T>): Promise<T> {
    return await this.reconciliationContext.run(true, action);
  }

  async stop(): Promise<void> {
    if (this.stopAttempt) return await this.stopAttempt;
    this.stopping = true;
    const attempt = this.stopOwnedResources();
    this.stopAttempt = attempt;
    try {
      await attempt;
    } catch (error) {
      if (this.stopAttempt === attempt) this.stopAttempt = null;
      throw error;
    }
  }

  private async stopOwnedResources(): Promise<void> {
    const cleanupFailures: unknown[] = [];
    const spawnAttempt = this.spawnAttempt;
    this.supervisor.markStopRequested({ reason: 'shutdown', requestedAtMs: Date.now() });
    const broker = this.activeBroker;
    const process = this.activeProcess;
    if (this.activeBroker === broker) this.activeBroker = null;
    if (this.activeProcess === process) this.activeProcess = null;
    if (broker) {
      await broker.command({ t: 'shutdown', requestId: this.dependencies.randomId() }).catch((error: unknown) => {
        cleanupFailures.push(error);
      });
    }
    if (process) {
      const graceMs = this.dependencies.shutdownGraceMs ?? 5_000;
      let exitedNaturally = false;
      let processStopped = false;
      if (graceMs > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        exitedNaturally = await Promise.race([
          process.waitForTermination().then(
            () => true,
            (error: unknown) => { cleanupFailures.push(error); return false; },
          ),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), graceMs); }),
        ]);
        if (timer !== undefined) clearTimeout(timer);
      }
      if (!exitedNaturally) {
        await process.stop().then(
          () => { processStopped = true; },
          (error: unknown) => { cleanupFailures.push(error); },
        );
      }
      if (!exitedNaturally && !processStopped && this.activeProcess === null) this.activeProcess = process;
    }
    if (broker) {
      let brokerClosed = false;
      await broker.close().then(
        () => { brokerClosed = true; },
        (error: unknown) => { cleanupFailures.push(error); },
      );
      if (!brokerClosed && this.activeBroker === null) this.activeBroker = broker;
    }
    await spawnAttempt?.catch(() => undefined);
    const lateSpawnSettlement = this.lateSpawnSettlement;
    if (lateSpawnSettlement) {
      if (this.lateSpawnProcess) {
        await lateSpawnSettlement.catch((error: unknown) => { cleanupFailures.push(error); });
      } else {
        cleanupFailures.push(engineUnavailable(new Error('late sidecar spawn cleanup is pending')));
      }
    } else if (this.lateSpawnProcess) {
      await this.stopLateSpawnProcess().catch((error: unknown) => { cleanupFailures.push(error); });
    }
    const unavailable = engineUnavailable(new Error('sidecar lifecycle stopped'));
    this.currentReadiness?.reject(unavailable);
    this.currentAuthenticatedReadiness?.reject(unavailable);
    this.ready = false;
    this.authenticated = false;
    this.currentReadiness = null;
    this.currentAuthenticatedReadiness = null;
    this.supervisor.dispose();
    if (cleanupFailures.length === 1) throw cleanupFailures[0];
    if (cleanupFailures.length > 1) {
      throw new AggregateError(cleanupFailures, 'Workspace sync sidecar cleanup failed');
    }
  }

  private async stopLateSpawnProcess(): Promise<void> {
    const process = this.lateSpawnProcess;
    if (!process) return;
    await process.stop();
    if (this.lateSpawnProcess === process) this.lateSpawnProcess = null;
  }

  private retainLateSpawn(spawn: Promise<WorkspaceSyncSidecarProcess>): void {
    const settlement = spawn.then(async (lateProcess) => {
      this.lateSpawnProcess = lateProcess;
      await this.stopLateSpawnProcess();
    }, () => undefined);
    this.lateSpawnSettlement = settlement;
    void settlement.finally(() => {
      if (this.lateSpawnSettlement === settlement) this.lateSpawnSettlement = null;
    }).catch(() => undefined);
  }

  async command(command: MutagenControlCommandV1, signal?: AbortSignal): Promise<unknown> {
    await this.start();
    const broker = this.activeBroker;
    if (!broker) throw engineUnavailable(new Error('sidecar broker is unavailable'));
    return await broker.command(command, signal);
  }

  private async spawnOne(): Promise<Readonly<{ pid: number; waitForTermination(): Promise<TerminationEvent> }>> {
    if (this.activeProcess) throw engineUnavailable(new Error('a workspace sync sidecar is already active'));
    let broker: WorkspaceSyncSidecarBroker | null = null;
    let process: WorkspaceSyncSidecarProcess | null = null;
    try {
      const runtime = await this.dependencies.resolveRuntime();
      this.assertNotStopping();
      await this.dependencies.ensurePrivateDirectory(runtime.dataDir);
      this.assertNotStopping();
      await this.dependencies.ensurePrivateDirectory(runtime.brokerDir);
      this.assertNotStopping();
      const launchSecret = this.dependencies.randomBytes(32);
      if (launchSecret.byteLength !== 32) throw new Error('sidecar launch secret must be 32 bytes');
      broker = await this.dependencies.createBroker({
        brokerDir: runtime.brokerDir,
        brokerInstanceId: this.dependencies.randomId(),
        launchNonce: this.dependencies.randomId(),
        launchSecret,
        openExternalStream: this.dependencies.openExternalStream,
      });
      this.assertNotStopping();
      const startupDeadlineMs = this.dependencies.startupDeadlineMs
        ?? WORKSPACE_SYNC_SIDECAR_STARTUP_DEADLINE_MS;
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      const startupDeadline = new Promise<never>((_resolve, reject) => {
        startupTimer = setTimeout(
          () => reject(new Error('sidecar startup deadline exceeded')),
          startupDeadlineMs,
        );
        startupTimer.unref();
      });
      let termination!: Promise<TerminationEvent>;
      try {
        const spawn = this.dependencies.spawn({
          executablePath: runtime.managerPath,
          args: ['--daemon', '--data-directory', runtime.dataDir, '--broker-descriptor', '3'],
          inheritedBrokerDescriptor: broker.bootstrapDescriptor,
          onSpawned: (pid) => broker?.setExpectedSidecarPid?.(pid),
        });
        try {
          process = await Promise.race([spawn, startupDeadline]);
        } catch (error) {
          this.retainLateSpawn(spawn);
          throw error;
        }
        this.assertNotStopping();
        termination = process.waitForTermination();
        const startup = (async () => {
          await broker.waitForReady(process.pid);
          await broker.command({ t: 'list', requestId: this.dependencies.randomId(), limit: 100 });
        })();
        await Promise.race([
          startup,
          termination.then((event) => {
            throw new Error(`sidecar terminated before readiness: ${JSON.stringify(event)}`);
          }),
          startupDeadline,
        ]);
      } finally {
        if (startupTimer !== undefined) clearTimeout(startupTimer);
      }
      this.assertNotStopping();
      this.activeBroker = broker;
      this.activeProcess = process;
      this.authenticated = true;
      this.currentAuthenticatedReadiness?.resolve();
      this.currentAuthenticatedReadiness = null;
      const isRestart = this.completedInitialStart;
      // The controller reconciliation owner calls lifecycle.start()/command().
      // Let only that async reconciliation chain use this authenticated broker;
      // unrelated callers continue waiting for public readiness.
      if (isRestart) {
        await this.runReconciliation(async () => await this.dependencies.onRestartReady());
      }
      this.ready = true;
      this.completedInitialStart = true;
      this.supervisor.markStable();
      this.currentReadiness?.resolve();
      this.currentReadiness = null;
      return { pid: process.pid, waitForTermination: async () => await termination };
    } catch (error) {
      if (process) {
        await process.stop().then(
          () => { if (this.activeProcess === process) this.activeProcess = null; },
          () => { this.activeProcess = process; },
        );
      }
      if (broker) {
        await broker.close().then(
          () => { if (this.activeBroker === broker) this.activeBroker = null; },
          () => { this.activeBroker = broker; },
        );
      }
      this.ready = false;
      this.authenticated = false;
      const unavailable = engineUnavailable(error);
      this.currentReadiness?.reject(unavailable);
      this.currentAuthenticatedReadiness?.reject(unavailable);
      this.currentReadiness = null;
      this.currentAuthenticatedReadiness = null;
      throw unavailable;
    }
  }

  private assertNotStopping(): void {
    if (this.stopping) throw new Error('sidecar lifecycle is stopping');
  }

  private async onTermination(event: TerminationEvent): Promise<void> {
    const broker = this.activeBroker;
    this.activeBroker = null;
    this.activeProcess = null;
    this.ready = false;
    this.authenticated = false;
    await broker?.close();
    if (!this.stopping && event.type === 'spawn_error') {
      const error = engineUnavailable(new Error(event.errorMessage));
      this.currentReadiness?.reject(error);
      this.currentReadiness = null;
    }
  }
}
