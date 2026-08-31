import { describe, expect, it } from 'vitest';

import {
  DirectRouteGrantPayloadV2Schema,
  DirectRouteGrantRequestV2Schema,
  SignedDirectRouteGrantV2Schema,
  createDirectRouteGrantSigningInputV2,
  type IrohPeerRouteBindingV2,
} from './directRouteGrantV2';

const publicKeyBase64Url = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const sourceEndpointId = 'a'.repeat(64);
const targetEndpointId = 'b'.repeat(64);

const irohBinding: IrohPeerRouteBindingV2 = {
  sourceMachineId: 'machine-source',
  targetMachineId: 'machine-target',
  sourceEndpointId,
  targetEndpointId,
  role: 'initiator',
  operationKind: 'file_transfer',
};

function payload() {
  return {
    v: 2 as const,
    grantId: 'grant-v2',
    grantFamilyId: 'family-v2',
    accountId: 'account-1',
    machineId: 'machine-1',
    flowKind: 'machine_rpc' as const,
    routeKind: 'loopback_direct' as const,
    scope: {
      kind: 'machine_rpc' as const,
      rpcScopeId: 'machine-1:daemon.getState',
      allowedMethods: ['daemon.getState'],
      maxCalls: 1,
      maxIdleMs: 30_000,
    },
    iat: 1_000,
    exp: 2_000,
    aud: 'happier-daemon-route-grant' as const,
    endpointFingerprint: 'endpoint-1',
    proofKind: 'ephemeral_ed25519' as const,
    ephemeralPublicKeyBase64Url: publicKeyBase64Url,
  };
}

