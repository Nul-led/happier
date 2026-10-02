import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { io as socketIo, type Socket as SocketIoClient } from 'socket.io-client';
import { act } from 'react-test-renderer';
import tweetnacl from 'tweetnacl';
import { Platform } from 'react-native';

import {
  MACHINE_LIVE_STREAM_SOCKET_EVENT,
  MachineLiveStreamRelayEnvelopeV1Schema,
  type MachineLiveStreamCapsV1,
  type MachineLiveStreamFrameV1,
  type MachineLiveStreamRelayEnvelopeV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';

import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { useSimulatorRelayIngestion, type UseSimulatorRelayIngestionInput } from '@/components/devices/simulator/relay/useSimulatorRelayIngestion';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { apiSocket } from '@/sync/api/session/apiSocket';
import { upsertAndActivateServer } from '@/sync/domains/server/serverRuntime';

import { createTestAuth } from '../../src/testkit/auth';
import {
  createMachineInstallationIdentityFixture,
  registerMachineIdentity,
} from '../../src/testkit/machineIdentity';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createRunDirs } from '../../src/testkit/runDir';
import { waitFor } from '../../src/testkit/timing';

import { registerDaemonLiveStreamRelayHandlers } from '../../../../apps/cli/src/rpc/handlers/daemonLiveStreamRelay';
import { RpcHandlerManager } from '../../../../apps/cli/src/api/rpc/RpcHandlerManager';
import type {
  MachineLiveStreamCaptureAdapter,
  MachineLiveStreamCaptureStartInput,
} from '../../../../apps/cli/src/daemon/peer/mediation/stream/captureAdapter';
import { createMachineLiveStreamRelayTerminator } from '../../../../apps/cli/src/daemon/peer/mediation/stream/relay';

const run = createRunDirs({ runLabel: 'core' });

// A complete 2×2 RGB JPEG encoded and decoded with the existing sharp dependency; decoded RGB is
// [37, 103, 181]. This is a codec fixture at the injected capture/OS boundary.
const JPEG_FRAME_BASE64 = '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AI8A5En/2Q==';

const STREAM_CAPS: MachineLiveStreamCapsV1 = {
  maxBitrateBps: 64_000,
  maxFramesPerSecond: 12,
  maxFrameBytes: 32_000,
  maxDurationMs: 60_000,
  maxTotalBytes: 128_000,
};

type ControlledCaptureSession = Readonly<{
  streamId: string;
  input: MachineLiveStreamCaptureStartInput;
  offerFrames: (count: number) => void;
  isStopped: () => boolean;
  stopCount: () => number;
}>;

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function toBase64(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString('base64');
}

function makeFrame(streamId: string, sequence: number): MachineLiveStreamFrameV1 {
  const payload = Buffer.from(JPEG_FRAME_BASE64, 'base64');
  return {
    v: 1,
    streamId,
    sequence,
    timestampMs: Date.now() + sequence,
    payloadKind: 'image_keyframe',
    payloadEncoding: 'binary_base64',
    payloadBase64: payload.toString('base64'),
    payloadSizeBytes: payload.byteLength,
  };
}

function createControlledCaptureAdapter(): Readonly<{
  adapter: MachineLiveStreamCaptureAdapter;
  sessions: ControlledCaptureSession[];
}> {
  const sessions: ControlledCaptureSession[] = [];
  const adapter: MachineLiveStreamCaptureAdapter = {
    start: async (input) => {
      let stopped = false;
      let stops = 0;
      const session: ControlledCaptureSession = {
        streamId: input.streamId,
        input,
        offerFrames: (count) => {
          for (let index = 0; index < count; index += 1) {
            const sequence = index + 1;
            const result = input.offerFrame(makeFrame(input.streamId, sequence));
            if (!result.ok) {
              throw new Error(`capture frame ${sequence} rejected: ${result.reasonCode}`);
            }
          }
        },
        isStopped: () => stopped,
        stopCount: () => stops,
      };
      sessions.push(session);
      return {
        ok: true,
        session: {
          stop: () => {
            stopped = true;
            stops += 1;
          },
        },
      };
    },
  };
  return { adapter, sessions };
}

