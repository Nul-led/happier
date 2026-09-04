import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { once } from 'node:events';
import { connect, createServer } from 'node:net';

import {
  DIRECT_ROUTE_GRANT_AUDIENCE_V1,
  createDirectRouteGrantSigningInputV1,
  createDirectRouteGrantSigningInputV2,
  createEphemeralPeerRouteProofHandleV2,
  createPeerMachineRpcRequestHashV1,
  PEER_MEDIATION_RECEIPTS,
  type DirectRouteGrantPayloadV1,
  type DirectRouteGrantPayloadV2,
  type IrohMachineHandshakeV1,
  type MachineLiveStreamFrameV1,
  type SignedDirectRouteGrantV1,
  type SignedDirectRouteGrantV2,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  IROH_MACHINE_ADMISSION_PATH,
  IROH_MACHINE_APPLICATION_CAPABILITY_HEADER,
  IROH_MACHINE_APPLICATION_PORT_HEADER,
  IROH_MACHINE_REMOTE_ENDPOINT_HEADER,
} from '@happier-dev/iroh-native/node';

import { createPeerRouteNonceProofV1 } from '../verifyDirectRouteGrantV1';
import {
  assertPeerMediationLoopbackBindHost,
  createPeerMediationLoopbackApp,
  PEER_MEDIATION_LOOPBACK_BODY_LIMIT_BYTES,
  startPeerMediationLoopbackServer,
} from './server';

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function createSignedGrant(input: Readonly<{
  signingSecretKey: Uint8Array;
  keyId: string;
  endpointFingerprint: string;
}>): SignedDirectRouteGrantV1 {
  const payload: DirectRouteGrantPayloadV1 = {
    v: 1,
    grantId: 'grant_1',
    grantFamilyId: 'family_1',
    accountId: 'account_1',
    machineId: 'machine_1',
    flowKind: 'bounded_transfer',
    routeKind: 'loopback_direct',
    scope: {
      kind: 'bounded_transfer',
      mode: 'single',
      transferId: 'transfer_1',
      maxBytes: 1024,
    },
    iat: 1_000,
    exp: 601_000,
    aud: 'happier-daemon-route-grant',
    endpointFingerprint: input.endpointFingerprint,
  };
  return {
    payload,
    signature: {
      keyId: input.keyId,
      alg: 'Ed25519',
      valueBase64Url: toBase64Url(tweetnacl.sign.detached(
        Buffer.from(createDirectRouteGrantSigningInputV1(payload), 'utf8'),
        input.signingSecretKey,
      )),
    },
  };
}

function createSignedMachineRpcGrant(input: Readonly<{
  signingSecretKey: Uint8Array;
  keyId: string;
  endpointFingerprint: string;
  allowedMethods: readonly string[];
}>): SignedDirectRouteGrantV1 {
  const payload: DirectRouteGrantPayloadV1 = {
    v: 1,
    grantId: 'grant_rpc_1',
    grantFamilyId: 'family_rpc_1',
    accountId: 'account_1',
    machineId: 'machine_1',
    flowKind: 'machine_rpc',
    routeKind: 'loopback_direct',
    scope: {
      kind: 'machine_rpc',
      rpcScopeId: 'rpc_scope_1',
      allowedMethods: [...input.allowedMethods],
      maxCalls: 2,
      maxIdleMs: 30_000,
    },
    iat: 1_000,
    exp: 601_000,
    aud: 'happier-daemon-route-grant',
    endpointFingerprint: input.endpointFingerprint,
  };
  return {
    payload,
    signature: {
      keyId: input.keyId,
      alg: 'Ed25519',
      valueBase64Url: toBase64Url(tweetnacl.sign.detached(
        Buffer.from(createDirectRouteGrantSigningInputV1(payload), 'utf8'),
        input.signingSecretKey,
      )),
    },
  };
}

function createSignedLiveStreamGrant(input: Readonly<{
  signingSecretKey: Uint8Array;
  keyId: string;
  endpointFingerprint: string;
}>): SignedDirectRouteGrantV1 {
  const payload: DirectRouteGrantPayloadV1 = {
    v: 1,
    grantId: 'grant_stream_1',
    grantFamilyId: 'family_stream_1',
    accountId: 'account_1',
    machineId: 'machine_1',
    flowKind: 'live_stream',
    routeKind: 'loopback_direct',
    scope: {
      kind: 'live_stream',
      streamId: 'stream_1',
      streamFamily: 'screen',
      maxBitrateBps: 64_000,
      maxDurationMs: 60_000,
      maxTotalBytes: 128_000,
    },
    iat: 1_000,
    exp: 601_000,
    aud: 'happier-daemon-route-grant',
    endpointFingerprint: input.endpointFingerprint,
  };
  return {
    payload,
    signature: {
      keyId: input.keyId,
      alg: 'Ed25519',
      valueBase64Url: toBase64Url(tweetnacl.sign.detached(
        Buffer.from(createDirectRouteGrantSigningInputV1(payload), 'utf8'),
        input.signingSecretKey,
      )),
    },
  };
}

