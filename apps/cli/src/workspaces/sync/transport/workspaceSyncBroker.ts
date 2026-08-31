import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { connect as netConnect, createServer, type Server, type Socket } from 'node:net';

import {
  BrokerControlFrameDecoder,
  BrokerProtocolError,
  BrokerRequestStateMachine,
  createBrokerHelloOkProof,
  createBrokerHelloProof,
  encodeBrokerControlFrame,
  isBrokerTerminalErrorCode,
  MAX_CONCURRENT_DATA_STREAMS,
  OPEN_REMOTE_DEADLINE_MS,
  type BrokerControlV1,
  type BrokerTerminalErrorCode,
  type MutagenControlCommandV1,
  verifyBrokerProof,
  WORKSPACE_SYNC_BROKER_ATTACH_TTL_MS,
  WORKSPACE_SYNC_BROKER_COMMAND_DEADLINE_MS,
} from './workspaceSyncBrokerProtocol';

export interface WorkspaceSyncBrokerOpenContext {
  endpointId: string;
  requestId: string;
  expiresAtMs: number;
  signal: AbortSignal;
}

export interface WorkspaceSyncBrokerPeerIdentityContext {
  kind: 'control' | 'data';
  socket: Socket;
  sidecarPid?: number;
}

export interface WorkspaceSyncBrokerConfig {
  socketPath: string;
  brokerInstanceId?: string;
  launchNonce?: string;
  launchSecret: Uint8Array;
  expectedSidecarPid?: number;
  maxStreams?: number;
  now?: () => number;
  validatePeerIdentity?: (context: WorkspaceSyncBrokerPeerIdentityContext) => boolean | Promise<boolean>;
  openExternalStream: (context: WorkspaceSyncBrokerOpenContext) => Promise<NodeJS.ReadWriteStream>;
}

export interface WorkspaceSyncBrokerEndpoint {
  readonly endpointPath: string;
  readonly kind: 'unix' | 'named_pipe';
  connect(path?: string): Socket;
  listen(server: Server, path?: string): Promise<void>;
  secure(path?: string): Promise<void>;
  remove(path?: string): Promise<void>;
}

export function createWorkspaceSyncBrokerEndpoint(input: Readonly<{
  endpointPath: string;
  platform?: NodeJS.Platform;
}>): WorkspaceSyncBrokerEndpoint {
  const isWindows = (input.platform ?? process.platform) === 'win32';
  const endpointPath = isWindows && !input.endpointPath.startsWith('\\\\.\\pipe\\')
    ? `\\\\.\\pipe\\happier-workspace-sync-${Buffer.from(input.endpointPath).toString('hex').slice(-48)}`
    : input.endpointPath;
  return {
    endpointPath,
    kind: isWindows ? 'named_pipe' : 'unix',
    connect: (path = endpointPath) => netConnect(path),
    listen: (server, path = endpointPath) => new Promise<void>((resolve, reject) => {
      if (isWindows) {
        reject(new Error(
          'Windows workspace-sync named pipes require a native user-only security descriptor before listening',
        ));
        return;
      }
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(path);
    }),
    secure: async (path = endpointPath) => {
      if (!isWindows) await chmod(path, 0o600);
    },
    remove: async (path = endpointPath) => {
      if (!isWindows) await rm(path, { force: true });
    },
  };
}

type PendingStream = {
  requestId: string;
  streamId: string;
  attachNonce: string;
  expiresAtMs: number;
  control: Socket;
  data?: Socket;
  dataCandidate?: Socket;
  external?: NodeJS.ReadWriteStream;
  dataEndpoint?: WorkspaceSyncBrokerEndpoint;
  dataServer?: Server;
  openTimer?: NodeJS.Timeout;
  attachTimer?: NodeJS.Timeout;
  openController: AbortController;
  dataReady: Promise<boolean>;
  resolveDataReady: (accepted: boolean) => void;
  attachRequested: boolean;
  attached: boolean;
  terminalSent: boolean;
  closed: boolean;
  state: BrokerRequestStateMachine;
};

