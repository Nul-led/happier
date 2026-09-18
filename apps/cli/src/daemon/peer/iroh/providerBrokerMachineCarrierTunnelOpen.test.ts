import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
  createProviderBrokerRouteGrantSigningInputV1,
  type ProviderBrokerOpenResponseV1,
  type ProviderBrokerRouteGrantPayloadV1,
  type SignedProviderBrokerRouteGrantV1,
} from '@happier-dev/protocol';
import { createProviderBrokerMachineCarrierTunnelOpen } from './providerBrokerMachineCarrierTunnelOpen';
import type { DaemonMachineIrohRuntime } from './daemonMachineIrohRuntime';

const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const root = { keyId: 'home', publicKey: Buffer.from(key.publicKey).toString('base64url') };
const initiatorEndpoint = 'a'.repeat(64);
const targetEndpoint = 'b'.repeat(64);

function authority(overrides: Partial<ProviderBrokerRouteGrantPayloadV1> = {}): SignedProviderBrokerRouteGrantV1 {
  const payload: ProviderBrokerRouteGrantPayloadV1 = {
    v: 1,
    grantId: 'grant-1',
    aud: 'happier-provider-broker-route-v1',
    issuedAt: 100,
    expiresAt: 10_000,
    teamId: 'team-1',
    resourceId: 'resource-1',
    expectedResourceRevision: 7,
    modelId: 'gpt-5',
    sourceRevision: 'source-revision-7',
    initiator: { accountId: 'account-worker', machineId: 'machine-worker', endpointId: initiatorEndpoint },
    target: { custodianAccountId: 'account-custodian', machineId: 'machine-broker', endpointId: targetEndpoint },
    consumer: { kind: 'session', sessionId: 'session-1' },
    application: {
      agentTargetKey: 'codex',
      implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
      endpointTemplateId: 'cliproxyapi-openai-responses',
      protocol: 'openai-responses',
    },
    ...overrides,
  };
  return {
    payload,
    signature: {
      alg: 'Ed25519',
      keyId: 'home',
      valueBase64Url: Buffer.from(tweetnacl.sign.detached(
        Buffer.from(createProviderBrokerRouteGrantSigningInputV1(payload)),
        key.secretKey,
      )).toString('base64url'),
    },
  };
}

function brokerOpen(
  signed: SignedProviderBrokerRouteGrantV1 = authority(),
  targetOverrides: Partial<Extract<ProviderBrokerOpenResponseV1, { ok: true }>['target']> = {},
): Extract<ProviderBrokerOpenResponseV1, { ok: true }> {
  return {
    ok: true,
    authority: signed,
    target: {
      custodianAccountId: signed.payload.target.custodianAccountId,
      brokerMachineId: signed.payload.target.machineId,
      endpointId: signed.payload.target.endpointId,
      endpointRevision: 7,
      ...targetOverrides,
    },
  };
}

