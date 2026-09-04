import { join } from 'node:path';

import {
  HomeConnectionDescriptorV1Schema,
  IrohEndpointDescriptorV1Schema,
  type HomeConnectionDescriptorV1,
  type IrohEndpointDescriptorV1,
} from '@happier-dev/protocol';
import {
  loadIrohNodeNative,
} from '@happier-dev/iroh-native/node';

import { connectPeerTcpTunnelTcp } from '../mediation/tunnel/open';
import type {
  MachineCarrierTransportConnection,
  MachineCarrierTransportOpenInput,
} from './machineCarrier';

type NodeIrohNativeModule = Extract<ReturnType<typeof loadIrohNodeNative>, { available: true }>['native'];

/**
 * One shared in-flight cleanup promise per owned native resource. Concurrent
 * release callers coalesce onto the same native cleanup call, the resource is
 * marked released only after native cleanup succeeds, and a failed cleanup
 * remains retryable through the same closer. This is custody coalescing only:
 * it adds no registry, worker, retry timer, or discarded closer.
 */
function onceReleased(release: () => Promise<void>): () => Promise<void> {
  let released = false;
  let inFlight: Promise<void> | null = null;
  return () => {
    if (released) return Promise.resolve();
    inFlight ??= release().then(
      () => {
        released = true;
        inFlight = null;
      },
      (error: unknown) => {
        inFlight = null;
        throw error;
      },
    );
    return inFlight;
  };
}

export type DaemonMachineIrohRelayConfig = Readonly<{
  relayPolicy: 'automatic' | 'disabled';
  relayUrls: readonly string[];
}>;

export type DaemonMachineIrohRuntime = Readonly<{
  available: true;
  endpoint: IrohEndpointDescriptorV1;
  ensureHomeTunnel?: (input: Readonly<{
    descriptor: HomeConnectionDescriptorV1;
  }>) => Promise<Readonly<{
    runtimeOrigin: string;
    observedPath: 'direct' | 'relay' | 'unknown';
    release(): Promise<void>;
  }>>;
  startAttemptAcceptor: (input: Readonly<{ admissionPort: number }>) => Promise<void>;
  stopActiveTunnels: () => Promise<void>;
  stopAttemptAcceptor: () => Promise<void>;
  openTunnel: (
    input: MachineCarrierTransportOpenInput,
    endpoint: IrohEndpointDescriptorV1,
  ) => Promise<Readonly<{
    localPort: number;
    localCapability: string;
    remoteEndpointId: string;
    observedPath: 'direct' | 'relay' | 'unknown';
    close(): Promise<void>;
  }>>;
  openHttpTunnel: (
    input: MachineCarrierTransportOpenInput,
    endpoint: IrohEndpointDescriptorV1,
  ) => Promise<Readonly<{
    localPort: number;
    localCapability: string;
    remoteEndpointId: string;
    observedPath: 'direct' | 'relay' | 'unknown';
    close(): Promise<void>;
  }>>;
  openTransport: (
    input: MachineCarrierTransportOpenInput,
    endpoint: IrohEndpointDescriptorV1,
  ) => Promise<MachineCarrierTransportConnection>;
  shutdown: () => Promise<void>;
}>;

export type UnavailableDaemonMachineIrohRuntime =
  | Readonly<{
      available: false;
      reason: 'native_unavailable';
      message: string;
      shutdown: () => Promise<void>;
    }>
  | Readonly<{
      available: false;
      reason: 'startup_failed';
      error: unknown;
      shutdown: () => Promise<void>;
    }>;

/**
 * Creates the daemon's one Machine Iroh runtime. Local native-endpoint
 * initialization is an optional carrier preparation step, so every local
 * failure is reported as native-runtime unavailability instead of thrown: the
 * HTTPS-aware Home transport owner is the single owner of the
 * trusted-HTTPS-or-fail-closed decision, and it needs the unavailability as an
 * input rather than an aborted daemon startup. A `startup_failed` result keeps
 * any native endpoint that was created in retryable `shutdown` custody.
 */