type PendingCommand = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  abortCleanup?: () => void;
};

function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function typedError(error: unknown, fallback: BrokerTerminalErrorCode, message: string): BrokerProtocolError {
  if (error instanceof BrokerProtocolError) return error;
  if (typeof error === 'object' && error !== null && 'code' in error && isBrokerTerminalErrorCode(error.code)) {
    return new BrokerProtocolError(error.code, error instanceof Error ? error.message : message);
  }
  return new BrokerProtocolError(fallback, message);
}

function errorFromFrame(frame: Extract<BrokerControlV1, { t: 'error' }>): BrokerProtocolError {
  return new BrokerProtocolError(
    isBrokerTerminalErrorCode(frame.code) ? frame.code : 'protocol_error',
    frame.message,
  );
}

export class WorkspaceSyncBroker {
  readonly brokerInstanceId: string;
  readonly socketPath: string;
  readonly whenReady: Promise<void>;

  private launchNonceValue: string;
  private launchSecret: Buffer;
  private readonly server: Server;
  private readonly endpoint: WorkspaceSyncBrokerEndpoint;
  private readonly config: WorkspaceSyncBrokerConfig & { now: () => number; maxStreams: number };
  private readonly pending = new Map<string, PendingStream>();
  private readonly activeRequestIds = new Set<string>();
  private readonly commands = new Map<string, PendingCommand>();
  private readonly controlSockets = new Set<Socket>();
  private authenticatedControl: Socket | undefined;
  private authenticatedSidecarPidValue: number | undefined;
  private readyResolve!: () => void;
  private closed = false;

  private constructor(
    config: WorkspaceSyncBrokerConfig,
    endpoint: WorkspaceSyncBrokerEndpoint,
    server: Server,
    brokerInstanceId: string,
    launchNonce: string,
  ) {
    this.config = {
      ...config,
      now: config.now ?? Date.now,
      maxStreams: Math.min(config.maxStreams ?? MAX_CONCURRENT_DATA_STREAMS, MAX_CONCURRENT_DATA_STREAMS),
    };
    this.endpoint = endpoint;
    this.server = server;
    this.brokerInstanceId = brokerInstanceId;
    this.launchNonceValue = launchNonce;
    this.launchSecret = Buffer.from(config.launchSecret);
    this.socketPath = endpoint.endpointPath;
    this.whenReady = new Promise<void>((resolve) => { this.readyResolve = resolve; });
  }

  get launchNonce(): string { return this.launchNonceValue; }
  get authenticatedSidecarPid(): number | undefined { return this.authenticatedSidecarPidValue; }

  static async listen(config: WorkspaceSyncBrokerConfig): Promise<WorkspaceSyncBroker> {
    if (!config.socketPath || config.launchSecret.byteLength !== 32) throw new Error('invalid broker configuration');
    if (config.expectedSidecarPid !== undefined && (!Number.isSafeInteger(config.expectedSidecarPid) || config.expectedSidecarPid < 1)) {
      throw new Error('invalid expected sidecar pid');
    }
    if (process.platform !== 'win32') {
      await mkdir(dirname(config.socketPath), { recursive: true, mode: 0o700 });
      await chmod(dirname(config.socketPath), 0o700);
    }
    const endpoint = createWorkspaceSyncBrokerEndpoint({ endpointPath: config.socketPath });
    await endpoint.remove();
    const server = createServer();
    const broker = new WorkspaceSyncBroker(
      config,
      endpoint,
      server,
      config.brokerInstanceId ?? randomUUID(),
      config.launchNonce ?? randomUUID(),
    );
    server.on('connection', (socket) => { void broker.handleControl(socket); });
    await endpoint.listen(server);
    await endpoint.secure();
    return broker;
  }

