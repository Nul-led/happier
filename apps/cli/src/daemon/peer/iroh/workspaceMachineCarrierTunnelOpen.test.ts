import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
  createDirectRouteGrantSigningInputV2,
  type DirectRouteGrantRequestV2,
} from '@happier-dev/protocol';
import { createWorkspaceMachineCarrierTunnelOpen } from './workspaceMachineCarrierTunnelOpen';

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

describe('createWorkspaceMachineCarrierTunnelOpen', () => {
  it('binds one exact target descriptor revision and returns only the native tunnel lifecycle', async () => {
    const signingKeyPair = tweetnacl.sign.keyPair();
    const localEndpointId = 'a'.repeat(64);
    const targetEndpointId = 'b'.repeat(64);
    const target = {
      id: 'machine-target',
      daemonStateVersion: 7,
      daemonState: { peerMediation: { iroh: { endpoint: { endpointId: targetEndpointId, directAddresses: ['10.0.0.2:7777'] } } } },
    };
    const readTargetMachine = vi.fn(async () => target);
    const mintGrant = vi.fn(async (request: DirectRouteGrantRequestV2) => {
      const { kind, ttlMs: _ttlMs, ...binding } = request;
      const payload = {
        ...binding,
        grantId: 'grant-1',
        accountId: 'account-1',
        iat: 1_000,
        exp: 301_000,
        aud: 'happier-daemon-route-grant' as const,
        proofKind: kind,
      };
      return {
        payload,
        signature: {
          keyId: 'key-1',
          alg: 'Ed25519' as const,
          valueBase64Url: base64url(tweetnacl.sign.detached(
            Buffer.from(createDirectRouteGrantSigningInputV2(payload), 'utf8'),
            signingKeyPair.secretKey,
          )),
        },
      };
    });
    const close = vi.fn(async () => undefined);
    const openTunnel = vi.fn(async () => ({
      localPort: 48123,
      remoteEndpointId: targetEndpointId,
      observedPath: 'direct' as const,
      close,
    }));
    const open = createWorkspaceMachineCarrierTunnelOpen({
      accountId: 'account-1',
      localMachineId: 'machine-source',
      runtime: { available: true, endpoint: { endpointId: localEndpointId }, openTunnel } as never,
      trustRoots: [{ keyId: 'key-1', publicKey: base64url(signingKeyPair.publicKey) }],
      readTargetMachine,
      mintGrant,
      nowMs: () => 2_000,
    });

    const tunnel = await open({
      operationId: 'operation-1', sourceMachineId: 'machine-source', targetMachineId: 'machine-target', flow: 'workspace_sync',
    });
    expect(mintGrant).toHaveBeenCalledWith(expect.objectContaining({
      v: 2,
      machineId: 'machine-target',
      flowKind: 'machine_rpc',
      routeKind: 'iroh_peer',
      endpointFingerprint: targetEndpointId,
      scope: expect.objectContaining({ rpcScopeId: 'operation-1', maxCalls: 1 }),
      iroh: expect.objectContaining({ sourceEndpointId: localEndpointId, targetEndpointId, operationKind: 'workspace_sync' }),
    }));
    expect(readTargetMachine).toHaveBeenCalledTimes(2);
    expect(openTunnel).toHaveBeenCalledWith(
      expect.objectContaining({ handshake: expect.objectContaining({ operationId: 'operation-1', proof: expect.any(Object) }) }),
      target.daemonState.peerMediation.iroh.endpoint,
    );
    expect(tunnel).toEqual({ localPort: 48123, observedPath: 'direct', close });
  });

  it('fails closed without a stable exact descriptor revision and never opens a native tunnel', async () => {
    const openTunnel = vi.fn();
    const open = createWorkspaceMachineCarrierTunnelOpen({
      accountId: 'account-1', localMachineId: 'machine-source',
      runtime: { available: true, endpoint: { endpointId: 'a'.repeat(64) }, openTunnel } as never,
      trustRoots: [], readTargetMachine: async () => null, mintGrant: vi.fn(),
    });
    await expect(open({ operationId: 'operation-1', sourceMachineId: 'machine-source', targetMachineId: 'missing', flow: 'workspace_sync' }))
      .rejects.toMatchObject({ code: 'machine_carrier_unavailable' });
    expect(openTunnel).not.toHaveBeenCalled();
  });
});