export async function createDaemonMachineIrohRuntime(input: Readonly<{
  happyHomeDir: string;
  relayConfig: DaemonMachineIrohRelayConfig;
  native?: NodeIrohNativeModule;
  connectTcp?: typeof connectPeerTcpTunnelTcp;
}>): Promise<DaemonMachineIrohRuntime | UnavailableDaemonMachineIrohRuntime> {
  const loaded = input.native ? null : loadIrohNodeNative();
  const native = input.native ?? (loaded?.available ? loaded.native : null);
  if (!native) {
    return {
      available: false,
      reason: 'native_unavailable',
      message: loaded && !loaded.available ? loaded.message : 'Iroh native lifecycle addon is unavailable',
      shutdown: async () => undefined,
    };
  }

  let created: Awaited<ReturnType<NodeIrohNativeModule['createEndpoint']>>;
  try {
    created = await native.createEndpoint({
      keyPath: join(input.happyHomeDir, 'runtime', 'iroh', 'endpoint.key'),
      relayPolicy: input.relayConfig.relayPolicy,
      ...(input.relayConfig.relayUrls.length > 0 ? { relayUrls: input.relayConfig.relayUrls } : {}),
      capProfile: 'machineBulk',
    });
  } catch (error) {
    // No native endpoint exists, so there is nothing to keep in custody.
    return { available: false, reason: 'startup_failed', error, shutdown: async () => undefined };
  }
  // Custody is registered on the created endpoint before any status read or
  // descriptor projection, so every later startup failure disposes the one
  // native resource this runtime already owns.
  const disposeEndpoint = onceReleased(async () => {
    await native.shutdownEndpoint({ endpointHandle: created.endpointHandle });
  });
  let endpoint: IrohEndpointDescriptorV1;
  try {
    const status = await native.getEndpointStatus(created.endpointHandle);
    if (!status?.active || status.endpointId !== created.endpointId) {
      throw new Error('Iroh machine endpoint did not become ready');
    }
    endpoint = IrohEndpointDescriptorV1Schema.parse({
      endpointId: status.endpointId,
      ...(status.relayUrls.length > 0 ? { relayUrls: status.relayUrls } : {}),
      ...(status.directAddresses.length > 0 ? { directAddresses: status.directAddresses } : {}),
    });
  } catch (error) {
    // Dispose the one native resource this factory owns, then report the
    // failure as native-runtime unavailability. `disposeEndpoint` resolves
    // immediately once cleanup succeeded and stays retryable when it did not,
    // so the daemon process owner keeps custody either way.
    await disposeEndpoint().catch(() => undefined);
    return { available: false, reason: 'startup_failed', error, shutdown: disposeEndpoint };
  }
  const activeTunnelClosers = new Set<() => Promise<void>>();
  const activeHomeTunnelClosers = new Set<() => Promise<void>>();
  /**
   * Releases a creation that resolved after shutdown began. Native endpoint
   * shutdown is the admission, cancellation and join owner, so it refuses a
   * late native publication itself; this only covers the narrow window where a
   * native creation resolved just before shutdown reached the endpoint. A
   * failed release keeps the closer in its active set, so it stays retryable
   * through the same shutdown sweep.
   */
  const releaseLateCreation = async (release: () => Promise<void>): Promise<void> => {
    await release().catch(() => undefined);
  };
  let acceptorRunning = false;
  let startAcceptorInFlight: Promise<unknown> | null = null;
  let stopAcceptorInFlight: Promise<void> | null = null;
  let shutdownRequested = false;
  let shutdownComplete = false;
  let shutdownInFlight: Promise<void> | null = null;

  const stopAttemptAcceptor = (): Promise<void> => {
    if (!acceptorRunning) return Promise.resolve();
    stopAcceptorInFlight ??= (async () => {
      await startAcceptorInFlight?.catch(() => undefined);
      await native.stopMachineAcceptor({ endpointHandle: created.endpointHandle });
    })().then(
      () => {
        acceptorRunning = false;
        stopAcceptorInFlight = null;
      },
      (error: unknown) => {
        stopAcceptorInFlight = null;
        throw error;
      },
    );
    return stopAcceptorInFlight;
  };
  const stopActiveTunnels = async (): Promise<void> => {
    // Aggregate only after every closer settles: a first failure must not race
    // shutdown past the other owned releases. Successful closers leave their
    // set; failed closers stay owned and retryable through the same sweep.
    const outcomes = await Promise.allSettled([
      ...[...activeHomeTunnelClosers].map((close) => close()),
      ...[...activeTunnelClosers].map((close) => close()),
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') throw outcome.reason;
    }
  };
  const startTunnel = async (
    transportInput: MachineCarrierTransportOpenInput,
    remoteDescriptor: IrohEndpointDescriptorV1,
    kind: 'raw' | 'http' = 'raw',
  ) => {
    if (shutdownRequested) throw new Error('Iroh machine runtime is shut down');
    if (
      transportInput.flow !== transportInput.handshake.flow
      || (
        transportInput.handshake.flow === 'workspace_sync'
        && transportInput.operationId !== transportInput.handshake.operationId
      )
      || (
        transportInput.handshake.flow === 'finite_transfer'
        && transportInput.operationId !== undefined
      )
    ) {
      throw new Error('Iroh machine transport request does not match the verified handshake');
    }
    const parsedRemote = IrohEndpointDescriptorV1Schema.parse(remoteDescriptor);
    if (parsedRemote.endpointId !== transportInput.remoteEndpointId) {
      throw new Error('Iroh machine endpoint descriptor does not match the verified handshake');
    }
    const start = kind === 'http' ? native.startMachineHttpTunnel : native.startMachineTunnel;
    const tunnel = await start({
      endpointHandle: created.endpointHandle,
      endpointId: parsedRemote.endpointId,
      ...(parsedRemote.directAddresses ? { directAddresses: parsedRemote.directAddresses } : {}),
      ...(parsedRemote.relayUrls ? { relayUrls: parsedRemote.relayUrls } : {}),
      handshakeJson: JSON.stringify(transportInput.handshake),
      capProfile: 'machineBulk',
    });
    return tunnel;
  };

  const openLoopbackTunnel = async (
    transportInput: MachineCarrierTransportOpenInput,
    remoteDescriptor: IrohEndpointDescriptorV1,
    kind: 'raw' | 'http',
  ) => {
    const tunnel = await startTunnel(transportInput, remoteDescriptor, kind);
    const close = onceReleased(async () => {
      await native.stopMachineTunnel(tunnel.machineTunnelId);
      activeTunnelClosers.delete(close);
    });
    activeTunnelClosers.add(close);
    if (shutdownRequested) {
      await releaseLateCreation(close);
      throw new Error('Iroh machine runtime is shut down');
    }
    return {
      localPort: tunnel.localPort,
      localCapability: tunnel.localCapability,
      remoteEndpointId: tunnel.remoteEndpointId,
      observedPath: tunnel.observedPath,
      close,
    };
  };

  return {
    available: true,
    endpoint,
    async ensureHomeTunnel({ descriptor }) {
      if (shutdownRequested) throw new Error('Iroh daemon runtime is shut down');
      const parsed = HomeConnectionDescriptorV1Schema.parse(descriptor);
      const homeEndpoint = parsed.endpoints.find((candidate) => candidate.kind === 'iroh');
      if (!homeEndpoint) throw new Error('Home descriptor does not contain an Iroh endpoint');
      const tunnel = await native.ensureHomeTunnel({
        endpointHandle: created.endpointHandle,
        homeServerIdentityId: parsed.homeServerIdentityId,
        endpointId: homeEndpoint.endpointId,
        ...(homeEndpoint.directAddresses ? { directAddresses: homeEndpoint.directAddresses } : {}),
        ...(homeEndpoint.relayUrls ? { relayUrls: homeEndpoint.relayUrls } : {}),
      });
      // The lease stays owned until native release succeeds; concurrent
      // release callers share the one in-flight native call.
      const release = onceReleased(async () => {
        await native.releaseHomeTunnel(tunnel.tunnelId);
        activeHomeTunnelClosers.delete(release);
      });
      activeHomeTunnelClosers.add(release);
      if (shutdownRequested) {
        await releaseLateCreation(release);
        throw new Error('Iroh daemon runtime is shut down');
      }
      return {
        runtimeOrigin: tunnel.runtimeOrigin,
        observedPath: tunnel.observedPath,
        release,
      };
    },
    async startAttemptAcceptor({ admissionPort }) {
      if (shutdownRequested) throw new Error('Iroh machine runtime is shut down');
      await stopAttemptAcceptor();
      if (shutdownRequested) throw new Error('Iroh machine runtime is shut down');
      // Native response validation can throw after the acceptor has started.
      // Own the attempt before awaiting it so that both failure and concurrent
      // shutdown stop through the same retryable closer.
      acceptorRunning = true;
      const attempt = native.startMachineAcceptor({
        endpointHandle: created.endpointHandle,
        admissionHost: '127.0.0.1',
        admissionPort,
      });
      startAcceptorInFlight = attempt;
      try {
        await attempt;
      } catch (error) {
        if (startAcceptorInFlight === attempt) startAcceptorInFlight = null;
        await stopAttemptAcceptor().catch(() => undefined);
        throw error;
      } finally {
        if (startAcceptorInFlight === attempt) startAcceptorInFlight = null;
      }
    },
    stopActiveTunnels,
    stopAttemptAcceptor,
    openTunnel: async (transportInput, remoteDescriptor) =>
      await openLoopbackTunnel(transportInput, remoteDescriptor, 'raw'),
    openHttpTunnel: async (transportInput, remoteDescriptor) =>
      await openLoopbackTunnel(transportInput, remoteDescriptor, 'http'),
    async openTransport(transportInput, remoteDescriptor) {
      const tunnel = await startTunnel(transportInput, remoteDescriptor);
      // Owned until the native stop succeeds, from native creation onward: a
      // local-hop failure disposes through this same closer, and a rejected
      // disposal keeps the tunnel owned and retryable by the runtime. The local
      // loopback stream is subsidiary custody: a rejected stream close must not
      // block or poison the authoritative native tunnel cleanup or its retry.
      let stream!: Awaited<ReturnType<typeof connectPeerTcpTunnelTcp>>;
      let streamOpened = false;
      const close = onceReleased(async () => {
        if (streamOpened) await Promise.resolve(stream.close()).catch(() => undefined);
        await native.stopMachineTunnel(tunnel.machineTunnelId);
        activeTunnelClosers.delete(close);
      });
      activeTunnelClosers.add(close);
      if (shutdownRequested) {
        await releaseLateCreation(close);
        throw new Error('Iroh machine runtime is shut down');
      }
      const connectTcp = input.connectTcp ?? connectPeerTcpTunnelTcp;
      try {
        stream = await connectTcp({ host: '127.0.0.1', port: tunnel.localPort });
        streamOpened = true;
        if (!stream.write) throw new Error('Iroh machine local hop is not writable');
        await stream.write(Buffer.from(tunnel.localCapability, 'ascii'));
      } catch (error) {
        await close().catch(() => undefined);
        throw error;
      }
      if (shutdownRequested) {
        // Shutdown began during the local hop: release the whole handle rather
        // than publishing a usable connection.
        await releaseLateCreation(close);
        throw new Error('Iroh machine runtime is shut down');
      }
      return {
        remoteEndpointId: tunnel.remoteEndpointId,
        observedPath: tunnel.observedPath,
        stream,
        close,
      };
    },
    async shutdown() {
      if (shutdownComplete) return;
      // New work is refused synchronously, even while a concurrent shutdown is
      // still in flight; concurrent callers share the one cleanup sequence.
      // Nothing waits for an in-flight creation before native shutdown runs:
      // native endpoint shutdown closes admission, cancels admitted work and
      // joins it, so waiting here would only withhold the cancellation the
      // creation is blocked on.
      shutdownRequested = true;
      shutdownInFlight ??= (async () => {
        let firstFailure: unknown = null;
        // Native endpoint shutdown is the admission/cancellation/join owner.
        // Reach it before awaiting any JavaScript-side release so an admitted
        // create cannot be the work that prevents its own cancellation.
        await disposeEndpoint().catch((error: unknown) => { firstFailure ??= error; });
        // These closers still own subsidiary JavaScript resources (notably the
        // local TCP stream) and retain retry custody if their idempotent native
        // release fails after aggregate endpoint shutdown.
        await stopActiveTunnels().catch((error) => { firstFailure ??= error; });
        await stopAttemptAcceptor().catch((error) => { firstFailure ??= error; });
        if (firstFailure) {
          shutdownInFlight = null;
          throw firstFailure;
        }
        shutdownComplete = true;
      })();
      await shutdownInFlight;
    },
  };
}