  rotateLaunchCredential(): Readonly<{ launchNonce: string; launchSecret: Buffer }> {
    this.launchNonceValue = randomUUID();
    this.launchSecret.fill(0);
    this.launchSecret = randomBytes(32);
    const staleControl = this.authenticatedControl;
    this.authenticatedControl = undefined;
    this.authenticatedSidecarPidValue = undefined;
    this.failCommands(new BrokerProtocolError('indeterminate', 'sidecar command outcome is unknown after launch credential rotation'));
    for (const stream of [...this.pending.values()]) this.closePending(stream);
    staleControl?.destroy();
    return { launchNonce: this.launchNonceValue, launchSecret: Buffer.from(this.launchSecret) };
  }

  hasInFlightCommands(): boolean { return this.commands.size > 0; }

  command(
    command: MutagenControlCommandV1,
    options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
  ): Promise<unknown> {
    const control = this.authenticatedControl;
    if (!control || control.destroyed) {
      return Promise.reject(new BrokerProtocolError('agent_unavailable', 'workspace sync sidecar unavailable'));
    }
    if (this.commands.has(command.requestId)) {
      return Promise.reject(new BrokerProtocolError('protocol_error', 'duplicate command request id'));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new BrokerProtocolError('cancelled', 'command cancelled'));
    }
    const timeoutMs = Math.min(options.timeoutMs ?? WORKSPACE_SYNC_BROKER_COMMAND_DEADLINE_MS, WORKSPACE_SYNC_BROKER_COMMAND_DEADLINE_MS);
    return new Promise<unknown>((resolve, reject) => {
      let dispatched = false;
      const fail = (error: Error, sendCancel: boolean) => {
        const pending = this.commands.get(command.requestId);
        if (!pending) return;
        this.commands.delete(command.requestId);
        clearTimeout(pending.timer);
        pending.abortCleanup?.();
        if (sendCancel && this.authenticatedControl === control && !control.destroyed) {
          this.send(control, { t: 'cancel', requestId: command.requestId });
        }
        reject(error);
      };
      const timer = setTimeout(() => fail(new BrokerProtocolError('indeterminate', 'sidecar command timed out'), true), timeoutMs);
      timer.unref();
      const abort = () => fail(
        new BrokerProtocolError(
          dispatched ? 'indeterminate' : 'cancelled',
          dispatched ? 'sidecar command outcome is unknown after cancellation' : 'command cancelled',
        ),
        dispatched,
      );
      const abortCleanup = options.signal ? () => options.signal?.removeEventListener('abort', abort) : undefined;
      options.signal?.addEventListener('abort', abort, { once: true });
      this.commands.set(command.requestId, { resolve, reject, timer, abortCleanup });
      try {
        this.send(control, { t: 'command', requestId: command.requestId, command });
        dispatched = true;
      } catch (error) {
        fail(typedError(error, 'agent_unavailable', 'workspace sync sidecar unavailable'), false);
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const socket of this.controlSockets) socket.destroy();
    for (const stream of [...this.pending.values()]) this.closePending(stream);
    this.failCommands(new BrokerProtocolError('indeterminate', 'sidecar command outcome is unknown after broker close'));
    await closeServer(this.server);
    await this.endpoint.remove();
  }

  private async validatePeer(kind: 'control' | 'data', socket: Socket, sidecarPid?: number): Promise<boolean> {
    try {
      return await (this.config.validatePeerIdentity?.({ kind, socket, sidecarPid }) ?? true);
    } catch {
      return false;
    }
  }

  private send(socket: Socket, message: BrokerControlV1): void {
    socket.write(encodeBrokerControlFrame(message));
  }

  private async handleControl(socket: Socket): Promise<void> {
    this.controlSockets.add(socket);
    socket.setNoDelay(true);
    const decoder = new BrokerControlFrameDecoder();
    let authenticated = false;
    let processing = Promise.resolve();
    let terminating = false;
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      for (const stream of [...this.pending.values()]) if (stream.control === socket) this.closePending(stream);
      if (this.authenticatedControl === socket) {
        this.authenticatedControl = undefined;
        this.authenticatedSidecarPidValue = undefined;
        this.failCommands(new BrokerProtocolError('indeterminate', 'sidecar command outcome is unknown after disconnect'));
      }
      this.controlSockets.delete(socket);
      if (!socket.destroyed) socket.destroy();
    };
    socket.once('error', terminate);
    socket.once('close', terminate);
    socket.on('data', (chunk) => {
      let messages: BrokerControlV1[];
      try {
        messages = decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      } catch {
        this.sendError(socket, undefined, 'malformed_control', 'invalid control frame');
        terminate();
        return;
      }
      for (const message of messages) {
        processing = processing.then(async () => {
          if (terminating) return;
          if (!authenticated) {
            if (message.t !== 'hello'
              || this.closed
              || this.authenticatedControl !== undefined
              || message.brokerInstanceId !== this.brokerInstanceId
              || message.launchNonce !== this.launchNonceValue
              || this.config.expectedSidecarPid !== undefined && message.sidecarPid !== this.config.expectedSidecarPid
              || !await this.validatePeer('control', socket, message.sidecarPid)
              || !verifyBrokerProof(createBrokerHelloProof(this.launchSecret, message), message.proof)) {
              this.sendError(socket, undefined, 'unauthorized', 'hello authentication failed');
              terminate();
              return;
            }
            authenticated = true;
            this.authenticatedControl = socket;
            this.authenticatedSidecarPidValue = message.sidecarPid;
            this.send(socket, {
              t: 'hello_ok', protocol: 1, brokerInstanceId: this.brokerInstanceId,
              proof: createBrokerHelloOkProof(this.launchSecret, message),
            });
            this.readyResolve();
            return;
          }
          this.handleMessage(socket, message);
        }).catch(() => terminate());
      }
    });
  }

