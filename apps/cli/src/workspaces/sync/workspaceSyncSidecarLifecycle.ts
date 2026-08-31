import { createSupervisedProcess, type SupervisedProcess } from '@/subprocess/supervision/supervisedProcess';
import type { TerminationEvent } from '@/subprocess/supervision/types';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MutagenControlCommandV1 } from './transport/workspaceSyncBrokerProtocol';
import type { WorkspaceSyncBrokerOpenContext } from './transport/workspaceSyncBroker';
import type { Duplex } from 'node:stream';

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
    openExternalStream(context: WorkspaceSyncBrokerOpenContext): Promise<Duplex>;
  }>): Promise<WorkspaceSyncSidecarBroker>;
  openExternalStream(context: WorkspaceSyncBrokerOpenContext): Promise<Duplex>;
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
}>;

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
      spawn: async () => await this.spawnOne(),
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
    if (this.stopping) return;
    this.stopping = true;
    this.supervisor.markStopRequested({ reason: 'shutdown', requestedAtMs: Date.now() });
    const broker = this.activeBroker;
    const process = this.activeProcess;
    this.activeProcess = null;
    this.activeBroker = null;
    if (broker) {
      await broker.command({ t: 'shutdown', requestId: this.dependencies.randomId() }).catch(() => undefined);
    }
    await process?.stop().catch(() => undefined);
    await broker?.close().catch(() => undefined);
    const unavailable = engineUnavailable(new Error('sidecar lifecycle stopped'));
    this.currentReadiness?.reject(unavailable);
    this.currentAuthenticatedReadiness?.reject(unavailable);
    this.ready = false;
    this.authenticated = false;
    this.currentReadiness = null;
    this.currentAuthenticatedReadiness = null;
    this.supervisor.dispose();
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
      await this.dependencies.ensurePrivateDirectory(runtime.dataDir);
      await this.dependencies.ensurePrivateDirectory(runtime.brokerDir);
      const launchSecret = this.dependencies.randomBytes(32);
      if (launchSecret.byteLength !== 32) throw new Error('sidecar launch secret must be 32 bytes');
      broker = await this.dependencies.createBroker({
        brokerDir: runtime.brokerDir,
        brokerInstanceId: this.dependencies.randomId(),
        launchNonce: this.dependencies.randomId(),
        launchSecret,
        openExternalStream: this.dependencies.openExternalStream,
      });
      process = await this.dependencies.spawn({
        executablePath: runtime.managerPath,
        args: ['--daemon', '--data-directory', runtime.dataDir, '--broker-descriptor', '3'],
        inheritedBrokerDescriptor: broker.bootstrapDescriptor,
        onSpawned: (pid) => broker?.setExpectedSidecarPid?.(pid),
      });
      this.activeBroker = broker;
      this.activeProcess = process;
      await broker.waitForReady(process.pid);
      await broker.command({ t: 'list', requestId: this.dependencies.randomId() });
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
      this.currentReadiness?.resolve();
      this.currentReadiness = null;
      return { pid: process.pid, waitForTermination: process.waitForTermination };
    } catch (error) {
      await process?.stop().catch(() => undefined);
      await broker?.close().catch(() => undefined);
      this.activeProcess = null;
      this.activeBroker = null;
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

  private async onTermination(event: TerminationEvent): Promise<void> {
    const broker = this.activeBroker;
    this.activeBroker = null;
    this.activeProcess = null;
    this.ready = false;
    this.authenticated = false;
    await broker?.close().catch(() => undefined);
    if (!this.stopping && event.type === 'spawn_error') {
      const error = engineUnavailable(new Error(event.errorMessage));
      this.currentReadiness?.reject(error);
      this.currentReadiness = null;
    }
  }
}