function createSignedLiveStreamGrantV2(input: Readonly<{
  signingSecretKey: Uint8Array;
  keyId: string;
  endpointFingerprint: string;
  ephemeralPublicKeyBase64Url: string;
}>) {
  const payload: DirectRouteGrantPayloadV2 = {
    v: 2, grantId: 'grant_stream_v2', accountId: 'account_1', machineId: 'machine_1',
    flowKind: 'live_stream', routeKind: 'loopback_direct',
    scope: { kind: 'live_stream', streamId: 'stream_v2', streamFamily: 'screen', maxBitrateBps: 64_000, maxDurationMs: 60_000 },
    iat: 1_000, exp: 601_000, aud: 'happier-daemon-route-grant', endpointFingerprint: input.endpointFingerprint,
    proofKind: 'ephemeral_ed25519', ephemeralPublicKeyBase64Url: input.ephemeralPublicKeyBase64Url,
  };
  return {
    payload,
    signature: {
      keyId: input.keyId,
      alg: 'Ed25519' as const,
      valueBase64Url: toBase64Url(tweetnacl.sign.detached(
        Buffer.from(createDirectRouteGrantSigningInputV2(payload), 'utf8'), input.signingSecretKey,
      )),
    },
  };
}

function createLiveStreamFrame(sequence = 1): MachineLiveStreamFrameV1 {
  return {
    v: 1,
    streamId: 'stream_1',
    sequence,
    timestampMs: 2_000 + sequence,
    payloadKind: sequence === 1 ? 'image_keyframe' : 'image_delta',
    payloadEncoding: 'binary_base64',
    payloadBase64: 'AQID',
    payloadSizeBytes: 3,
  };
}

type TestLiveStreamCaptureStartInput = Readonly<{
  offerFrame: (
    frame: MachineLiveStreamFrameV1,
  ) => Readonly<{ ok: true } | { ok: false; reasonCode: string }>;
}>;

// --- machine/1 Iroh admission fixtures: canonical handshake + real signed V2 `iroh_peer` grant ---
const IROH_SIGNING_KEY_PAIR = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(11));
const IROH_TRUST_ROOTS = [{ keyId: 'iroh-key-1', publicKey: toBase64Url(IROH_SIGNING_KEY_PAIR.publicKey) }];
// Strict endpoint-id grammar (64 lowercase hex = 32-byte Iroh endpoint identity).
const IROH_SOURCE_ENDPOINT_ID = 'a'.repeat(64);
const IROH_TARGET_ENDPOINT_ID = 'b'.repeat(64);
const IROH_OPERATION_ID = 'operation_iroh_1';

function createIrohMachineHandshake(input: Readonly<{
  flow?: 'finite_transfer' | 'workspace_sync';
  targetMachineId?: string;
  grantOverrides?: Partial<DirectRouteGrantPayloadV2>;
  breakProof?: boolean;
}> = {}): IrohMachineHandshakeV1 {
  const flow = input.flow ?? 'finite_transfer';
  const sourceMachineId = 'machine_source';
  const targetMachineId = input.targetMachineId ?? 'machine_1';
  const initiator = {
    kind: 'machine' as const,
    machineId: sourceMachineId,
    endpointId: IROH_SOURCE_ENDPOINT_ID,
  };
  const target = {
    machineId: targetMachineId,
    endpointId: IROH_TARGET_ENDPOINT_ID,
  };
  const payload: DirectRouteGrantPayloadV2 = {
    v: 2,
    grantId: 'grant_iroh_1',
    accountId: 'account_1',
    machineId: targetMachineId,
    flowKind: 'bounded_transfer',
    routeKind: 'iroh_peer',
    scope: flow === 'finite_transfer'
      ? { kind: 'bounded_transfer', mode: 'carrier' }
      : { kind: 'bounded_transfer', mode: 'single', transferId: IROH_OPERATION_ID, maxBytes: 1024 },
    iat: 1_000,
    exp: 601_000,
    aud: DIRECT_ROUTE_GRANT_AUDIENCE_V1,
    endpointFingerprint: IROH_TARGET_ENDPOINT_ID,
    iroh: {
      initiator,
      target,
      operationKind: flow,
    },
    proofKind: 'ephemeral_ed25519',
    ephemeralPublicKeyBase64Url: '',
    ...input.grantOverrides,
  };
  const handle = createEphemeralPeerRouteProofHandleV2({ randomBytes: (length) => new Uint8Array(length).fill(3) });
  const signedPayload = { ...payload, ephemeralPublicKeyBase64Url: handle.publicKeyBase64Url };
  const grant: SignedDirectRouteGrantV2 = {
    payload: signedPayload,
    signature: {
      keyId: 'iroh-key-1',
      alg: 'Ed25519',
      valueBase64Url: toBase64Url(tweetnacl.sign.detached(
        Buffer.from(createDirectRouteGrantSigningInputV2(signedPayload), 'utf8'),
        IROH_SIGNING_KEY_PAIR.secretKey,
      )),
    },
  };
  const proof = handle.sign(grant);
  const sharedHandshake = {
    v: 1 as const,
    accountId: 'account_1',
    initiator,
    target,
    grant,
    proof: input.breakProof ? { ...proof, nonceBase64Url: toBase64Url(new Uint8Array(16).fill(7)) } : proof,
  };
  return flow === 'workspace_sync'
    ? { ...sharedHandshake, flow, operationId: IROH_OPERATION_ID }
    : { ...sharedHandshake, flow };
}

