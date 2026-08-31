import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as netConnect, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { Duplex } from 'node:stream';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

import { listenWorkspaceSyncBroker, createWorkspaceSyncBrokerEndpoint, type WorkspaceSyncBroker } from './workspaceSyncBroker';
import { WorkspaceSyncBrokerClient } from './workspaceSyncBrokerClient';
import {
  BrokerControlFrameDecoder,
  BrokerProtocolError,
  createBrokerHelloOkProof,
  createBrokerHelloProof,
  deriveWorkspaceSyncEndpointId,
  encodeBrokerControlFrame,
  OPEN_REMOTE_DEADLINE_MS,
  type BrokerControlV1,
} from './workspaceSyncBrokerProtocol';

/**
 * Full-duplex stand-in for the authenticated peer carrier (Lane 06 owns the
 * real Iroh machine carrier). Read and write directions are independent so
 * half-close behavior is observable, exactly like a socket.
 */
class PeerStream extends Duplex {
  readonly received: Buffer[] = [];
  writeEnded = false;
  peerClosed = false;

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    this.received.push(chunk);
    cb();
  }

  override _read(): void {}

  override end(): this {
    this.writeEnded = true;
    return super.end();
  }

  /** Simulates the remote peer closing its write direction (our read side EOF). */
  closeFromPeer(): void {
    this.peerClosed = true;
    this.push(null);
  }

  /** Simulates the remote peer writing bytes toward the broker. */
  pushFromPeer(chunk: Buffer | string): boolean {
    return this.push(chunk);
  }
}

type BrokerFixture = Readonly<{
  directory: string;
  socketPath: string;
  secret: Buffer;
  broker: WorkspaceSyncBroker;
  cleanup: () => Promise<void>;
}>;