async function connectSocket(params: Readonly<{
  baseUrl: string;
  token: string;
  auth: Record<string, unknown>;
}>): Promise<SocketIoClient> {
  const socket = socketIo(params.baseUrl, {
    path: '/v1/updates/',
    auth: {
      token: params.token,
      ...params.auth,
    },
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    timeout: 10_000,
  });

  await new Promise<void>((resolveConnect, rejectConnect) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectConnect(new Error('Timed out connecting socket.io test client'));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };
    const onConnect = () => {
      cleanup();
      resolveConnect();
    };
    const onConnectError = (error: unknown) => {
      cleanup();
      rejectConnect(error instanceof Error ? error : new Error(String(error)));
    };
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.connect();
  });

  return socket;
}

async function waitForMachineRpcRegistration(
  socket: SocketIoClient,
  method: string,
): Promise<void> {
  await new Promise<void>((resolveRegistered, rejectRegistered) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectRegistered(new Error(`Timed out waiting for RPC registration: ${method}`));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(SOCKET_RPC_EVENTS.REGISTERED, onRegistered);
      socket.off(SOCKET_RPC_EVENTS.ERROR, onError);
    };
    const onRegistered = (data: { method?: unknown }) => {
      if (data?.method !== method) return;
      cleanup();
      resolveRegistered();
    };
    const onError = (data: { error?: unknown; method?: unknown }) => {
      if (data?.method && data.method !== method) return;
      cleanup();
      rejectRegistered(new Error(`RPC registration failed: ${String(data?.error ?? 'unknown')}`));
    };
    socket.on(SOCKET_RPC_EVENTS.REGISTERED, onRegistered);
    socket.on(SOCKET_RPC_EVENTS.ERROR, onError);
  });
}

async function waitForUiSocketConnected(): Promise<string> {
  await waitFor(() => apiSocket.getSocketId().length > 0, {
    timeoutMs: 15_000,
    intervalMs: 50,
    context: 'UI apiSocket connected',
  });
  return apiSocket.getSocketId();
}

function buildHookInput(params: Readonly<{
  sourceMachineId: string;
  targetMachineId: string;
  viewerSocketId: string;
  simulatorId: string;
  streamId: string;
  receivedFrames: MachineLiveStreamFrameV1[];
}>): UseSimulatorRelayIngestionInput {
  return {
    enabled: true,
    transport: {
      send: (event, envelope) => apiSocket.send(event, envelope),
      onEnvelope: (listener) => apiSocket.onMachineLiveStreamRelayEnvelope((envelope) => {
        const parsed = MachineLiveStreamRelayEnvelopeV1Schema.safeParse(envelope);
        if (parsed.success && parsed.data.message.kind === 'frame') {
          params.receivedFrames.push(parsed.data.message.frame);
        }
        listener(envelope);
      }),
    },
    sourceMachineId: params.sourceMachineId,
    targetMachineId: params.targetMachineId,
    viewerSocketId: params.viewerSocketId,
    simulatorId: params.simulatorId,
    streamId: params.streamId,
    streamFamily: 'screen',
    caps: STREAM_CAPS,
    sourceCodecs: ['image.mjpeg'],
    timeoutMs: 20_000,
  };
}