/**
 * A `server_relay` grant can never be produced by the canonical signer (the authorized
 * endpoint-route schema excludes it), so this simulates the wire body a hostile or
 * misconfigured peer would actually send: a genuinely signed `iroh_peer` handshake whose
 * grant payload route kind was swapped to `server_relay` after signing. The route must
 * reject it fail-closed (403, no echo), exactly like every other cross-route grant.
 */
function createCrossRouteGrantWireHandshake(): Record<string, unknown> {
  const handshake = createIrohMachineHandshake();
  return {
    ...handshake,
    grant: {
      ...handshake.grant,
      payload: {
        ...handshake.grant.payload,
        routeKind: 'server_relay',
      },
    },
  };
}

function createIrohAdmissionTestApp() {
  return createPeerMediationLoopbackApp({
    nowMs: () => 2_000,
    expected: {
      accountId: 'account_1',
      machineId: 'machine_1',
      flowKind: 'bounded_transfer',
      routeKind: 'loopback_direct',
      endpointFingerprint: 'loopback_endpoint_1',
    },
    trustRoots: IROH_TRUST_ROOTS,
    irohMachineAdmission: {
      localEndpointId: IROH_TARGET_ENDPOINT_ID,
      role: 'acceptor',
      allowedFlows: ['finite_transfer', 'workspace_sync'],
      resolveApplicationTarget: () => ({ port: 46_001 }),
    },
  });
}