  private handleMessage(socket: Socket, message: BrokerControlV1): void {
    switch (message.t) {
      case 'open_data': this.openData(socket, message); return;
      case 'attach_data': this.attachData(socket, message); return;
      case 'cancel': {
        const stream = [...this.pending.values()].find((item) => item.requestId === message.requestId && item.control === socket);
        if (stream) {
          stream.openController.abort(new BrokerProtocolError('cancelled', 'request cancelled'));
          this.failPending(stream, 'cancelled', 'request cancelled');
        }
        return;
      }
      case 'close': {
        const stream = [...this.pending.values()].find((item) => item.requestId === message.requestId && item.control === socket);
        if (stream) this.closePending(stream);
        this.send(socket, { t: 'close_ok', requestId: message.requestId });
        return;
      }
      case 'result': this.settleCommand(message.requestId, message.result); return;
      case 'error':
        if (message.requestId && this.commands.has(message.requestId)) {
          this.settleCommand(message.requestId, undefined, errorFromFrame(message));
          return;
        }
        break;
      default: break;
    }
    this.sendError(socket, 'requestId' in message ? message.requestId : undefined, 'protocol_error', 'unexpected control message');
  }

  private openData(socket: Socket, message: Extract<BrokerControlV1, { t: 'open_data' }>): void {
    const now = this.config.now();
    if (this.pending.size >= this.config.maxStreams) {
      this.sendError(socket, message.requestId, 'stream_limit', 'stream limit reached'); return;
    }
    if (this.activeRequestIds.has(message.requestId)) {
      this.sendError(socket, message.requestId, 'protocol_error', 'duplicate request id'); return;
    }
    if (message.expiresAtMs <= now || message.expiresAtMs > now + OPEN_REMOTE_DEADLINE_MS) {
      this.sendError(socket, message.requestId, 'expired_request', 'invalid request deadline'); return;
    }
    if (!/^ws1_[a-z2-7]{32}$/u.test(message.endpointId)) {
      this.sendError(socket, message.requestId, 'relationship_not_owned', 'unknown opaque endpoint'); return;
    }
    this.activeRequestIds.add(message.requestId);
    let resolveDataReady!: (accepted: boolean) => void;
    const dataReady = new Promise<boolean>((resolve) => { resolveDataReady = resolve; });
    const stream: PendingStream = {
      requestId: message.requestId,
      streamId: randomUUID(),
      attachNonce: randomBytes(24).toString('base64url'),
      expiresAtMs: Math.min(message.expiresAtMs, now + WORKSPACE_SYNC_BROKER_ATTACH_TTL_MS),
      control: socket,
      dataReady,
      resolveDataReady,
      openController: new AbortController(),
      attachRequested: false,
      attached: false,
      terminalSent: false,
      closed: false,
      state: new BrokerRequestStateMachine(),
    };
    stream.state.transition('CONTROL_AUTHENTICATING');
    stream.state.transition('CONTROL_READY');
    stream.state.transition('OPEN_VALIDATING');
    stream.state.transition('REMOTE_OPENING');
    this.pending.set(stream.streamId, stream);
    stream.openTimer = setTimeout(() => {
      if (stream.closed) return;
      const error = new BrokerProtocolError('expired_request', 'external stream open timed out');
      stream.openController.abort(error);
      this.failPending(stream, error.code, error.message);
    }, Math.max(1, message.expiresAtMs - now));
    stream.openTimer.unref();
    void this.completeOpenData(stream, message);
  }

