import { randomBytes } from 'node:crypto';
import { MACHINE_ALPN } from '@happier-dev/iroh-native/node';

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

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('The workspace machine tunnel open was aborted.'), { name: 'AbortError' });
}

async function awaitNativeTunnelOpen<T extends Readonly<{ close: () => Promise<void> }>>(
  opening: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return await opening;
  if (signal.aborted) {
    void opening.then(async (late) => await late.close()).catch(() => undefined);
    throw abortReason(signal);
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      // The native ABI cannot cancel an admitted dial. Keep ownership in this
      // closure until a late handle arrives and its lifecycle is closed.
      void opening.then(async (late) => await late.close()).catch(() => undefined);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    opening.then(
      (tunnel) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(tunnel);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

async function awaitControlPlane<T>(opening: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return await opening;
  if (signal.aborted) {
    // Attach a rejection handler even when the caller is already cancelled so a
    // late control-plane failure cannot become an unhandled rejection.
    void opening.catch(() => undefined);
    throw abortReason(signal);
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    opening.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

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
  resolveTrustRoots: () => readonly DirectRouteGrantTrustRoot[];
  readTargetMachine: (machineId: string, signal?: AbortSignal) => Promise<TargetMachineCarrierSnapshot | null>;
  mintGrant: (request: ReturnType<typeof DirectRouteGrantRequestV2Schema.parse>, signal?: AbortSignal) => Promise<unknown>;
  nowMs?: () => number;
}>): WorkspaceSyncMachineTunnelOpen {
  return async (request) => {
    if (request.sourceMachineId !== input.localMachineId) {
      throw machineCarrierUnavailableError();
    }
    request.signal?.throwIfAborted();
    const targetRead = request.signal
      ? input.readTargetMachine(request.targetMachineId, request.signal)
      : input.readTargetMachine(request.targetMachineId);
    const target = await awaitControlPlane(targetRead, request.signal);
    const daemonState = target?.daemonState as { peerMediation?: { iroh?: { endpoint?: unknown } } } | null;
    const parsedEndpoint = IrohEndpointDescriptorV1Schema.safeParse(daemonState?.peerMediation?.iroh?.endpoint);
    if (!target || target.id !== request.targetMachineId || !parsedEndpoint.success) {
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
          ? DIRECT_ROUTE_GRANT_TTL_MS.finiteTransferCarrier
          : DIRECT_ROUTE_GRANT_TTL_MS.loopbackMachineRpcDefault,
        scope: request.flow === 'file_transfer'
          ? { kind: 'bounded_transfer', mode: 'carrier' }
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
          operationKind: request.flow === 'file_transfer' ? 'finite_transfer' : 'workspace_sync',
        },
      });
      request.signal?.throwIfAborted();
      const grantRequestResult = request.signal
        ? input.mintGrant(grantRequest, request.signal)
        : input.mintGrant(grantRequest);
      const grant = SignedDirectRouteGrantV2Schema.parse(await awaitControlPlane(
        grantRequestResult,
        request.signal,
      ));
      const proof = proofHandle.sign(grant);
      request.signal?.throwIfAborted();
      const currentRead = request.signal
        ? input.readTargetMachine(request.targetMachineId, request.signal)
        : input.readTargetMachine(request.targetMachineId);
      const current = await awaitControlPlane(currentRead, request.signal);
      const currentEndpoint = IrohEndpointDescriptorV1Schema.safeParse(
        (current?.daemonState as { peerMediation?: { iroh?: { endpoint?: unknown } } } | null)
          ?.peerMediation?.iroh?.endpoint,
      );
      if (
        !current || current.id !== request.targetMachineId
        || !currentEndpoint.success
        || currentEndpoint.data.endpointId !== grant.payload.iroh?.target.endpointId
      ) {
        throw machineCarrierUnavailableError();
      }

      const handshake = IrohMachineHandshakeV1Schema.parse({
        v: 1,
        accountId: input.accountId,
        initiator: grant.payload.iroh?.initiator,
        target: grant.payload.iroh?.target,
        ...(request.flow === 'file_transfer'
          ? { flow: 'finite_transfer' as const }
          : { flow: 'workspace_sync' as const, operationId: request.operationId }),
        grant,
        proof,
      });
      const verified = verifyMachineCarrierHandshakeV1({
        handshake,
        accountId: input.accountId,
        machineId: input.localMachineId,
        localEndpointId: input.runtime.endpoint.endpointId,
        role: 'initiator',
        trustRoots: input.resolveTrustRoots(),
        nowMs: (input.nowMs ?? Date.now)(),
      });
      request.signal?.throwIfAborted();
      const openNativeTunnel = request.flow === 'file_transfer'
        ? input.runtime.openHttpTunnel
        : input.runtime.openTunnel;
      const tunnel = await awaitNativeTunnelOpen(openNativeTunnel({
        alpn: MACHINE_ALPN,
        remoteEndpointId: verified.remoteEndpointId,
        flow: handshake.flow,
        ...('operationId' in handshake ? { operationId: handshake.operationId } : {}),
        handshake,
      }, currentEndpoint.data), request.signal);
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
