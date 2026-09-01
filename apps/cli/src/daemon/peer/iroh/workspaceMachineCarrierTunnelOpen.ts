import { randomBytes } from 'node:crypto';

import {
  DIRECT_ROUTE_GRANT_TTL_MS,
  DirectRouteGrantRequestV2Schema,
  IrohEndpointDescriptorV1Schema,
  IrohMachineHandshakeV1Schema,
  SignedDirectRouteGrantV2Schema,
  createEphemeralPeerRouteProofHandleV2,
} from '@happier-dev/protocol';

import type { WorkspaceSyncMachineTunnelOpen } from '@/workspaces/sync/workspaceSyncMachineCarrierStream';
import {
  MachineCarrierError,
  machineCarrierUnavailableError,
  verifyMachineCarrierHandshakeV1,
} from './machineCarrier';
import type { DaemonMachineIrohRuntime } from './daemonMachineIrohRuntime';
import type { DirectRouteGrantTrustRoot } from '../mediation/verifyDirectRouteGrantV1';

type TargetMachineCarrierSnapshot = Readonly<{
  id: string;
  daemonState: unknown;
  daemonStateVersion: number;
}>;

/**
 * Creates the Lane 08 source-side opener over Lane 06's native tunnel
 * lifecycle. Authentication and descriptor pinning complete before the
 * loopback port is exposed; Mutagen bytes remain in the native tunnel and the
 * Lane 08 controller-owned socket.
 */
export function createWorkspaceMachineCarrierTunnelOpen(input: Readonly<{
  accountId: string;
  localMachineId: string;
  runtime: DaemonMachineIrohRuntime;
  trustRoots: readonly DirectRouteGrantTrustRoot[];
  readTargetMachine: (machineId: string) => Promise<TargetMachineCarrierSnapshot | null>;
  mintGrant: (request: ReturnType<typeof DirectRouteGrantRequestV2Schema.parse>) => Promise<unknown>;
  nowMs?: () => number;
}>): WorkspaceSyncMachineTunnelOpen {
  return async (request) => {
    if (request.sourceMachineId !== input.localMachineId) {
      throw machineCarrierUnavailableError();
    }
    if (request.flow === 'file_transfer' && (!Number.isSafeInteger(request.maxBytes) || request.maxBytes! < 1)) {
      throw machineCarrierUnavailableError();
    }
    const target = await input.readTargetMachine(request.targetMachineId);
    const daemonState = target?.daemonState as { peerMediation?: { iroh?: { endpoint?: unknown } } } | null;
    const parsedEndpoint = IrohEndpointDescriptorV1Schema.safeParse(daemonState?.peerMediation?.iroh?.endpoint);
    if (!target || target.id !== request.targetMachineId || target.daemonStateVersion <= 0 || !parsedEndpoint.success) {
      throw machineCarrierUnavailableError();
    }

    const proofHandle = createEphemeralPeerRouteProofHandleV2({
      randomBytes: (length) => new Uint8Array(randomBytes(length)),
    });
    try {
      const grantRequest = DirectRouteGrantRequestV2Schema.parse({
        v: 2,
        kind: 'ephemeral_ed25519',
        ephemeralPublicKeyBase64Url: proofHandle.publicKeyBase64Url,
        machineId: request.targetMachineId,
        flowKind: request.flow === 'file_transfer' ? 'bounded_transfer' : 'machine_rpc',
        routeKind: 'iroh_peer',
        endpointFingerprint: parsedEndpoint.data.endpointId,
        ttlMs: request.flow === 'file_transfer'
          ? DIRECT_ROUTE_GRANT_TTL_MS.boundedTransferSingle
          : DIRECT_ROUTE_GRANT_TTL_MS.loopbackMachineRpcDefault,
        scope: request.flow === 'file_transfer'
          ? { kind: 'bounded_transfer', mode: 'single', transferId: request.operationId, maxBytes: request.maxBytes! }
          : {
              kind: 'machine_rpc',
              rpcScopeId: request.operationId,
              allowedMethods: ['workspace.sync'],
              maxCalls: 1,
              maxIdleMs: DIRECT_ROUTE_GRANT_TTL_MS.loopbackMachineRpcDefault,
              highRiskSingleUseMethods: ['workspace.sync'],
            },
        iroh: {
          initiator: {
            kind: 'machine',
            machineId: input.localMachineId,
            endpointId: input.runtime.endpoint.endpointId,
          },
          target: {
            machineId: request.targetMachineId,
            endpointId: parsedEndpoint.data.endpointId,
          },
          operationKind: request.flow,
        },
      });
      const grant = SignedDirectRouteGrantV2Schema.parse(await input.mintGrant(grantRequest));
      const proof = proofHandle.sign(grant);
      const current = await input.readTargetMachine(request.targetMachineId);
      const currentEndpoint = IrohEndpointDescriptorV1Schema.safeParse(
        (current?.daemonState as { peerMediation?: { iroh?: { endpoint?: unknown } } } | null)
          ?.peerMediation?.iroh?.endpoint,
      );
      if (
        !current || current.daemonStateVersion !== target.daemonStateVersion
        || !currentEndpoint.success
        || JSON.stringify(currentEndpoint.data) !== JSON.stringify(parsedEndpoint.data)
      ) {
        throw machineCarrierUnavailableError();
      }

      const handshake = IrohMachineHandshakeV1Schema.parse({
        v: 1,
        accountId: input.accountId,
        initiator: grant.payload.iroh?.initiator,
        target: grant.payload.iroh?.target,
        flow: request.flow,
        operationId: request.operationId,
        grant,
        proof,
      });
      const verified = verifyMachineCarrierHandshakeV1({
        handshake,
        accountId: input.accountId,
        machineId: input.localMachineId,
        localEndpointId: input.runtime.endpoint.endpointId,
        role: 'initiator',
        trustRoots: input.trustRoots,
        nowMs: (input.nowMs ?? Date.now)(),
      });
      const tunnel = await input.runtime.openTunnel({
        alpn: 'happier/machine/1',
        remoteEndpointId: verified.remoteEndpointId,
        flow: handshake.flow,
        operationId: handshake.operationId,
        handshake,
      }, currentEndpoint.data);
      if (tunnel.remoteEndpointId !== verified.remoteEndpointId) {
        await tunnel.close().catch(() => undefined);
        throw new MachineCarrierError(
          'transport_identity_mismatch',
          'Authenticated transport endpoint identity does not match the machine handshake.',
        );
      }
      return {
        localPort: tunnel.localPort,
        localCapability: tunnel.localCapability,
        observedPath: tunnel.observedPath,
        close: tunnel.close,
      };
    } finally {
      proofHandle.dispose();
    }
  };
}