// Exercises real RPC/server/relay/UI ingestion with an in-process daemon handler
// and an injected capture boundary. Device capture, daemon bootstrap and rendered
// pixels require the separate managed-stack/device journey.
describe('core e2e: simulator relay RPC and production UI ingestion (L6 transport proof)', () => {
  let server: StartedServer | null = null;
  const sockets: SocketIoClient[] = [];
  const originalPlatformOs = Platform.OS;

  afterEach(async () => {
    apiSocket.disconnect();
    await TokenStorage.removeCredentials().catch(() => false);
    (Platform as { OS: string }).OS = originalPlatformOs;
    for (const socket of sockets.splice(0)) socket.close();
    await server?.stop().catch(() => {});
    server = null;
  });

  it('delivers JPEG bytes, resets stale device state, stops capture on unmount, and isolates viewer tabs', async () => {
    const testDir = run.testDir(`simulator-relay-product-path-${randomUUID()}`);
    const grantSigningKeyPair = tweetnacl.sign.keyPair();
    server = await startServerLight({
      testDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HANDY_MASTER_SECRET: `relay-product-path-${randomUUID()}`,
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_DIRECT_PEER__ENABLED: 'false',
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__ENABLED: 'true',
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_BITRATE_BPS: String(STREAM_CAPS.maxBitrateBps),
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAMES_PER_SECOND: String(STREAM_CAPS.maxFramesPerSecond),
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_FRAME_BYTES: String(STREAM_CAPS.maxFrameBytes),
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_DURATION_MS: String(STREAM_CAPS.maxDurationMs),
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_TOTAL_BYTES: String(STREAM_CAPS.maxTotalBytes ?? 0),
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_ACCOUNT: '4',
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_SOCKET: '2',
        HAPPIER_FEATURE_MACHINES_LIVE_STREAM_SERVER_ROUTED__MAX_CONCURRENT_STREAMS_PER_MACHINE: '2',
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_KEY_ID: 'relay-product-path-grant-key',
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PRIVATE_KEY: toBase64Url(grantSigningKeyPair.secretKey),
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_PUBLIC_KEY: toBase64Url(grantSigningKeyPair.publicKey),
        HAPPIER_PEER_MEDIATION_ROUTE_GRANT_SIGNING_EXPIRES_AT: String(Date.now() + 60 * 60 * 1000),
      },
    });

    const auth = await createTestAuth(server.baseUrl);
    const sourceMachineId = `machine_${randomUUID()}`;
    const targetMachineId = `machine_${randomUUID()}`;
    const machineDataKey = new Uint8Array(randomBytes(32));
    const installation = createMachineInstallationIdentityFixture();
    expect((await registerMachineIdentity({
      baseUrl: server.baseUrl,
      token: auth.token,
      machineId: sourceMachineId,
      installation,
      dataEncryptionKey: toBase64(machineDataKey),
    })).status).toBe(200);
    expect((await registerMachineIdentity({
      baseUrl: server.baseUrl,
      token: auth.token,
      machineId: targetMachineId,
      dataEncryptionKey: toBase64(machineDataKey),
    })).status).toBe(200);

    (Platform as { OS: string }).OS = 'web';
    const credentials: AuthCredentials = {
      token: auth.token,
      secret: Buffer.from(randomBytes(32)).toString('base64url'),
    };
    upsertAndActivateServer({
      serverUrl: server.baseUrl,
      name: 'RU2 relay product-path e2e',
      source: 'manual',
      scope: 'device',
      replaceEquivalentStoredUrl: true,
    });
    expect(await TokenStorage.setCredentials(credentials)).toBe(true);
    const encryption = await createEncryptionFromAuthCredentials(credentials);
    await encryption.initializeMachines(new Map([
      [sourceMachineId, machineDataKey],
      [targetMachineId, machineDataKey],
    ]));
    apiSocket.initialize({ endpoint: server.baseUrl, token: auth.token }, encryption);
    const viewerSocketId = await waitForUiSocketConnected();

    const otherViewerSocket = await connectSocket({
      baseUrl: server.baseUrl,
      token: auth.token,
      auth: { clientType: 'user-scoped' },
    });
    sockets.push(otherViewerSocket);
    const otherViewerFrames: MachineLiveStreamRelayEnvelopeV1[] = [];
    otherViewerSocket.on(MACHINE_LIVE_STREAM_SOCKET_EVENT, (envelope: MachineLiveStreamRelayEnvelopeV1) => {
      if (envelope.message.kind === 'frame') otherViewerFrames.push(envelope);
    });

    const capture = createControlledCaptureAdapter();
    const machineSocket = await connectSocket({
      baseUrl: server.baseUrl,
      token: auth.token,
      auth: {
        clientType: 'machine-scoped',
        machineId: sourceMachineId,
      },
    });
    sockets.push(machineSocket);

    const relayTerminator = createMachineLiveStreamRelayTerminator({
      machineId: sourceMachineId,
      captureAdapter: capture.adapter,
      nowMs: () => Date.now(),
      emitEnvelope: (envelope) => {
        machineSocket.emit(MACHINE_LIVE_STREAM_SOCKET_EVENT, envelope);
      },
    });
    const rpc = new RpcHandlerManager({
      scopePrefix: sourceMachineId,
      encryptionKey: machineDataKey,
      encryptionVariant: 'dataKey',
      logger: () => {},
    });
    registerDaemonLiveStreamRelayHandlers(rpc, {
      relay: {
        start: relayTerminator.start,
      },
    });
    machineSocket.on(
      SOCKET_RPC_EVENTS.REQUEST,
      async (data: { method: string; params: unknown }, callback: (response: unknown) => void) => {
        callback(await rpc.handleRequest(data));
      },
    );
    machineSocket.on(MACHINE_LIVE_STREAM_SOCKET_EVENT, (envelope: MachineLiveStreamRelayEnvelopeV1) => {
      relayTerminator.applyControl(envelope);
    });
    const registeredMethod = `${sourceMachineId}:${RPC_METHODS.DAEMON_LIVE_STREAM_RELAY_START}`;
    const registered = waitForMachineRpcRegistration(machineSocket, registeredMethod);
    rpc.onSocketConnect(machineSocket);
    await registered;

    const simulatorA = `sim_${randomUUID()}`;
    const simulatorB = `sim_${randomUUID()}`;
    const streamA = `stream_${randomUUID()}`;
    const streamB = `stream_${randomUUID()}`;
    const receivedFrames: MachineLiveStreamFrameV1[] = [];
    const hook = await renderHook(
      (props: UseSimulatorRelayIngestionInput) => useSimulatorRelayIngestion(props),
      {
        initialProps: buildHookInput({
          sourceMachineId,
          targetMachineId,
          viewerSocketId,
          simulatorId: simulatorA,
          streamId: streamA,
          receivedFrames,
        }),
      },
    );

    await waitFor(() => capture.sessions.some((session) => session.streamId === streamA), {
      timeoutMs: 20_000,
      context: 'first stream capture started through daemon RPC',
    });
    const firstCaptureSession = capture.sessions.find((session) => session.streamId === streamA);
    expect(firstCaptureSession).toBeDefined();
    await act(async () => {
      firstCaptureSession?.offerFrames(2);
      await waitFor(() => receivedFrames.some((frame) => frame.streamId === streamA && frame.sequence === 2)
        && hook.getCurrent().playerStatesBySimulatorId[simulatorA]?.lastFrameUrl === `data:image/jpeg;base64,${JPEG_FRAME_BASE64}`, {
        timeoutMs: 15_000,
        context: 'production UI hook staged JPEG bytes from first device',
      });
    });
    expect(hook.getCurrent().playerStatesBySimulatorId[simulatorA]?.lastFrameUrl)
      .toBe(`data:image/jpeg;base64,${JPEG_FRAME_BASE64}`);
    expect(receivedFrames.filter((frame) => frame.streamId === streamA))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ sequence: 1, payloadBase64: JPEG_FRAME_BASE64 }),
        expect.objectContaining({ sequence: 2, payloadBase64: JPEG_FRAME_BASE64 }),
      ]));
    expect(otherViewerFrames).toHaveLength(0);

    await hook.rerender(buildHookInput({
      sourceMachineId,
      targetMachineId,
      viewerSocketId,
      simulatorId: simulatorB,
      streamId: streamB,
      receivedFrames,
    }));
    await waitFor(() => capture.sessions.some((session) => session.streamId === streamB), {
      timeoutMs: 20_000,
      context: 'second stream capture started through daemon RPC',
    });
    const afterSwitch = hook.getCurrent().playerStatesBySimulatorId;
    expect(afterSwitch[simulatorA]).toBeUndefined();
    expect(afterSwitch[simulatorB]?.lastFrameUrl).toBeUndefined();

    const secondCaptureSession = capture.sessions.find((session) => session.streamId === streamB);
    expect(secondCaptureSession).toBeDefined();
    await act(async () => {
      secondCaptureSession?.offerFrames(2);
      await waitFor(() => receivedFrames.some((frame) => frame.streamId === streamB && frame.sequence === 2)
        && hook.getCurrent().playerStatesBySimulatorId[simulatorB]?.lastFrameUrl === `data:image/jpeg;base64,${JPEG_FRAME_BASE64}`, {
        timeoutMs: 15_000,
        context: 'production UI hook staged JPEG bytes from second device',
      });
    });
    expect(hook.getCurrent().playerStatesBySimulatorId[simulatorB]?.lastFrameUrl)
      .toBe(`data:image/jpeg;base64,${JPEG_FRAME_BASE64}`);
    expect(receivedFrames.filter((frame) => frame.streamId === streamB))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ sequence: 1, payloadBase64: JPEG_FRAME_BASE64 }),
        expect.objectContaining({ sequence: 2, payloadBase64: JPEG_FRAME_BASE64 }),
      ]));

    await hook.unmount();
    await waitFor(() => capture.sessions.every((session) => session.isStopped()), {
      timeoutMs: 15_000,
      context: 'unmount stop reached daemon capture sessions',
    });
    expect(capture.sessions.map((session) => session.stopCount())).toEqual([1, 1]);
    expect(otherViewerFrames).toHaveLength(0);
  });
});