describe('DirectRouteGrantV2', () => {
  it('requires and signs the canonical machine/1 binding on iroh_peer requests and payloads', () => {
    const scope = {
      kind: 'bounded_transfer' as const,
      mode: 'single' as const,
      transferId: 'transfer-1',
      maxBytes: 1_024,
    };
    const request = {
      v: 2 as const,
      kind: 'ephemeral_ed25519' as const,
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      machineId: irohBinding.targetMachineId,
      flowKind: 'bounded_transfer' as const,
      routeKind: 'iroh_peer' as const,
      endpointFingerprint: targetEndpointId,
      ttlMs: 1_000,
      scope,
      iroh: irohBinding,
    };
    const grantPayload = {
      ...request,
      grantId: 'grant-iroh-v2',
      accountId: 'account-1',
      iat: 1_000,
      exp: 2_000,
      aud: 'happier-daemon-route-grant' as const,
      proofKind: 'ephemeral_ed25519' as const,
    };
    const { kind: _kind, ttlMs: _ttlMs, ...payloadFields } = grantPayload;
    void _kind;
    void _ttlMs;

    expect(DirectRouteGrantRequestV2Schema.parse(request).iroh).toEqual(irohBinding);
    expect(DirectRouteGrantPayloadV2Schema.parse(payloadFields).iroh).toEqual(irohBinding);
    expect(DirectRouteGrantRequestV2Schema.safeParse({ ...request, iroh: undefined }).success).toBe(false);
    expect(DirectRouteGrantPayloadV2Schema.safeParse({ ...payloadFields, iroh: undefined }).success).toBe(false);
    expect(DirectRouteGrantPayloadV2Schema.safeParse({
      ...payloadFields,
      machineId: irohBinding.sourceMachineId,
    }).success).toBe(false);
  });

  it('owns the strict machine/1 binding validation on V2', () => {
    const request = {
      v: 2 as const,
      kind: 'ephemeral_ed25519' as const,
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      machineId: irohBinding.targetMachineId,
      flowKind: 'bounded_transfer' as const,
      routeKind: 'iroh_peer' as const,
      endpointFingerprint: targetEndpointId,
      ttlMs: 1_000,
      scope: {
        kind: 'bounded_transfer' as const,
        mode: 'single' as const,
        transferId: 'transfer-1',
        maxBytes: 1_024,
      },
      iroh: irohBinding,
    };

    expect(DirectRouteGrantRequestV2Schema.safeParse({
      ...request,
      iroh: { ...irohBinding, role: 'observer' },
    }).success).toBe(false);
    expect(DirectRouteGrantRequestV2Schema.safeParse({
      ...request,
      iroh: { ...irohBinding, operationKind: 'tcp_tunnel' },
    }).success).toBe(false);
    expect(DirectRouteGrantRequestV2Schema.safeParse({
      ...request,
      iroh: { ...irohBinding, targetEndpointId: sourceEndpointId },
    }).success).toBe(false);
  });

  it('parses a complete strict V2 request and signed grant without changing V1', () => {
    expect(DirectRouteGrantRequestV2Schema.parse({
      v: 2,
      kind: 'ephemeral_ed25519',
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      machineId: 'machine-1',
      flowKind: 'machine_rpc',
      routeKind: 'loopback_direct',
      endpointFingerprint: 'endpoint-1',
      ttlMs: 1_000,
      scope: payload().scope,
    })).toMatchObject({ v: 2, kind: 'ephemeral_ed25519' });

    expect(SignedDirectRouteGrantV2Schema.parse({
      payload: payload(),
      signature: {
        keyId: 'server-key',
        alg: 'Ed25519',
        valueBase64Url: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg',
      },
    }).payload.ephemeralPublicKeyBase64Url).toBe(publicKeyBase64Url);
  });

  it('rejects unknown fields and non-canonical or wrong-length base64url values', () => {
    expect(DirectRouteGrantPayloadV2Schema.safeParse({ ...payload(), extra: true }).success).toBe(false);
    expect(DirectRouteGrantRequestV2Schema.safeParse({
      v: 2,
      kind: 'ephemeral_ed25519',
      ephemeralPublicKeyBase64Url: `${publicKeyBase64Url}=`,
      machineId: 'machine-1',
      flowKind: 'machine_rpc',
      routeKind: 'loopback_direct',
      endpointFingerprint: 'endpoint-1',
      ttlMs: 1_000,
      scope: payload().scope,
    }).success).toBe(false);
    expect(DirectRouteGrantPayloadV2Schema.safeParse({
      ...payload(),
      ephemeralPublicKeyBase64Url: publicKeyBase64Url.slice(1),
    }).success).toBe(false);
    expect(DirectRouteGrantRequestV2Schema.safeParse({
      v: 2,
      kind: 'ephemeral_ed25519',
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      machineId: 'machine-1',
      flowKind: 'machine_rpc',
      routeKind: 'loopback_direct',
      endpointFingerprint: 'endpoint-1',
      ttlMs: 1_000,
      scope: { ...payload().scope, extra: true },
    }).success).toBe(false);
  });

  it('canonicalizes every parsed V2 grant binding', () => {
    const reordered = {
      proofKind: 'ephemeral_ed25519' as const,
      endpointFingerprint: 'endpoint-1',
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      aud: 'happier-daemon-route-grant' as const,
      exp: 2_000,
      iat: 1_000,
      scope: payload().scope,
      routeKind: 'loopback_direct' as const,
      flowKind: 'machine_rpc' as const,
      machineId: 'machine-1',
      accountId: 'account-1',
      grantFamilyId: 'family-v2',
      grantId: 'grant-v2',
      v: 2 as const,
    };
    expect(createDirectRouteGrantSigningInputV2(reordered)).toBe(
      createDirectRouteGrantSigningInputV2(payload()),
    );
  });

  it('binds the closed Voice media application authority to the signed grant scope', () => {
    const scope = {
      kind: 'voice_media' as const,
      tunnelId: 'voice-tunnel-1',
      applicationKind: 'speech_transcription' as const,
      applicationAttemptId: 'attempt-1',
      applicationAuthorityDigest: `sha256:${'ab'.repeat(32)}`,
      maxIdleMs: 30_000,
      maxDurationMs: 600_000,
      maxTotalBytes: 8_388_608,
    };
    expect(DirectRouteGrantRequestV2Schema.parse({
      v: 2,
      kind: 'ephemeral_ed25519',
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      machineId: 'machine-1',
      flowKind: 'voice_media',
      routeKind: 'loopback_direct',
      endpointFingerprint: 'endpoint-1',
      ttlMs: 1_000,
      scope,
    }).scope).toEqual(scope);

    expect(DirectRouteGrantRequestV2Schema.safeParse({
      v: 2,
      kind: 'ephemeral_ed25519',
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      machineId: 'machine-1',
      flowKind: 'tcp_tunnel',
      routeKind: 'loopback_direct',
      endpointFingerprint: 'endpoint-1',
      ttlMs: 1_000,
      scope,
    }).success).toBe(false);

    expect(DirectRouteGrantRequestV2Schema.safeParse({
      v: 2,
      kind: 'ephemeral_ed25519',
      ephemeralPublicKeyBase64Url: publicKeyBase64Url,
      machineId: 'machine-1',
      flowKind: 'voice_media',
      routeKind: 'loopback_direct',
      endpointFingerprint: 'endpoint-1',
      ttlMs: 1_000,
      scope: {
        ...scope,
        applicationKind: 'agent_realtime',
      },
    }).success).toBe(false);
  });
});