  private async completeOpenData(
    stream: PendingStream,
    message: Extract<BrokerControlV1, { t: 'open_data' }>,
  ): Promise<void> {
    const socket = stream.control;
    try {
      const external = await this.config.openExternalStream({
        endpointId: message.endpointId,
        requestId: message.requestId,
        expiresAtMs: message.expiresAtMs,
        signal: stream.openController.signal,
      });
      clearTimeout(stream.openTimer);
      if (stream.closed) {
        if ('destroy' in external && typeof external.destroy === 'function') external.destroy();
        return;
      }
      stream.external = external;
      stream.state.transition('DATA_ATTACH_PENDING');
      const dataPath = process.platform === 'win32'
        ? `${this.socketPath}-data-${stream.streamId}`
        : join(dirname(this.socketPath), `d-${stream.streamId}.sock`);
      const dataEndpoint = createWorkspaceSyncBrokerEndpoint({ endpointPath: dataPath });
      await dataEndpoint.remove();
      const dataServer = createServer({ allowHalfOpen: true }, (data) => { void this.acceptData(stream, data); });
      stream.dataEndpoint = dataEndpoint;
      stream.dataServer = dataServer;
      await dataEndpoint.listen(dataServer);
      await dataEndpoint.secure();
      if (stream.closed) {
        await closeServer(dataServer);
        await dataEndpoint.remove();
        return;
      }
      this.send(socket, {
        t: 'data_ready', requestId: message.requestId, streamId: stream.streamId,
        dataEndpoint: dataEndpoint.endpointPath, attachNonce: stream.attachNonce, expiresAtMs: stream.expiresAtMs,
      });
      stream.attachTimer = setTimeout(() => {
        if (!stream.attached && !stream.closed) {
          this.failPending(stream, 'data_attach_failed', 'data attachment expired');
        }
      }, Math.max(1, stream.expiresAtMs - this.config.now()));
      stream.attachTimer.unref();
    } catch (error) {
      clearTimeout(stream.openTimer);
      if (stream.closed) return;
      const failure = typedError(error, 'peer_unavailable', 'external stream unavailable');
      this.failPending(stream, failure.code, failure.message);
    }
  }

  private async acceptData(stream: PendingStream, data: Socket): Promise<void> {
    if (stream.closed || stream.data || stream.dataCandidate) {
      data.destroy();
      return;
    }
    stream.dataCandidate = data;
    const valid = await this.validatePeer('data', data, this.authenticatedSidecarPidValue);
    if (stream.closed || stream.dataCandidate !== data || !valid) {
      if (stream.dataCandidate === data) stream.dataCandidate = undefined;
      data.destroy();
      if (!stream.closed && !valid) stream.resolveDataReady(false);
      return;
    }
    stream.dataCandidate = undefined;
    stream.data = data;
    data.setNoDelay(true);
    data.once('error', () => this.closePending(stream));
    stream.resolveDataReady(true);
    await closeServer(stream.dataServer);
  }

