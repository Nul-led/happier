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

  const created = await native.createEndpoint({
    keyPath: join(input.happyHomeDir, 'runtime', 'iroh', 'endpoint.key'),
    relayPolicy: input.relayConfig.relayPolicy,
    ...(input.relayConfig.relayUrls.length > 0 ? { relayUrls: input.relayConfig.relayUrls } : {}),
    capProfile: 'machineBulk',
  });
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
    try {
      await disposeEndpoint();
    } catch {
      // The endpoint exists but native cleanup did not settle. Return the same
      // retryable closer to the daemon process owner instead of losing custody
      // behind the startup error.
      return {
        available: false,
        reason: 'startup_failed',
        error,
        shutdown: disposeEndpoint,
      };
    }
    throw error;
  }
  const activeTunnelClosers = new Set<() => Promise<void>>();
  const activeHomeTunnelClosers = new Set<() => Promise<void>>();
  // Settlements of admitted-but-unresolved tunnel creations. A creation is
  // admitted once it passes its shutdown gate, and it registers its native
  // custody before its admission settles, so the stop sweep can never resolve
  // while a creation racing shutdown could still publish a tunnel.
  const pendingCreationSettlements = new Set<Promise<void>>();
  const admitCreation = <T>(create: () => Promise<T>): Promise<T> => {
    let creation: Promise<T>;
    try {
      creation = create();
    } catch (error) {
      return Promise.reject(error);
    }
    const settled = creation.then(() => undefined, () => undefined);
    pendingCreationSettlements.add(settled);
    void settled.then(() => {
      pendingCreationSettlements.delete(settled);
    });
    return creation;
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
    // Settle every admitted creation first: its custody is registered when the
    // native call resolves, so a sweep that ran mid-creation would resolve
    // while the created tunnel could still be published.
    await Promise.all([...pendingCreationSettlements]);
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
  ) => {
    if (shutdownRequested) throw new Error('Iroh machine runtime is shut down');
    if (
      transportInput.flow !== transportInput.handshake.flow
      || transportInput.operationId !== transportInput.handshake.operationId
    ) {
      throw new Error('Iroh machine transport request does not match the verified handshake');
    }
    const parsedRemote = IrohEndpointDescriptorV1Schema.parse(remoteDescriptor);
    if (parsedRemote.endpointId !== transportInput.remoteEndpointId) {
      throw new Error('Iroh machine endpoint descriptor does not match the verified handshake');
    }
    const tunnel = await native.startMachineTunnel({
      endpointHandle: created.endpointHandle,
      endpointId: parsedRemote.endpointId,
      ...(parsedRemote.directAddresses ? { directAddresses: parsedRemote.directAddresses } : {}),
      ...(parsedRemote.relayUrls ? { relayUrls: parsedRemote.relayUrls } : {}),
      handshakeJson: JSON.stringify(transportInput.handshake),
      capProfile: 'machineBulk',
    });
    return tunnel;
  };

  return {
    available: true,
    endpoint,
    async ensureHomeTunnel({ descriptor }) {
      if (shutdownRequested) throw new Error('Iroh daemon runtime is shut down');
      const parsed = HomeConnectionDescriptorV1Schema.parse(descriptor);
      const homeEndpoint = parsed.endpoints.find((candidate) => candidate.kind === 'iroh');
      if (!homeEndpoint) throw new Error('Home descriptor does not contain an Iroh endpoint');
      return admitCreation(async () => {
        const tunnel = await native.ensureHomeTunnel({
          endpointHandle: created.endpointHandle,
          homeServerIdentityId: parsed.homeServerIdentityId,
          endpointId: homeEndpoint.endpointId,
          ...(homeEndpoint.directAddresses ? { directAddresses: homeEndpoint.directAddresses } : {}),
          ...(homeEndpoint.relayUrls ? { relayUrls: homeEndpoint.relayUrls } : {}),
          descriptorRevision: parsed.revision,
        });
        // The lease stays owned until native release succeeds; concurrent
        // release callers share the one in-flight native call. Custody is
        // registered inside the admission so a shutdown racing this creation
        // sweeps it.
        const release = onceReleased(async () => {
          await native.releaseHomeTunnel(tunnel.tunnelId);
          activeHomeTunnelClosers.delete(release);
        });
        activeHomeTunnelClosers.add(release);
        if (shutdownRequested) {
          // The native ABI cannot cancel an in-flight creation, so the sweep
          // owns and releases it above; fail this caller closed instead of
          // publishing a lease during shutdown.
          throw new Error('Iroh daemon runtime is shut down');
        }
        return {
          runtimeOrigin: tunnel.runtimeOrigin,
          observedPath: tunnel.observedPath,
          release,
        };
      });
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
    async openTunnel(transportInput, remoteDescriptor) {
      return admitCreation(async () => {
        const tunnel = await startTunnel(transportInput, remoteDescriptor);
        // Owned until the native stop succeeds; concurrent close callers share
        // the one in-flight native call. Custody is registered inside the
        // admission so a shutdown racing this creation sweeps it.
        const close = onceReleased(async () => {
          await native.stopMachineTunnel(tunnel.machineTunnelId);
          activeTunnelClosers.delete(close);
        });
        activeTunnelClosers.add(close);
        if (shutdownRequested) {
          // The native ABI cannot cancel an in-flight creation, so the sweep
          // owns and releases it above; fail this caller closed instead of
          // publishing a handle during shutdown.
          throw new Error('Iroh machine runtime is shut down');
        }
        return {
          localPort: tunnel.localPort,
          localCapability: tunnel.localCapability,
          remoteEndpointId: tunnel.remoteEndpointId,
          observedPath: tunnel.observedPath,
          close,
        };
      });
    },
    async openTransport(transportInput, remoteDescriptor) {
      return admitCreation(async () => {
        const tunnel = await startTunnel(transportInput, remoteDescriptor);
        // Owned until the native stop succeeds, from native creation onward: a
        // local-hop failure disposes through this same closer, and a rejected
        // disposal keeps the tunnel owned and retryable by the runtime. The local
        // loopback stream is subsidiary custody: a rejected stream close must not
        // block or poison the authoritative native tunnel cleanup or its retry.
        // Custody is registered inside the admission so a shutdown racing this
        // creation sweeps it.
        let stream!: Awaited<ReturnType<typeof connectPeerTcpTunnelTcp>>;
        let streamOpened = false;
        const close = onceReleased(async () => {
          if (streamOpened) await Promise.resolve(stream.close()).catch(() => undefined);
          await native.stopMachineTunnel(tunnel.machineTunnelId);
          activeTunnelClosers.delete(close);
        });
        activeTunnelClosers.add(close);
        if (shutdownRequested) {
          // The native ABI cannot cancel an in-flight creation, so the sweep
          // owns and releases it above; do not open the local hop during
          // shutdown.
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
          // Shutdown began during the local hop: the sweep owns the closer and
          // releases both the stream and the native tunnel, so fail closed
          // instead of publishing a usable connection.
          throw new Error('Iroh machine runtime is shut down');
        }
        return {
          remoteEndpointId: tunnel.remoteEndpointId,
          observedPath: tunnel.observedPath,
          stream,
          close,
        };
      });
    },
    async shutdown() {
      if (shutdownComplete) return;
      // New work is refused immediately, even while a concurrent shutdown is
      // still in flight; concurrent callers share the one cleanup sequence.
      shutdownRequested = true;
      shutdownInFlight ??= (async () => {
        let firstFailure: unknown = null;
        await stopActiveTunnels().catch((error) => { firstFailure ??= error; });
        await stopAttemptAcceptor().catch((error) => { firstFailure ??= error; });
        // The same endpoint closer that owns a failed startup disposal owns
        // shutdown, so repeated shutdown callers retry it until it succeeds.
        await disposeEndpoint().catch((error: unknown) => { firstFailure ??= error; });
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