async function startBroker(overrides: Partial<Parameters<typeof listenWorkspaceSyncBroker>[0]> = {}): Promise<BrokerFixture & { externalStreams: PeerStream[] }> {
  const directory = await mkdtemp(join(tmpdir(), 'wsbroker-'));
  const socketPath = join(directory, 'b.sock');
  const secret = randomBytes(32);
  const externalStreams: PeerStream[] = [];
  const broker = await listenWorkspaceSyncBroker({
    socketPath,
    launchSecret: secret,
    ...overrides,
    openExternalStream: async (context) => {
      if (overrides.openExternalStream) return await overrides.openExternalStream(context);
      const stream = new PeerStream();
      externalStreams.push(stream);
      return stream;
    },
  });
  return {
    directory,
    socketPath,
    secret,
    broker,
    externalStreams,
    cleanup: async () => {
      await broker.close().catch(() => {});
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function connectClient(fixture: BrokerFixture, overrides: Partial<ConstructorParameters<typeof WorkspaceSyncBrokerClient>[0]> = {}): Promise<WorkspaceSyncBrokerClient> {
  const client = new WorkspaceSyncBrokerClient({
    endpointPath: fixture.socketPath,
    brokerInstanceId: fixture.broker.brokerInstanceId,
    launchNonce: fixture.broker.launchNonce,
    launchSecret: fixture.secret,
    sidecarPid: process.pid,
    ...overrides,
  });
  await client.connectControl();
  return client;
}

/** Raw wire-level control client used to exercise protocol rules directly. */
async function openRawControl(socketPath: string): Promise<Socket> {
  const socket = netConnect(socketPath);
  await once(socket, 'connect');
  return socket;
}

async function openAuthenticatedRawControl(fixture: BrokerFixture): Promise<Readonly<{
  socket: Socket;
  wire: ReturnType<typeof rawCollector>;
}>> {
  const socket = await openRawControl(fixture.socketPath);
  const wire = rawCollector(socket);
  const hello = {
    t: 'hello',
    protocol: 1,
    brokerInstanceId: fixture.broker.brokerInstanceId,
    launchNonce: fixture.broker.launchNonce,
    sidecarPid: process.pid,
    proof: '',
  } as const;
  socket.write(encodeBrokerControlFrame({
    ...hello,
    proof: createBrokerHelloProof(fixture.secret, hello),
  }));
  await wire.waitFor((frame) => frame.t === 'hello_ok', 'hello_ok');
  return { socket, wire };
}

function rawCollector(socket: Socket): { frames: BrokerControlV1[]; waitFor: (predicate: (frame: BrokerControlV1) => boolean, label: string) => Promise<BrokerControlV1> } {
  const decoder = new BrokerControlFrameDecoder();
  const frames: BrokerControlV1[] = [];
  let notify: (() => void) | null = null;
  socket.on('data', (chunk) => {
    frames.push(...decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    notify?.();
    notify = null;
  });
  return {
    frames,
    waitFor: async (predicate, label) => {
      for (let i = 0; i < 200; i += 1) {
        const found = frames.find(predicate);
        if (found) return found;
        await new Promise<void>((resolve) => { notify = resolve; });
      }
      throw new Error(`timed out waiting for control frame: ${label}`);
    },
  };
}

function concat(chunks: readonly Buffer[]): Buffer {
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const cleanupJobs: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanupJobs.length > 0) {
    const job = cleanupJobs.pop();
    if (job) await job();
  }
});

async function useFixture<T extends BrokerFixture>(fixture: T): Promise<T> {
  cleanupJobs.push(fixture.cleanup);
  return fixture;
}

describe('workspace sync broker moving bytes over real OS IPC', () => {
  it('authenticates HELLO and moves non-empty bytes in both directions through the raw data path', async () => {
    const fixture = await useFixture(await startBroker());
    await expect(readdir(fixture.directory)).resolves.toContain('b.sock');
    const client = await connectClient(fixture);

    const endpointId = deriveWorkspaceSyncEndpointId('rel-1', 'alpha');
    const handle = await client.openStream(endpointId);
    expect(handle.streamId).toBeTruthy();

    const engine = fixture.externalStreams[0];
    const fromEngine: Buffer[] = [];
    handle.stream.on('data', (chunk: Buffer) => fromEngine.push(chunk));

    // Client (sidecar) → engine direction through the raw data connection.
    const outbound = randomBytes(256 * 1024);
    handle.stream.write(outbound);
    await waitFor(() => concat(engine.received).byteLength === outbound.byteLength, 'outbound bytes at engine');
    expect(concat(engine.received).equals(outbound)).toBe(true);

    // Engine → client direction through the same raw data connection.
    const inbound = randomBytes(128 * 1024);
    engine.pushFromPeer(inbound);
    await waitFor(() => concat(fromEngine).byteLength === inbound.byteLength, 'inbound bytes at sidecar');
    expect(concat(fromEngine).equals(inbound)).toBe(true);

    await handle.close();
    await client.close();
  });

  it('propagates half-close in each direction independently', async () => {
    const fixture = await useFixture(await startBroker());
    const client = await connectClient(fixture);
    const handle = await client.openStream(deriveWorkspaceSyncEndpointId('rel-half', 'beta'));
    const engine = fixture.externalStreams[0];

    const engineReadEnd = new Promise<void>((resolve) => engine.once('finish', () => resolve()));
    // Sidecar closes its write direction; the engine read side must observe EOF.
    handle.closeWrite();
    await engineReadEnd;
    expect(engine.writeEnded).toBe(true);

    // The opposite direction must still carry bytes after the sidecar half-close.
    const received: Buffer[] = [];
    handle.stream.on('data', (chunk: Buffer) => received.push(chunk));
    const late = Buffer.from('still-flowing');
    engine.pushFromPeer(late);
    await waitFor(() => concat(received).includes('still-flowing'), 'post-half-close reverse bytes');
    expect(concat(received).toString()).toContain('still-flowing');

    // Engine closes its write direction; the sidecar read side must observe EOF.
    const clientReadEnd = new Promise<void>((resolve) => handle.stream.once('end', () => resolve()));
    engine.closeFromPeer();
    await clientReadEnd;

    await handle.close();
    await client.close();
  });

  it('cancels a stream once, destroys both handles, and releases the stream slot', async () => {
    const fixture = await useFixture(await startBroker());
    const client = await connectClient(fixture);
    const first = await client.openStream(deriveWorkspaceSyncEndpointId('rel-cancel', 'alpha'));
    await first.cancel();
    await expect(first.done).resolves.toBeUndefined();
    expect((first.stream as Socket).destroyed).toBe(true);

    // The request slot was released exactly once: a new stream opens cleanly.
    const second = await client.openStream(deriveWorkspaceSyncEndpointId('rel-cancel', 'alpha'));
    expect(fixture.externalStreams).toHaveLength(2);
    await second.close();
    await client.close();
  });
});

describe('workspace sync broker authentication and attach rules', () => {
  it('does not head-of-line block an independent open while another remote open is stalled', async () => {
    const stalledEndpoint = deriveWorkspaceSyncEndpointId('rel-stalled', 'alpha');
    const readyEndpoint = deriveWorkspaceSyncEndpointId('rel-ready', 'beta');
    let stalledDispatched = false;
    const fixture = await useFixture(await startBroker({
      openExternalStream: async ({ endpointId }) => {
        if (endpointId === stalledEndpoint) {
          stalledDispatched = true;
          return await new Promise<PeerStream>(() => {});
        }
        return new PeerStream();
      },
    }));
    const client = await connectClient(fixture);

    const stalled = client.openStream(stalledEndpoint);
    await waitFor(() => stalledDispatched, 'stalled remote open dispatch');
    const independent = await client.openStream(readyEndpoint);
    expect(independent.streamId).toBeTruthy();

    await independent.close();
    await client.close();
    await expect(stalled).rejects.toMatchObject({ code: 'agent_unavailable' });
  });

  it('aborts a stalled remote open on CANCEL and emits exactly one terminal response', async () => {
    let openSignal: AbortSignal | undefined;
    const fixture = await useFixture(await startBroker({
      openExternalStream: async ({ signal }) => await new Promise<PeerStream>((_resolve, reject) => {
        openSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }));
    const { socket, wire } = await openAuthenticatedRawControl(fixture);
    socket.write(encodeBrokerControlFrame({
      t: 'open_data',
      requestId: 'req-cancel-opening',
      endpointId: deriveWorkspaceSyncEndpointId('rel-cancel-opening', 'alpha'),
      expiresAtMs: Date.now() + OPEN_REMOTE_DEADLINE_MS,
    }));
    await waitFor(() => openSignal !== undefined, 'remote open signal');
    socket.write(encodeBrokerControlFrame({ t: 'cancel', requestId: 'req-cancel-opening' }));

    await wire.waitFor(
      (frame) => frame.t === 'error' && frame.requestId === 'req-cancel-opening',
      'cancel terminal response',
    );
    expect(openSignal?.aborted).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(wire.frames.filter(
      (frame) => frame.t === 'error' && frame.requestId === 'req-cancel-opening',
    )).toHaveLength(1);
    socket.destroy();
  });

  it('aborts a stalled remote open when its operational deadline expires', async () => {
    let openSignal: AbortSignal | undefined;
    const fixture = await useFixture(await startBroker({
      openExternalStream: async ({ signal }) => await new Promise<PeerStream>((_resolve, reject) => {
        openSignal = signal;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }));
    const { socket, wire } = await openAuthenticatedRawControl(fixture);
    socket.write(encodeBrokerControlFrame({
      t: 'open_data',
      requestId: 'req-open-deadline',
      endpointId: deriveWorkspaceSyncEndpointId('rel-open-deadline', 'alpha'),
      expiresAtMs: Date.now() + 50,
    }));

    const terminal = await wire.waitFor(
      (frame) => frame.t === 'error' && frame.requestId === 'req-open-deadline',
      'open deadline terminal response',
    );
    expect(terminal).toMatchObject({ t: 'error', code: 'expired_request' });
    expect(openSignal?.aborted).toBe(true);
    socket.destroy();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a late remote open %s after cancellation without a second terminal response',
    async (settlement) => {
      let settle!: (settlement: 'resolve' | 'reject') => void;
      const fixture = await useFixture(await startBroker({
        openExternalStream: async () => await new Promise<PeerStream>((resolve, reject) => {
          settle = (kind) => {
            if (kind === 'resolve') resolve(new PeerStream());
            else reject(new Error('late remote rejection'));
          };
        }),
      }));
      const { socket, wire } = await openAuthenticatedRawControl(fixture);
      const requestId = `req-late-${settlement}`;
      socket.write(encodeBrokerControlFrame({
        t: 'open_data',
        requestId,
        endpointId: deriveWorkspaceSyncEndpointId(`rel-late-${settlement}`, 'alpha'),
        expiresAtMs: Date.now() + OPEN_REMOTE_DEADLINE_MS,
      }));
      await waitFor(() => settle !== undefined, 'remote open dispatch');
      socket.write(encodeBrokerControlFrame({ t: 'cancel', requestId }));
      await wire.waitFor(
        (frame) => frame.t === 'error' && frame.requestId === requestId,
        'cancel terminal response',
      );
      settle(settlement);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(wire.frames.filter(
        (frame) => frame.t === 'error' && frame.requestId === requestId,
      )).toHaveLength(1);
      expect(wire.frames.some(
        (frame) => frame.t === 'data_ready' && frame.requestId === requestId,
      )).toBe(false);
      socket.destroy();
    },
  );

  it('atomically reserves one raw data socket while peer validation is pending', async () => {
    let dataValidationCount = 0;
    let releaseValidation!: () => void;
    const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
    const fixture = await useFixture(await startBroker({
      validatePeerIdentity: async ({ kind }) => {
        if (kind === 'data') {
          dataValidationCount += 1;
          await validationGate;
        }
        return true;
      },
    }));
    const { socket, wire } = await openAuthenticatedRawControl(fixture);
    socket.write(encodeBrokerControlFrame({
      t: 'open_data',
      requestId: 'req-attach-race',
      endpointId: deriveWorkspaceSyncEndpointId('rel-attach-race', 'alpha'),
      expiresAtMs: Date.now() + OPEN_REMOTE_DEADLINE_MS,
    }));
    const ready = await wire.waitFor((frame) => frame.t === 'data_ready', 'data_ready');
    if (ready.t !== 'data_ready') throw new Error('unreachable');

    const endpoint = createWorkspaceSyncBrokerEndpoint({ endpointPath: ready.dataEndpoint });
    const first = endpoint.connect();
    const second = endpoint.connect();
    await Promise.all([once(first, 'connect'), once(second, 'connect')]);
    await waitFor(() => dataValidationCount >= 1, 'first data validation');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(dataValidationCount).toBe(1);
    await waitFor(() => first.destroyed || second.destroyed, 'duplicate raw data socket rejection');

    releaseValidation();
    socket.write(encodeBrokerControlFrame({
      t: 'attach_data', streamId: ready.streamId, attachNonce: ready.attachNonce,
    }));
    await wire.waitFor(
      (frame) => frame.t === 'data_ok' && frame.streamId === ready.streamId,
      'data_ok',
    );
    first.destroy();
    second.destroy();
    socket.destroy();
  });

  it('keeps the attach deadline active while the reserved data socket is still being validated', async () => {
    let validationStarted = false;
    const fixture = await useFixture(await startBroker({
      validatePeerIdentity: async ({ kind }) => {
        if (kind === 'data') {
          validationStarted = true;
          await new Promise<void>(() => {});
        }
        return true;
      },
    }));
    const { socket, wire } = await openAuthenticatedRawControl(fixture);
    socket.write(encodeBrokerControlFrame({
      t: 'open_data',
      requestId: 'req-attach-deadline',
      endpointId: deriveWorkspaceSyncEndpointId('rel-attach-deadline', 'alpha'),
      expiresAtMs: Date.now() + 250,
    }));
    const ready = await wire.waitFor((frame) => frame.t === 'data_ready', 'data_ready');
    if (ready.t !== 'data_ready') throw new Error('unreachable');

    const data = createWorkspaceSyncBrokerEndpoint({ endpointPath: ready.dataEndpoint }).connect();
    await once(data, 'connect');
    await waitFor(() => validationStarted, 'data validation');
    socket.write(encodeBrokerControlFrame({
      t: 'attach_data', streamId: ready.streamId, attachNonce: ready.attachNonce,
    }));
    const terminal = await wire.waitFor(
      (frame) => frame.t === 'error' && frame.requestId === 'req-attach-deadline',
      'attach deadline terminal response',
    );
    expect(terminal).toMatchObject({ t: 'error', code: 'data_attach_failed' });
    await waitFor(() => data.destroyed, 'reserved data socket cleanup');
    socket.destroy();
  });

  it('creates private POSIX endpoints and keeps Windows pipe details behind one abstraction', async () => {
    const fixture = await useFixture(await startBroker());
    if (process.platform !== 'win32') {
      expect((await stat(fixture.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(fixture.socketPath)).mode & 0o777).toBe(0o600);
    }
    const windows = createWorkspaceSyncBrokerEndpoint({ endpointPath: 'broker-id', platform: 'win32' });
    expect(windows.kind).toBe('named_pipe');
    expect(windows.endpointPath).toMatch(/^\\\\\.\\pipe\\happier-workspace-sync-/u);

    let listenCalls = 0;
    const unsafeDefaultDaclServer = {
      once: () => unsafeDefaultDaclServer,
      off: () => unsafeDefaultDaclServer,
      listen: () => {
        listenCalls += 1;
        throw new Error('bound with the process token default DACL');
      },
    } as unknown as Server;
    await expect(windows.listen(unsafeDefaultDaclServer)).rejects.toThrow('user-only security descriptor');
    expect(listenCalls).toBe(0);
  });

  it('admits one authenticated sidecar owner and applies peer identity checks to control and data sockets', async () => {
    const checked: Array<Readonly<{ kind: string; sidecarPid: number | undefined }>> = [];
    const fixture = await useFixture(await startBroker({
      validatePeerIdentity: async ({ kind, sidecarPid }) => {
        checked.push({ kind, sidecarPid });
        if (kind === 'data') await new Promise<void>((resolve) => setTimeout(resolve, 25));
        return true;
      },
    }));
    const owner = await connectClient(fixture);
    expect(fixture.broker.authenticatedSidecarPid).toBe(process.pid);
    await expect(connectClient(fixture)).rejects.toMatchObject({ code: 'unauthorized' });
    const stream = await owner.openStream(deriveWorkspaceSyncEndpointId('rel-peer', 'alpha'));
    expect(checked).toEqual([
      { kind: 'control', sidecarPid: process.pid },
      { kind: 'data', sidecarPid: process.pid },
    ]);
    await stream.close();
    await owner.close();
  });

  it('closes an external stream that resolves after its control owner disconnects', async () => {
    let resolveExternal!: (stream: PeerStream) => void;
    const fixture = await useFixture(await startBroker({
      openExternalStream: async () => await new Promise<PeerStream>((resolve) => { resolveExternal = resolve; }),
    }));
    const client = await connectClient(fixture);
    const opening = client.openStream(deriveWorkspaceSyncEndpointId('rel-race', 'alpha'));
    await waitFor(() => resolveExternal !== undefined, 'external open dispatch');
    await client.close();
    const external = new PeerStream();
    resolveExternal(external);
    await expect(opening).rejects.toMatchObject({ code: 'agent_unavailable' });
    await waitFor(() => external.destroyed, 'late external stream cleanup');
  });

  it('rejects a hello with the wrong launch secret and closes the connection', async () => {
    const fixture = await useFixture(await startBroker());
    const socket = await openRawControl(fixture.socketPath);
    const wire = rawCollector(socket);
    const hello = {
      t: 'hello',
      protocol: 1,
      brokerInstanceId: fixture.broker.brokerInstanceId,
      launchNonce: fixture.broker.launchNonce,
      sidecarPid: process.pid,
      proof: createBrokerHelloProof(randomBytes(32), { protocol: 1, brokerInstanceId: fixture.broker.brokerInstanceId, launchNonce: fixture.broker.launchNonce, sidecarPid: process.pid }),
    } as const;
    socket.write(encodeBrokerControlFrame(hello));
    const reply = await wire.waitFor((frame) => frame.t === 'error' || frame.t === 'hello_ok', 'auth reply');
    expect(reply).toMatchObject({ t: 'error', code: 'unauthorized' });
    await waitFor(() => socket.destroyed, 'socket close after unauthorized hello');
  });

  it('rejects a second hello on an authenticated connection with protocol_error', async () => {
    const fixture = await useFixture(await startBroker());
    const socket = await openRawControl(fixture.socketPath);
    const wire = rawCollector(socket);
    const hello = {
      t: 'hello',
      protocol: 1,
      brokerInstanceId: fixture.broker.brokerInstanceId,
      launchNonce: fixture.broker.launchNonce,
      sidecarPid: process.pid,
      proof: createBrokerHelloProof(fixture.secret, { protocol: 1, brokerInstanceId: fixture.broker.brokerInstanceId, launchNonce: fixture.broker.launchNonce, sidecarPid: process.pid }),
    } as const;
    socket.write(encodeBrokerControlFrame(hello));
    await wire.waitFor((frame) => frame.t === 'hello_ok', 'hello_ok');
    expect(fixture.broker.whenReady).toBeDefined();
    socket.write(encodeBrokerControlFrame(hello));
    const reply = await wire.waitFor((frame) => frame.t === 'error' && frame.code !== 'unauthorized', 'second hello reply');
    expect(reply).toMatchObject({ t: 'error', code: 'protocol_error' });
    socket.destroy();
  });

  it('verifies the expected sidecar pid when configured', async () => {
    const fixture = await useFixture(await startBroker({ expectedSidecarPid: 424242 }));
    const socket = await openRawControl(fixture.socketPath);
    const wire = rawCollector(socket);
    const hello = {
      t: 'hello',
      protocol: 1,
      brokerInstanceId: fixture.broker.brokerInstanceId,
      launchNonce: fixture.broker.launchNonce,
      sidecarPid: process.pid,
      proof: createBrokerHelloProof(fixture.secret, { protocol: 1, brokerInstanceId: fixture.broker.brokerInstanceId, launchNonce: fixture.broker.launchNonce, sidecarPid: process.pid }),
    } as const;
    socket.write(encodeBrokerControlFrame(hello));
    const reply = await wire.waitFor((frame) => frame.t === 'error' || frame.t === 'hello_ok', 'pid mismatch reply');
    expect(reply).toMatchObject({ t: 'error', code: 'unauthorized' });
    socket.destroy();
  });

  it('accepts only one ATTACH_DATA per pending stream and rejects duplicates or stale attaches', async () => {
    const fixture = await useFixture(await startBroker());
    const socket = await openRawControl(fixture.socketPath);
    const wire = rawCollector(socket);
    const hello = {
      t: 'hello',
      protocol: 1,
      brokerInstanceId: fixture.broker.brokerInstanceId,
      launchNonce: fixture.broker.launchNonce,
      sidecarPid: process.pid,
      proof: createBrokerHelloProof(fixture.secret, { protocol: 1, brokerInstanceId: fixture.broker.brokerInstanceId, launchNonce: fixture.broker.launchNonce, sidecarPid: process.pid }),
    } as const;
    socket.write(encodeBrokerControlFrame(hello));
    await wire.waitFor((frame) => frame.t === 'hello_ok', 'hello_ok');

    socket.write(encodeBrokerControlFrame({ t: 'open_data', requestId: 'req-1', endpointId: deriveWorkspaceSyncEndpointId('rel-attach', 'alpha'), expiresAtMs: Date.now() + OPEN_REMOTE_DEADLINE_MS }));
    const ready = await wire.waitFor((frame) => frame.t === 'data_ready', 'data_ready');
    if (ready.t !== 'data_ready') throw new Error('unreachable');
    const endpoint = createWorkspaceSyncBrokerEndpoint({ endpointPath: ready.dataEndpoint });
    const data = await endpoint.connect(ready.dataEndpoint);
    await once(data, 'connect');
    await waitFor(() => fixture.externalStreams.length === 1, 'external stream open');

    socket.write(encodeBrokerControlFrame({ t: 'attach_data', streamId: ready.streamId, attachNonce: ready.attachNonce }));
    await wire.waitFor((frame) => frame.t === 'data_ok' && frame.streamId === ready.streamId, 'data_ok');

    // Duplicate attach for the same stream must fail closed without crashing.
    socket.write(encodeBrokerControlFrame({ t: 'attach_data', streamId: ready.streamId, attachNonce: ready.attachNonce }));
    const duplicate = await wire.waitFor((frame) => frame.t === 'error', 'duplicate attach reply');
    expect(duplicate).toMatchObject({ t: 'error', code: 'data_attach_failed' });

    // Wrong nonce on a live stream is rejected as well.
    socket.write(encodeBrokerControlFrame({ t: 'attach_data', streamId: ready.streamId, attachNonce: 'wrong-nonce' }));
    const wrongNonce = await wire.waitFor(
      (frame) => frame !== duplicate && frame.t === 'error' && frame.code === 'unauthorized',
      'wrong nonce reply',
    );
    expect(wrongNonce).toMatchObject({ t: 'error', code: 'unauthorized' });

    socket.destroy();
    data.destroy();
  });

  it('enforces the configured concurrent stream limit', async () => {
    const fixture = await useFixture(await startBroker({ maxStreams: 1 }));
    const client = await connectClient(fixture);
    const first = await client.openStream(deriveWorkspaceSyncEndpointId('rel-limit', 'alpha'));
    await expect(client.openStream(deriveWorkspaceSyncEndpointId('rel-limit', 'beta'))).rejects.toMatchObject({ code: 'stream_limit' });
    await first.close();
    const afterRelease = await client.openStream(deriveWorkspaceSyncEndpointId('rel-limit', 'beta'));
    await afterRelease.close();
    await client.close();
  });

  it('rejects expired open requests before opening any peer route', async () => {
    const fixture = await useFixture(await startBroker());
    const client = await connectClient(fixture);
    await expect(client.openStream(deriveWorkspaceSyncEndpointId('rel-expired', 'alpha'), { expiresAtMs: Date.now() - 1 })).rejects.toMatchObject({ code: 'expired_request' });
    expect(fixture.externalStreams).toHaveLength(0);
    await client.close();
  });

  it('forwards typed authorization failures from the endpoint mapping callback', async () => {
    const fixture = await useFixture(await startBroker({
      openExternalStream: async () => {
        throw new BrokerProtocolError('relationship_not_owned', 'unknown endpoint');
      },
    }));
    const client = await connectClient(fixture);
    await expect(client.openStream(deriveWorkspaceSyncEndpointId('rel-unknown', 'alpha'))).rejects.toMatchObject({ code: 'relationship_not_owned' });

    const fixture2 = await useFixture(await startBroker({
      openExternalStream: async () => {
        throw new BrokerProtocolError('root_mismatch', 'root changed');
      },
    }));
    const client2 = await connectClient(fixture2);
    await expect(client2.openStream(deriveWorkspaceSyncEndpointId('rel-root', 'alpha'))).rejects.toMatchObject({ code: 'root_mismatch' });
    await client.close();
    await client2.close();
  });

  it('relays bounded control commands to the authenticated sidecar and returns typed results', async () => {
    const fixture = await useFixture(await startBroker());
    const client = await connectClient(fixture);
    client.onCommand(async (command) => {
      if (command.t === 'get' && command.sessionIdentifier === 'mutagen-session-1') {
        return { sessionIdentifier: command.sessionIdentifier, state: 'watching' };
      }
      throw new BrokerProtocolError('relationship_not_owned', 'no such session');
    });

    await expect(fixture.broker.command({ t: 'get', requestId: 'cmd-1', sessionIdentifier: 'mutagen-session-1' })).resolves.toMatchObject({ sessionIdentifier: 'mutagen-session-1', state: 'watching' });
    await expect(fixture.broker.command({ t: 'get', requestId: 'cmd-2', sessionIdentifier: 'missing' })).rejects.toMatchObject({ code: 'relationship_not_owned' });

    // Cancellation before dispatch is definitive because the sidecar has not received anything.
    const preDispatchAbort = new AbortController();
    preDispatchAbort.abort();
    await expect(fixture.broker.command(
      { t: 'list', requestId: 'cmd-3' },
      { signal: preDispatchAbort.signal, timeoutMs: 5_000 },
    )).rejects.toMatchObject({ code: 'cancelled' });

    // Cancellation after dispatch asks the sidecar to stop, but the Mutagen outcome is unknown.
    let commandDispatched = false;
    let cancellationDelivered = false;
    client.onCommand(async (_command, signal) => await new Promise<never>((_resolve, reject) => {
      commandDispatched = true;
      signal.addEventListener('abort', () => {
        cancellationDelivered = true;
        reject(new BrokerProtocolError('cancelled', 'command cancelled'));
      }, { once: true });
    }));
    const abort = new AbortController();
    const abortable = fixture.broker.command({ t: 'list', requestId: 'cmd-4' }, { signal: abort.signal, timeoutMs: 5_000 });
    await waitFor(() => commandDispatched, 'sidecar command dispatch');
    abort.abort();
    await expect(abortable).rejects.toMatchObject({ code: 'indeterminate' });
    await waitFor(() => cancellationDelivered, 'sidecar command cancellation');

    // Commands before a sidecar authenticated fail closed.
    const fixture2 = await useFixture(await startBroker());
    await expect(fixture2.broker.command({ t: 'list', requestId: 'cmd-5' })).rejects.toMatchObject({ code: 'agent_unavailable' });

    await client.close();
  });

  it('fails pending commands when the sidecar control connection drops', async () => {
    const fixture = await useFixture(await startBroker());
    const client = await connectClient(fixture);
    client.onCommand(async () => {
      await new Promise<void>(() => {});
    });
    const pending = fixture.broker.command({ t: 'flush', requestId: 'cmd-drop', sessionIdentifier: 'mutagen-session-1' }, { timeoutMs: 10_000 });
    await waitFor(() => fixture.broker.hasInFlightCommands(), 'command dispatched to sidecar');
    await client.close();
    await expect(pending).rejects.toMatchObject({ code: 'agent_unavailable' });
  });

  it('times out an in-flight sidecar command and delivers cancellation to its handler', async () => {
    const fixture = await useFixture(await startBroker());
    const client = await connectClient(fixture);
    let cancelled = false;
    client.onCommand(async (_command, signal) => await new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        cancelled = true;
        reject(new BrokerProtocolError('cancelled', 'command cancelled'));
      }, { once: true });
    }));
    await expect(fixture.broker.command(
      { t: 'list', requestId: 'cmd-timeout' },
      { timeoutMs: 10 },
    )).rejects.toMatchObject({ code: 'indeterminate' });
    await waitFor(() => cancelled, 'sidecar command cancellation');
    await client.close();
  });

  it('rotates per-launch credentials so a restarted sidecar authenticates with the fresh secret', async () => {
    const fixture = await useFixture(await startBroker());
    const original = { launchNonce: fixture.broker.launchNonce };
    const rotated = fixture.broker.rotateLaunchCredential();
    expect(rotated.launchNonce).not.toBe(original.launchNonce);
    expect(rotated.launchSecret.byteLength).toBe(32);
    expect(rotated.launchSecret.every((byte) => byte === 0)).toBe(false);

    // The stale credential can no longer authenticate; the fresh one can.
    const staleSocket = await openRawControl(fixture.socketPath);
    const staleWire = rawCollector(staleSocket);
    staleSocket.write(encodeBrokerControlFrame({
      t: 'hello',
      protocol: 1,
      brokerInstanceId: fixture.broker.brokerInstanceId,
      launchNonce: original.launchNonce,
      sidecarPid: process.pid,
      proof: createBrokerHelloProof(fixture.secret, { protocol: 1, brokerInstanceId: fixture.broker.brokerInstanceId, launchNonce: original.launchNonce, sidecarPid: process.pid }),
    }));
    expect(await staleWire.waitFor((frame) => frame.t === 'error', 'stale credential reply')).toMatchObject({ code: 'unauthorized' });
    staleSocket.destroy();

    const freshClient = await connectClient(fixture, { launchNonce: rotated.launchNonce, launchSecret: rotated.launchSecret });
    const okProof = createBrokerHelloOkProof(rotated.launchSecret, { protocol: 1, brokerInstanceId: fixture.broker.brokerInstanceId, launchNonce: rotated.launchNonce, sidecarPid: process.pid });
    expect(freshClient.lastHelloOkProof).toBe(okProof);
    await freshClient.close();
  });
});