  private attachData(socket: Socket, message: Extract<BrokerControlV1, { t: 'attach_data' }>): void {
    const stream = this.pending.get(message.streamId);
    if (!stream || stream.control !== socket || stream.attachNonce !== message.attachNonce) {
      this.sendError(socket, undefined, 'unauthorized', 'invalid data attachment'); return;
    }
    if (stream.attachRequested) {
      this.sendError(socket, stream.requestId, 'data_attach_failed', 'data attachment already consumed'); return;
    }
    stream.attachRequested = true;
    void this.completeAttachData(stream);
  }

  private async completeAttachData(stream: PendingStream): Promise<void> {
    const socket = stream.control;
    const dataAccepted = await stream.dataReady;
    if (stream.closed) return;
    if (!dataAccepted || stream.expiresAtMs <= this.config.now() || !stream.data) {
      this.failPending(stream, 'data_attach_failed', 'data attachment unavailable');
      return;
    }
    stream.attached = true;
    clearTimeout(stream.attachTimer);
    stream.state.transition('STREAMING');
    this.pipe(stream);
    this.send(socket, { t: 'data_ok', streamId: stream.streamId });
  }

  private pipe(stream: PendingStream): void {
    const { data, external } = stream;
    if (!data || !external) return;
    data.pipe(external, { end: false });
    external.pipe(data, { end: false });
    data.once('end', () => { if (typeof external.end === 'function') external.end(); });
    external.once('end', () => { if (!data.destroyed) data.end(); });
    data.once('close', () => this.closePending(stream));
    external.once('close', () => this.closePending(stream));
    external.once('error', () => this.closePending(stream));
  }

  private sendError(socket: Socket, requestId: string | undefined, code: string, message: string): void {
    if (socket.destroyed) return;
    this.send(socket, requestId === undefined ? { t: 'error', code, message } : { t: 'error', requestId, code, message });
  }

  private failPending(stream: PendingStream, code: BrokerTerminalErrorCode, message: string): void {
    if (stream.closed || stream.terminalSent) return;
    stream.terminalSent = true;
    this.sendError(stream.control, stream.requestId, code, message);
    this.closePending(stream);
  }

  private closePending(stream: PendingStream): void {
    if (stream.closed) return;
    stream.closed = true;
    if (!stream.openController.signal.aborted) {
      stream.openController.abort(new BrokerProtocolError('cancelled', 'request closed'));
    }
    stream.resolveDataReady(false);
    clearTimeout(stream.openTimer);
    clearTimeout(stream.attachTimer);
    if (stream.state.state !== 'CLOSED') {
      if (stream.state.state !== 'CLOSING') stream.state.transition('CLOSING');
      stream.state.transition('CLOSED');
    }
    void closeServer(stream.dataServer);
    stream.dataCandidate?.destroy();
    stream.data?.destroy();
    if (stream.external && 'destroy' in stream.external && typeof stream.external.destroy === 'function') stream.external.destroy();
    if (stream.dataEndpoint) void stream.dataEndpoint.remove();
    this.pending.delete(stream.streamId);
    this.activeRequestIds.delete(stream.requestId);
  }

  private settleCommand(requestId: string, result: unknown, error?: Error): void {
    const command = this.commands.get(requestId);
    if (!command) return;
    this.commands.delete(requestId);
    clearTimeout(command.timer);
    command.abortCleanup?.();
    if (error) command.reject(error); else command.resolve(result);
  }

  private failCommands(error: Error): void {
    for (const [requestId, command] of this.commands) {
      this.commands.delete(requestId);
      clearTimeout(command.timer);
      command.abortCleanup?.();
      command.reject(error);
    }
  }
}

export function listenWorkspaceSyncBroker(config: WorkspaceSyncBrokerConfig): Promise<WorkspaceSyncBroker> {
  return WorkspaceSyncBroker.listen(config);
}
