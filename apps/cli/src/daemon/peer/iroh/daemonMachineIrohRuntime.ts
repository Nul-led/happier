import { join } from 'node:path';

import { IrohEndpointDescriptorV1Schema, type IrohEndpointDescriptorV1 } from '@happier-dev/protocol';
import {
  loadIrohNodeNative,
} from '@happier-dev/iroh-native/node';

import { connectPeerTcpTunnelTcp } from '../mediation/tunnel/open';
import type {
  MachineCarrierTransportConnection,
  MachineCarrierTransportOpenInput,
} from './machineCarrier';

type NodeIrohNativeModule = Extract<ReturnType<typeof loadIrohNodeNative>, { available: true }>['native'];

export type DaemonMachineIrohRelayConfig = Readonly<{
  relayPolicy: 'automatic' | 'disabled';
  relayUrls: readonly string[];
}>;

export type DaemonMachineIrohRuntime = Readonly<{
  available: true;
  endpoint: IrohEndpointDescriptorV1;
  startAttemptAcceptor: (input: Readonly<{ admissionPort: number }>) => Promise<void>;
  stopActiveTunnels: () => Promise<void>;
  stopAttemptAcceptor: () => Promise<void>;
  openTunnel: (
    input: MachineCarrierTransportOpenInput,
    endpoint: IrohEndpointDescriptorV1,
  ) => Promise<Readonly<{
    localPort: number;
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

export type UnavailableDaemonMachineIrohRuntime = Readonly<{
  available: false;
  reason: 'native_unavailable';
  message: string;
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
  const status = await native.getEndpointStatus(created.endpointHandle);
  if (!status?.active || status.endpointId !== created.endpointId) {
    await native.shutdownEndpoint({ endpointHandle: created.endpointHandle }).catch(() => undefined);
    throw new Error('Iroh machine endpoint did not become ready');
  }
  const endpoint = IrohEndpointDescriptorV1Schema.parse({
    endpointId: status.endpointId,
    ...(status.relayUrls.length > 0 ? { relayUrls: status.relayUrls } : {}),
    ...(status.directAddresses.length > 0 ? { directAddresses: status.directAddresses } : {}),
  });
  const activeTunnelClosers = new Set<() => Promise<void>>();
  let acceptorRunning = false;
  let shutdown = false;

  const stopAttemptAcceptor = async (): Promise<void> => {
    if (!acceptorRunning) return;
    acceptorRunning = false;
    await native.stopMachineAcceptor({ endpointHandle: created.endpointHandle });
  };
  const stopActiveTunnels = async (): Promise<void> => {
    await Promise.all([...activeTunnelClosers].map((close) => close()));
  };
  const startTunnel = async (
    transportInput: MachineCarrierTransportOpenInput,
    remoteDescriptor: IrohEndpointDescriptorV1,
  ) => {
    if (shutdown) throw new Error('Iroh machine runtime is shut down');
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
      capProfile: transportInput.handshake.flow === 'workspace_sync' ? 'workspaceSync' : 'machineBulk',
    });
    return tunnel;
  };

  return {
    available: true,
    endpoint,
    async startAttemptAcceptor({ admissionPort }) {
      if (shutdown) throw new Error('Iroh machine runtime is shut down');
      await stopAttemptAcceptor();
      await native.startMachineAcceptor({
        endpointHandle: created.endpointHandle,
        admissionHost: '127.0.0.1',
        admissionPort,
      });
      acceptorRunning = true;
    },
    stopActiveTunnels,
    stopAttemptAcceptor,
    async openTunnel(transportInput, remoteDescriptor) {
      const tunnel = await startTunnel(transportInput, remoteDescriptor);
      let closed = false;
      const close = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        activeTunnelClosers.delete(close);
        await native.stopMachineTunnel(tunnel.machineTunnelId);
      };
      activeTunnelClosers.add(close);
      return {
        localPort: tunnel.localPort,
        remoteEndpointId: tunnel.remoteEndpointId,
        observedPath: tunnel.observedPath,
        close,
      };
    },
    async openTransport(transportInput, remoteDescriptor) {
      const tunnel = await startTunnel(transportInput, remoteDescriptor);
      const connectTcp = input.connectTcp ?? connectPeerTcpTunnelTcp;
      let stream: Awaited<ReturnType<typeof connectPeerTcpTunnelTcp>>;
      try {
        stream = await connectTcp({ host: '127.0.0.1', port: tunnel.localPort });
      } catch (error) {
        await native.stopMachineTunnel(tunnel.machineTunnelId).catch(() => undefined);
        throw error;
      }
      let closed = false;
      const close = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        activeTunnelClosers.delete(close);
        await Promise.resolve(stream.close()).catch(() => undefined);
        await native.stopMachineTunnel(tunnel.machineTunnelId);
      };
      activeTunnelClosers.add(close);
      return {
        remoteEndpointId: tunnel.remoteEndpointId,
        observedPath: tunnel.observedPath,
        stream,
        close,
      };
    },
    async shutdown() {
      if (shutdown) return;
      shutdown = true;
      let firstFailure: unknown = null;
      await stopActiveTunnels().catch((error) => { firstFailure ??= error; });
      await stopAttemptAcceptor().catch((error) => { firstFailure ??= error; });
      await native.shutdownEndpoint({ endpointHandle: created.endpointHandle })
        .catch((error) => { firstFailure ??= error; });
      if (firstFailure) throw firstFailure;
    },
  };
}