describe('peer mediation loopback server', () => {
  it('answers browser CORS and private-network preflight for signed loopback requests', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'bounded_transfer',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
    });

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/peer-mediation/v1/probe',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
        'access-control-request-private-network': 'true',
      },
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
    expect(preflight.headers['access-control-allow-headers']).toContain('content-type');
    expect(preflight.headers['access-control-allow-private-network']).toBe('true');

    await app.close();
  });

  it('accepts a probe only after grant, nonce, and endpoint binding verify', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'bounded_transfer',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'bounded_transfer',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/probe',
      headers: { origin: 'http://localhost:8081' },
      payload: {
        v: 1,
        grant,
        nonceProof,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.json()).toEqual({
      v: 1,
      ok: true,
      receipt: 'peer.route.selected',
      routeKind: 'loopback_direct',
      flowKind: 'bounded_transfer',
      endpointFingerprint: 'loopback_endpoint_1',
    });

    await app.close();
  });

  it('returns route fallback when endpoint binding does not match', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'bounded_transfer',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'bounded_transfer',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'other_endpoint',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/probe',
      payload: {
        v: 1,
        grant,
        nonceProof,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      v: 1,
      ok: false,
      receipt: 'peer.route.fallback',
      reasonCode: 'grant_endpoint_mismatch',
    });

    await app.close();
  });

  it('starts direct live streams through the existing loopback app after grant, nonce, and capture verification', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedLiveStreamGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'live_stream',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    const emittedFrames: MachineLiveStreamFrameV1[] = [];
    const appOptions = {
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'live_stream',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
      stream: {
        captureAdapter: {
          start: async (input: TestLiveStreamCaptureStartInput) => {
            const offered = input.offerFrame(createLiveStreamFrame(1));
            return offered.ok
              ? { ok: true as const, session: { stop: async () => undefined } }
              : { ok: false as const, reasonCode: offered.reasonCode };
          },
        },
        emitFrame: (next: MachineLiveStreamFrameV1) => emittedFrames.push(next),
      },
    } as const;
    const app = createPeerMediationLoopbackApp(appOptions);

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/live-stream/start',
      payload: {
        v: 1,
        streamId: 'stream_1',
        streamFamily: 'screen',
        routeKind: 'loopback_direct',
        flowKind: 'live_stream',
        endpointFingerprint: 'loopback_endpoint_1',
        grant,
        nonceProof,
        startRequest: {
          v: 1,
          streamId: 'stream_1',
          streamFamily: 'screen',
          routeKind: 'loopback_direct',
          sourceMachineId: 'machine_1',
          targetMachineId: 'machine_target',
          maxBitrateBps: 64_000,
          maxFramesPerSecond: 12,
          maxFrameBytes: 32_000,
          maxDurationMs: 60_000,
          maxTotalBytes: 128_000,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      v: 1,
      ok: true,
      receipt: PEER_MEDIATION_RECEIPTS.streamStarted,
      streamId: 'stream_1',
      routeKind: 'loopback_direct',
    });
    expect(emittedFrames.map((next) => next.sequence)).toEqual([1]);

    await app.close();
  });

  it('admits a V2 live stream once with the canonical ephemeral proof', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const handle = createEphemeralPeerRouteProofHandleV2({
      randomBytes: (length) => new Uint8Array(length).fill(length === 32 ? 5 : 6),
    });
    const grant = createSignedLiveStreamGrantV2({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
      ephemeralPublicKeyBase64Url: handle.publicKeyBase64Url,
    });
    const proof = handle.sign(grant);
    let captureAttempts = 0;
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1', machineId: 'machine_1', flowKind: 'live_stream',
        routeKind: 'loopback_direct', endpointFingerprint: 'loopback_endpoint_1',
      },
      trustRoots: [{ keyId: 'grant-key-1', publicKey: toBase64Url(grantKeyPair.publicKey) }],
      stream: { captureAdapter: { start: async () => {
        captureAttempts += 1;
        if (captureAttempts === 1) throw new Error('capture boundary unavailable');
        return { ok: true, session: { stop: async () => undefined } };
      } } },
    });
    const payload = {
      v: 2,
      streamId: 'stream_v2',
      streamFamily: 'screen',
      routeKind: 'loopback_direct',
      flowKind: 'live_stream',
      endpointFingerprint: 'loopback_endpoint_1',
      grant,
      proof,
      startRequest: {
        v: 1, streamId: 'stream_v2', streamFamily: 'screen', routeKind: 'loopback_direct',
        sourceMachineId: 'machine_1', targetMachineId: 'machine_target', maxBitrateBps: 64_000,
        maxFramesPerSecond: 12, maxFrameBytes: 32_000, maxDurationMs: 60_000,
      },
    };

    const activationFailed = await app.inject({ method: 'POST', url: '/peer-mediation/v2/live-stream/start', payload });
    expect(activationFailed.json()).toMatchObject({ v: 2, ok: false, reasonCode: 'capture_start_failed' });
    const accepted = await app.inject({ method: 'POST', url: '/peer-mediation/v2/live-stream/start', payload });
    expect(accepted.json()).toMatchObject({ v: 2, ok: true, receipt: PEER_MEDIATION_RECEIPTS.streamStarted });
    const replay = await app.inject({ method: 'POST', url: '/peer-mediation/v2/live-stream/start', payload });
    expect(replay.json()).toMatchObject({ v: 2, ok: false, reasonCode: 'grant_already_consumed' });
    await app.close();
  });

  it('fails closed when direct live-stream capture is unavailable', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedLiveStreamGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'live_stream',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'live_stream',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
      stream: {},
    });

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/live-stream/start',
      payload: {
        v: 1,
        streamId: 'stream_1',
        streamFamily: 'screen',
        routeKind: 'loopback_direct',
        flowKind: 'live_stream',
        endpointFingerprint: 'loopback_endpoint_1',
        grant,
        nonceProof,
        startRequest: {
          v: 1,
          streamId: 'stream_1',
          streamFamily: 'screen',
          routeKind: 'loopback_direct',
          sourceMachineId: 'machine_1',
          targetMachineId: 'machine_target',
          maxBitrateBps: 64_000,
          maxFramesPerSecond: 12,
          maxFrameBytes: 32_000,
          maxDurationMs: 60_000,
          maxTotalBytes: 128_000,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      v: 1,
      ok: false,
      receipt: PEER_MEDIATION_RECEIPTS.routeFallback,
      reasonCode: 'capture_unavailable',
    });

    await app.close();
  });

  it('exposes direct TCP tunnel open and stream routes on the production loopback app when configured', async () => {
    const openTunnel = async () => ({
      ok: true as const,
      response: {
        v: 1 as const,
        tunnelId: 'tun_1',
        streamPath: '/peer-mediation/v1/tunnel/stream' as const,
        encoding: 'json_base64_v1' as const,
        initialWindowBytes: 1024 * 1024,
        maxFrameBytes: 64 * 1024,
      },
      receipt: PEER_MEDIATION_RECEIPTS.tunnelOpened,
      flowKind: 'tcp_tunnel' as const,
      connection: { close: async () => undefined },
      limits: {
        maxIdleMs: 30_000,
        maxDurationMs: 120_000,
      },
    });
    const appOptions = {
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'tcp_tunnel',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(new Uint8Array(32).fill(7)),
      },
      trustRoots: [],
      tunnel: { openTunnel },
    } satisfies Parameters<typeof createPeerMediationLoopbackApp>[0] & { tunnel: unknown };
    const app = createPeerMediationLoopbackApp(appOptions);

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/tunnel/open',
      payload: {
        v: 1,
        kind: 'open',
        tunnelId: 'tun_1',
        targetMachineId: 'machine_1',
        routeKind: 'loopback_direct',
        destination: { host: '127.0.0.1', port: 3000 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tunnelId: 'tun_1',
      streamPath: '/peer-mediation/v1/tunnel/stream',
    });
    await app.ready();
    expect(typeof (app as unknown as { injectWS?: unknown }).injectWS).toBe('function');
    expect(app.server.listening).toBe(false);

    await app.close();
  });

  it('rejects non-loopback bind hosts before startup', () => {
    const anyAddress = ['0', '0', '0', '0'].join('.');
    expect(assertPeerMediationLoopbackBindHost('127.0.0.1')).toBe('127.0.0.1');
    expect(assertPeerMediationLoopbackBindHost('localhost')).toBe('localhost');
    expect(assertPeerMediationLoopbackBindHost('::1')).toBe('::1');
    expect(() => assertPeerMediationLoopbackBindHost(anyAddress)).toThrow(/loopback/i);
    expect(() => assertPeerMediationLoopbackBindHost('192.168.1.20')).toThrow(/loopback/i);
    expect(() => assertPeerMediationLoopbackBindHost('127.not-a-host')).toThrow(/loopback/i);
  });

  it('rejects a non-loopback bind host through the composed start path, not only the guard', async () => {
    // Regression guard for review finding R2 F-1. The case above exercises the pure function only.
    // `assertPeerMediationLoopbackBindHost` has exactly one call site (`server.ts:277`); deleting it
    // left that case — and both halves of the PMS-2 acceptance gate — green while the daemon bound
    // every interface. This case pins the composed entry point, so removing the *invocation* of the
    // security boundary fails the gate, not just removing its implementation.
    const anyAddress = ['0', '0', '0', '0'].join('.');
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
    let started: Awaited<ReturnType<typeof startPeerMediationLoopbackServer>> | undefined;
    try {
      await expect(
        startPeerMediationLoopbackServer({
          host: anyAddress,
          port: 0,
          endpointExpiresAt: 10_000,
          nowMs: () => 2_000,
          expected: {
            accountId: 'account_1',
            machineId: 'machine_1',
            flowKind: 'bounded_transfer',
            routeKind: 'loopback_direct',
            endpointFingerprint: 'loopback_endpoint_1',
            accountPublicKey: toBase64Url(accountKeyPair.publicKey),
          },
          trustRoots: [],
        }).then((server) => {
          // Only reached if the guard is gone; captured so the accidental listener is closed.
          started = server;
          return server;
        }),
        // Assert the guard's EXACT message, not /loopback/i. With the call site removed the start
        // path still rejects — but from a downstream Zod endpoint-URL parse, *after* the socket has
        // already bound 0.0.0.0. A loose regex matches that Zod text (it contains "loopback_direct")
        // and so cannot tell the two apart. This exact string can only come from the guard.
      ).rejects.toThrow('Peer mediation loopback server must bind to a loopback host');
    } finally {
      await started?.stop();
    }
  });

  it('executes direct machine RPC only after grant, nonce, method policy, and endpoint binding verify', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedMachineRpcGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
      allowedMethods: [RPC_METHODS.DAEMON_MEMORY_STATUS],
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'machine_rpc',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'machine_rpc',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
      rpc: {
        rpcHandlerManager: {
          invokeLocal: async (method: string, params: unknown) => ({ method, params, ok: true }),
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/rpc',
      payload: {
        v: 1,
        requestId: 'request_1',
        method: RPC_METHODS.DAEMON_MEMORY_STATUS,
        params: { includeWorkers: true },
        grant,
        nonceProof,
        routeKind: 'loopback_direct',
        flowKind: 'machine_rpc',
        endpointFingerprint: 'loopback_endpoint_1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      v: 1,
      ok: true,
      receipt: 'peer.rpc.direct_call_succeeded',
      requestId: 'request_1',
      method: RPC_METHODS.DAEMON_MEMORY_STATUS,
      routeKind: 'loopback_direct',
      result: {
        method: RPC_METHODS.DAEMON_MEMORY_STATUS,
        params: { includeWorkers: true },
        ok: true,
      },
    });

    await app.close();
  });

  it('accepts a signed direct voice upload chunk larger than the legacy 64 KiB body limit', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const method = RPC_METHODS.DAEMON_VOICE_INFERENCE_STT_UPLOAD_CHUNK;
    const grant = createSignedMachineRpcGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
      allowedMethods: [method],
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'machine_rpc',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_voice_upload_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    const params = {
      uploadId: 'voice_upload_1',
      index: 0,
      payloadBase64: 'A'.repeat(68_948),
      encryptedDataKeyEnvelopeBase64: 'AQID',
    };
    let invokedParams: unknown;
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'machine_rpc',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
      rpc: {
        rpcHandlerManager: {
          invokeLocal: async (_method: string, nextParams: unknown) => {
            invokedParams = nextParams;
            return { success: true };
          },
        },
      },
    });
    const requestId = 'request_voice_upload_1';
    const replayKey = requestId;
    const payload = {
      v: 1 as const,
      requestId,
      method,
      params,
      grant,
      nonceProof,
      routeKind: 'loopback_direct' as const,
      flowKind: 'machine_rpc' as const,
      endpointFingerprint: 'loopback_endpoint_1',
      commandReceipt: {
        v: 1 as const,
        issuer: 'ui' as const,
        issuedAtMs: 2_000,
        requestHash: createPeerMachineRpcRequestHashV1({
          method,
          params,
          grantId: grant.payload.grantId,
          endpointFingerprint: 'loopback_endpoint_1',
          replayKey,
        }),
        replayKey,
      },
    };
    expect(Buffer.byteLength(JSON.stringify(payload), 'utf8')).toBeGreaterThan(64 * 1024);

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/rpc',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      v: 1,
      ok: true,
      receipt: PEER_MEDIATION_RECEIPTS.rpcDirectCallSucceeded,
      requestId,
      method,
      result: { success: true },
    });
    expect(invokedParams).toEqual(params);

    await app.close();
  });

  it('keeps loopback request bodies bounded above the supported signed transfer envelope', async () => {
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'machine_rpc',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
      },
      trustRoots: [],
      bodyLimitBytes: Number.MAX_SAFE_INTEGER,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/rpc',
      payload: { padding: 'A'.repeat(PEER_MEDIATION_LOOPBACK_BODY_LIMIT_BYTES) },
    });

    expect(response.statusCode).toBe(413);
    await app.close();
  });

  it('does not invoke direct machine RPC handlers for server-required methods', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedMachineRpcGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
      allowedMethods: [RPC_METHODS.SPAWN_HAPPY_SESSION],
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'machine_rpc',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    let invoked = false;
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'machine_rpc',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
      rpc: {
        rpcHandlerManager: {
          invokeLocal: async () => {
            invoked = true;
            return { ok: true };
          },
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/rpc',
      payload: {
        v: 1,
        requestId: 'request_2',
        method: RPC_METHODS.SPAWN_HAPPY_SESSION,
        params: { prompt: 'hello' },
        grant,
        nonceProof,
        routeKind: 'loopback_direct',
        flowKind: 'machine_rpc',
        endpointFingerprint: 'loopback_endpoint_1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      v: 1,
      ok: false,
      receipt: 'peer.rpc.fell_back_to_server',
      requestId: 'request_2',
      method: RPC_METHODS.SPAWN_HAPPY_SESSION,
      reasonCode: 'server_required',
    });
    expect(invoked).toBe(false);

    await app.close();
  });

  it('does not invoke direct machine RPC handlers when the request route differs from the verified grant route', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedMachineRpcGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
      allowedMethods: [RPC_METHODS.DAEMON_MEMORY_STATUS],
    });
    const nonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'machine_rpc',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(7),
    });
    let invoked = false;
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'machine_rpc',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
      rpc: {
        rpcHandlerManager: {
          invokeLocal: async () => {
            invoked = true;
            return { ok: true };
          },
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/peer-mediation/v1/rpc',
      payload: {
        v: 1,
        requestId: 'request_route_mismatch',
        method: RPC_METHODS.DAEMON_MEMORY_STATUS,
        params: { includeWorkers: true },
        grant,
        nonceProof,
        routeKind: 'lan_direct',
        flowKind: 'machine_rpc',
        endpointFingerprint: 'loopback_endpoint_1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      v: 1,
      ok: false,
      receipt: 'peer.rpc.fell_back_to_server',
      requestId: 'request_route_mismatch',
      method: RPC_METHODS.DAEMON_MEMORY_STATUS,
      reasonCode: 'grant_scope_mismatch',
    });
    expect(invoked).toBe(false);

    await app.close();
  });

  /**
   * Grant revocation is withdrawn — direct route grants are TTL-only (see lanes/D2.md §4) — so the
   * internal grant-revocation notification hook this test used to spy on no longer exists. The
   * quarantine itself is live, and is asserted where it is actually observable: the wire response.
   * That is a stronger contract than the old callback spy, which pinned an internal call that
   * nothing in production ever supplied.
   */
  it('quarantines a direct machine RPC grant on the wire after repeated nonce failures', async () => {
    const grantKeyPair = tweetnacl.sign.keyPair();
    const accountKeyPair = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const grant = createSignedMachineRpcGrant({
      signingSecretKey: grantKeyPair.secretKey,
      keyId: 'grant-key-1',
      endpointFingerprint: 'loopback_endpoint_1',
      allowedMethods: [RPC_METHODS.DAEMON_MEMORY_STATUS],
    });
    const badNonceProof = createPeerRouteNonceProofV1({
      grantId: grant.payload.grantId,
      routeKind: 'loopback_direct',
      flowKind: 'machine_rpc',
      endpointFingerprint: 'loopback_endpoint_1',
      nonceBase64Url: 'nonce_1',
      accountSigningSeed: new Uint8Array(32).fill(8),
    });
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'machine_rpc',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
        accountPublicKey: toBase64Url(accountKeyPair.publicKey),
      },
      trustRoots: [{
        keyId: 'grant-key-1',
        publicKey: toBase64Url(grantKeyPair.publicKey),
      }],
      rpc: {
        rpcHandlerManager: {
          invokeLocal: async () => ({ ok: true }),
        },
      },
    });

    const reasonCodes: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/peer-mediation/v1/rpc',
        payload: {
          v: 1,
          requestId: `request_${index}`,
          method: RPC_METHODS.DAEMON_MEMORY_STATUS,
          params: {},
          grant,
          nonceProof: badNonceProof,
          routeKind: 'loopback_direct',
          flowKind: 'machine_rpc',
          endpointFingerprint: 'loopback_endpoint_1',
        },
      });
      reasonCodes.push((response.json() as { reasonCode?: string }).reasonCode ?? '');
    }

    // Repeated bad nonces latch the quarantine, and the caller can see why it was cut off.
    expect(reasonCodes).toContain('quarantined');
    expect(reasonCodes[reasonCodes.length - 1]).toBe('quarantined');
    expect(reasonCodes.every((code) => code.length > 0)).toBe(true);

    await app.close();
  });
});