describe('createProviderBrokerMachineCarrierTunnelOpen', () => {
  it('uses the Home-signed cross-Account target without broad Machine-read authority', async () => {
    const close = vi.fn(async () => undefined);
    const openHttpTunnel = vi.fn<DaemonMachineIrohRuntime['openHttpTunnel']>(async () => ({
      localPort: 41_001,
      localCapability: 'c'.repeat(64),
      remoteEndpointId: targetEndpoint,
      observedPath: 'relay' as const,
      close,
    }));
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker',
      localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root],
      nowMs: () => 200,
    });

    const refreshBrokerOpen = vi.fn(async () => brokerOpen(authority({ grantId: 'grant-2' })));

    await expect(open({ brokerOpen: brokerOpen(), refreshBrokerOpen })).resolves.toMatchObject({
      localPort: 41_001,
      localCapability: 'c'.repeat(64),
      observedPath: 'relay',
    });
    expect(openHttpTunnel).toHaveBeenCalledWith(expect.objectContaining({
      flow: 'provider_broker',
      remoteEndpointId: targetEndpoint,
      handshake: { v: 1, kind: 'provider_broker', authority: expect.any(Object) },
    }), { endpointId: targetEndpoint });
    const transport = openHttpTunnel.mock.calls[0]?.[0];
    await expect(transport?.handshakeProvider?.()).resolves.toEqual({
      v: 1,
      kind: 'provider_broker',
      authority: expect.objectContaining({ payload: expect.objectContaining({ grantId: 'grant-2' }) }),
    });
    expect(refreshBrokerOpen).toHaveBeenCalledOnce();
  });

  it('retires the signed broker stream through the authenticated tunnel before native close', async () => {
    const order: string[] = [];
    const close = vi.fn(async () => { order.push('transport-close'); });
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      order.push('retire-ack');
      expect(init).toMatchObject({
        method: 'DELETE',
        redirect: 'error',
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Bearer /),
          'x-happier-machine-local-capability': 'c'.repeat(64),
        }),
      });
      return new Response(null, { status: 204 });
    });
    const openHttpTunnel = vi.fn<DaemonMachineIrohRuntime['openHttpTunnel']>(async () => ({
      localPort: 41_001,
      localCapability: 'c'.repeat(64),
      remoteEndpointId: targetEndpoint,
      observedPath: 'relay' as const,
      close,
    }));
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker',
      localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root],
      nowMs: () => 200,
      fetchImpl,
    });

    const tunnel = await open({ brokerOpen: brokerOpen() });
    await tunnel.retire();
    await tunnel.retire();
    await tunnel.close();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(order).toEqual(['retire-ack', 'transport-close']);
  });

  it('fails a new stream closed when Home returns a changed sealed binding', async () => {
    const openHttpTunnel = vi.fn<DaemonMachineIrohRuntime['openHttpTunnel']>(async () => ({
      localPort: 41_001,
      localCapability: 'c'.repeat(64),
      remoteEndpointId: targetEndpoint,
      observedPath: 'direct' as const,
      close: vi.fn(async () => undefined),
    }));
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker', localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root], nowMs: () => 200,
    });
    await open({
      brokerOpen: brokerOpen(),
      refreshBrokerOpen: async () => brokerOpen(authority({ resourceId: 'other-resource' })),
    });
    const transport = openHttpTunnel.mock.calls[0]?.[0];
    await expect(transport?.handshakeProvider?.()).rejects.toMatchObject({ code: 'broker_binding_changed' });
  });

  it('requests Home again and rejects an expired witness before a later stream opens', async () => {
    const openHttpTunnel = vi.fn<DaemonMachineIrohRuntime['openHttpTunnel']>(async () => ({
      localPort: 41_004, localCapability: 'f'.repeat(64), remoteEndpointId: targetEndpoint,
      observedPath: 'direct' as const, close: vi.fn(async () => undefined),
    }));
    const times = [200, 200, 200, 20_000];
    const refreshBrokerOpen = vi.fn(async () => brokerOpen(authority({ grantId: `fresh-${refreshBrokerOpen.mock.calls.length}` })));
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker', localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root], nowMs: () => times.shift() ?? 20_000,
    });
    await open({ brokerOpen: brokerOpen(), refreshBrokerOpen });
    const provider = openHttpTunnel.mock.calls[0]?.[0].handshakeProvider;
    await expect(provider?.()).resolves.toMatchObject({ kind: 'provider_broker' });
    await expect(provider?.()).rejects.toMatchObject({ code: 'grant_expired' });
    expect(refreshBrokerOpen).toHaveBeenCalledTimes(2);
  });

  it('rejects either a substituted open witness or a tampered signed endpoint before dialing', async () => {
    const openHttpTunnel = vi.fn();
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker', localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root], nowMs: () => 200,
    });
    const signed = authority();
    const substituted = {
      ...signed,
      payload: {
        ...signed.payload,
        target: { ...signed.payload.target, endpointId: 'c'.repeat(64) },
      },
    };
    await expect(open({ brokerOpen: brokerOpen(authority(), { endpointId: 'c'.repeat(64) }) }))
      .rejects.toMatchObject({ code: 'broker_target_endpoint_changed' });
    await expect(open({ brokerOpen: brokerOpen(substituted) }))
      .rejects.toMatchObject({ code: 'grant_bad_signature' });
    await expect(open({ brokerOpen: brokerOpen(authority({
      initiator: {
        accountId: 'account-worker',
        machineId: 'machine-worker',
        endpointId: 'd'.repeat(64),
      },
    })) }))
      .rejects.toMatchObject({ code: 'broker_initiator_mismatch' });
    expect(openHttpTunnel).not.toHaveBeenCalled();
  });

  it('closes a tunnel whose authenticated remote identity does not match the signed target', async () => {
    const close = vi.fn(async () => undefined);
    const openHttpTunnel = vi.fn(async () => ({
      localPort: 41_002,
      localCapability: 'd'.repeat(64),
      remoteEndpointId: 'c'.repeat(64),
      observedPath: 'direct' as const,
      close,
    }));
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker', localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root], nowMs: () => 200,
    });
    await expect(open({ brokerOpen: brokerOpen() })).rejects.toMatchObject({ code: 'transport_identity_mismatch' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('rechecks signed authority currentness immediately before dialing', async () => {
    const openHttpTunnel = vi.fn();
    const times = [200, 20_000];
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker', localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root],
      nowMs: () => times.shift() ?? 20_000,
    });
    await expect(open({ brokerOpen: brokerOpen() })).rejects.toMatchObject({ code: 'grant_expired' });
    expect(openHttpTunnel).not.toHaveBeenCalled();
  });

  it('settles promptly on cancellation while native open is pending and closes its late tunnel', async () => {
    const close = vi.fn(async () => undefined);
    let resolveTunnel!: (value: {
      localPort: number;
      localCapability: string;
      remoteEndpointId: string;
      observedPath: 'relay';
      close(): Promise<void>;
    }) => void;
    const pendingTunnel = new Promise<Parameters<typeof resolveTunnel>[0]>((resolve) => { resolveTunnel = resolve; });
    const openHttpTunnel = vi.fn(async () => await pendingTunnel);
    const open = createProviderBrokerMachineCarrierTunnelOpen({
      accountId: 'account-worker', localMachineId: 'machine-worker',
      runtime: { endpoint: { endpointId: initiatorEndpoint }, openHttpTunnel } as never,
      resolveTrustRoots: () => [root], nowMs: () => 200,
    });
    const controller = new AbortController();
    const reason = new Error('cancelled native dial');
    const result = open({ brokerOpen: brokerOpen(), signal: controller.signal });
    await vi.waitFor(() => expect(openHttpTunnel).toHaveBeenCalledOnce());
    controller.abort(reason);

    await expect(Promise.race([
      result,
      new Promise((_, reject) => setTimeout(() => reject(new Error('cancellation did not settle')), 100)),
    ])).rejects.toBe(reason);
    resolveTunnel({
      localPort: 41_003,
      localCapability: 'e'.repeat(64),
      remoteEndpointId: targetEndpoint,
      observedPath: 'relay',
      close,
    });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