describe('machine/1 Iroh admission route', () => {
  it('resolves current signing roots for each admission instead of freezing startup keys', async () => {
    let currentRoots: typeof IROH_TRUST_ROOTS = [];
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1', machineId: 'machine_1', flowKind: 'bounded_transfer',
        routeKind: 'loopback_direct', endpointFingerprint: 'loopback_endpoint_1',
      },
      trustRoots: [],
      irohMachineAdmission: {
        localEndpointId: IROH_TARGET_ENDPOINT_ID,
        role: 'acceptor',
        allowedFlows: ['finite_transfer'],
        resolveTrustRoots: () => currentRoots,
        resolveApplicationTarget: () => ({ port: 46_001 }),
      },
    });
    const request = {
      method: 'POST' as const,
      url: IROH_MACHINE_ADMISSION_PATH,
      headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: IROH_SOURCE_ENDPOINT_ID },
      payload: createIrohMachineHandshake(),
    };

    expect((await app.inject(request)).statusCode).toBe(403);
    currentRoots = IROH_TRUST_ROOTS;
    expect((await app.inject(request)).statusCode).toBe(204);
    await app.close();
  });

  it('gates the finite-transfer target listener with a fresh first-bytes capability and strips it before application bytes', async () => {
    const applicationBytes: Buffer[] = [];
    const applicationServer = createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('data', (chunk: Buffer) => applicationBytes.push(chunk));
      socket.once('end', () => socket.end(Buffer.concat(applicationBytes)));
    });
    await new Promise<void>((resolve, reject) => {
      applicationServer.once('error', reject);
      applicationServer.listen({ host: '127.0.0.1', port: 0 }, resolve);
    });
    const applicationAddress = applicationServer.address();
    if (!applicationAddress || typeof applicationAddress === 'string') throw new Error('application listener did not bind');
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'bounded_transfer',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
      },
      trustRoots: IROH_TRUST_ROOTS,
      irohMachineAdmission: {
        localEndpointId: IROH_TARGET_ENDPOINT_ID,
        role: 'acceptor',
        allowedFlows: ['finite_transfer'],
        resolveApplicationTarget: () => ({ port: applicationAddress.port }),
      },
    });

    try {
      const admission = await app.inject({
        method: 'POST',
        url: IROH_MACHINE_ADMISSION_PATH,
        headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: IROH_SOURCE_ENDPOINT_ID },
        payload: createIrohMachineHandshake(),
      });
      expect(admission.statusCode).toBe(204);
      const capability = admission.headers[IROH_MACHINE_APPLICATION_CAPABILITY_HEADER.toLowerCase()];
      const protectedPort = Number(admission.headers[IROH_MACHINE_APPLICATION_PORT_HEADER.toLowerCase()]);
      expect(capability).toMatch(/^[0-9a-f]{64}$/);
      expect(protectedPort).not.toBe(applicationAddress.port);

      const scanner = connect({ host: '127.0.0.1', port: protectedPort });
      await once(scanner, 'connect');
      scanner.end(`${'0'.repeat(64)}unauthorized`);
      await once(scanner, 'close');
      expect(applicationBytes).toEqual([]);

      const partialScanner = connect({ host: '127.0.0.1', port: protectedPort });
      await once(partialScanner, 'connect');
      const partialScannerClosed = once(partialScanner, 'close');
      partialScanner.write('0');

      const client = connect({ host: '127.0.0.1', port: protectedPort, allowHalfOpen: true });
      await once(client, 'connect');
      const echoed = Promise.race([
        (once(client, 'data') as Promise<[Buffer]>).then(([chunk]) => chunk),
        once(client, 'close').then(() => null),
      ]);
      client.end(Buffer.concat([
        Buffer.from(String(capability), 'ascii'),
        Buffer.from('finite-transfer-http-bytes'),
      ]));
      await expect(echoed).resolves.toEqual(Buffer.from('finite-transfer-http-bytes'));
      expect(Buffer.concat(applicationBytes)).toEqual(Buffer.from('finite-transfer-http-bytes'));
      await expect(partialScannerClosed).resolves.toBeDefined();
      client.destroy();
    } finally {
      await app.close();
      await new Promise<void>((resolve) => applicationServer.close(() => resolve()));
    }
  });

  it('admits a real signed machine/1 handshake with a bodyless 204 and the exact endpoint echo', async () => {
    const app = createIrohAdmissionTestApp();
    const localCapabilities: string[] = [];

    for (const flow of ['finite_transfer', 'workspace_sync'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: IROH_MACHINE_ADMISSION_PATH,
        headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: IROH_SOURCE_ENDPOINT_ID },
        payload: createIrohMachineHandshake({ flow }),
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers[IROH_MACHINE_REMOTE_ENDPOINT_HEADER.toLowerCase()]).toBe(IROH_SOURCE_ENDPOINT_ID);
      expect(response.headers[IROH_MACHINE_APPLICATION_PORT_HEADER.toLowerCase()]).not.toBe('46001');
      expect(response.headers[IROH_MACHINE_APPLICATION_CAPABILITY_HEADER.toLowerCase()]).toMatch(/^[0-9a-f]{64}$/);
      localCapabilities.push(String(response.headers[IROH_MACHINE_APPLICATION_CAPABILITY_HEADER.toLowerCase()]));
      expect(response.body).toBe('');
    }
    expect(new Set(localCapabilities).size).toBe(localCapabilities.length);

    await app.close();
  });

  it('does not register the admission route without explicit machine-Iroh config', async () => {
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'bounded_transfer',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
      },
      trustRoots: IROH_TRUST_ROOTS,
    });

    const response = await app.inject({
      method: 'POST',
      url: IROH_MACHINE_ADMISSION_PATH,
      headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: IROH_SOURCE_ENDPOINT_ID },
      payload: createIrohMachineHandshake(),
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a verified handshake when no application loopback target is available', async () => {
    const app = createPeerMediationLoopbackApp({
      nowMs: () => 2_000,
      expected: {
        accountId: 'account_1',
        machineId: 'machine_1',
        flowKind: 'bounded_transfer',
        routeKind: 'loopback_direct',
        endpointFingerprint: 'loopback_endpoint_1',
      },
      trustRoots: IROH_TRUST_ROOTS,
      irohMachineAdmission: {
        localEndpointId: IROH_TARGET_ENDPOINT_ID,
        role: 'acceptor',
        allowedFlows: ['finite_transfer'],
        resolveApplicationTarget: () => null,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: IROH_MACHINE_ADMISSION_PATH,
      headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: IROH_SOURCE_ENDPOINT_ID },
      payload: createIrohMachineHandshake(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers[IROH_MACHINE_REMOTE_ENDPOINT_HEADER.toLowerCase()]).toBeUndefined();
    expect(response.headers[IROH_MACHINE_APPLICATION_PORT_HEADER.toLowerCase()]).toBeUndefined();
    expect(response.body).toBe('');
    await app.close();
  });

  it('rejects every invalid admission with one stable non-2xx, no echo, and no reason detail', async () => {
    const app = createIrohAdmissionTestApp();
    const validHandshake = createIrohMachineHandshake();
    const remoteEndpointHeader = { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: IROH_SOURCE_ENDPOINT_ID };
    const cases: ReadonlyArray<Readonly<{
      name: string;
      headers?: Record<string, string>;
      omitHeaders?: boolean;
      payload: object;
    }>> = [
      { name: 'missing endpoint header', omitHeaders: true, payload: validHandshake },
      { name: 'malformed endpoint header', headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: 'not-an-endpoint-id' }, payload: validHandshake },
      // Node folds duplicate header lines into one comma-separated value; the strict endpoint grammar rejects it.
      { name: 'duplicate endpoint header', headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: `${IROH_SOURCE_ENDPOINT_ID}, ${IROH_SOURCE_ENDPOINT_ID}` }, payload: validHandshake },
      { name: 'wrong endpoint header', headers: { [IROH_MACHINE_REMOTE_ENDPOINT_HEADER]: 'c'.repeat(64) }, payload: validHandshake },
      { name: 'wrong target machine', headers: remoteEndpointHeader, payload: createIrohMachineHandshake({ targetMachineId: 'machine_other' }) },
      { name: 'removed legacy flow', headers: remoteEndpointHeader, payload: { ...validHandshake, flow: 'attachment_transfer' } },
      { name: 'expired grant', headers: remoteEndpointHeader, payload: createIrohMachineHandshake({ grantOverrides: { exp: 2_000 } }) },
      { name: 'invalid proof', headers: remoteEndpointHeader, payload: createIrohMachineHandshake({ breakProof: true }) },
      { name: 'malformed non-Iroh body', headers: remoteEndpointHeader, payload: { v: 1, grant: {}, nonceProof: {} } },
      { name: 'server_relay grant', headers: remoteEndpointHeader, payload: createCrossRouteGrantWireHandshake() },
      // A request can never select a destination: the strict handshake schema rejects unknown fields.
      { name: 'destination selection attempt', headers: remoteEndpointHeader, payload: { ...validHandshake, destination: { host: '127.0.0.1', port: 9 } } },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: 'POST',
        url: IROH_MACHINE_ADMISSION_PATH,
        ...(testCase.omitHeaders ? {} : { headers: testCase.headers ?? remoteEndpointHeader }),
        payload: testCase.payload,
      });

      expect(response.statusCode, testCase.name).toBe(403);
      expect(response.headers[IROH_MACHINE_REMOTE_ENDPOINT_HEADER.toLowerCase()], testCase.name).toBeUndefined();
      expect(response.headers[IROH_MACHINE_APPLICATION_PORT_HEADER.toLowerCase()], testCase.name).toBeUndefined();
      expect(response.body, testCase.name).toBe('');
    }

    await app.close();
  });
});
