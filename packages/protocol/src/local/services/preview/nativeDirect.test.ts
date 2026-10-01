import { describe, expect, it } from 'vitest';
import { DirectRouteGrantPayloadV2Schema } from '../../../machines/peer/mediation/directRouteGrantV2.js';

const binding = {
  previewId: 'preview-1', machineId: 'machine-1', owner: { kind: 'user', id: 'account-1' },
  target: { scheme: 'http', host: '127.0.0.1', port: 5173 },
};
const payload = {
  v: 2, grantId: 'grant-1', accountId: 'account-1', machineId: 'machine-1',
  flowKind: 'tcp_tunnel', routeKind: 'iroh_peer',
  scope: { kind: 'tcp_tunnel', tunnelId: 'tunnel-1', allowedPorts: [5173], preview: binding },
  iat: 1000, exp: null, aud: 'happier-daemon-route-grant',
  endpointFingerprint: 'b'.repeat(64), proofKind: 'ephemeral_ed25519', ephemeralPublicKeyBase64Url: 'A'.repeat(43),
  iroh: { initiator: { kind: 'account_client', endpointId: 'a'.repeat(64) }, target: { machineId: 'machine-1', endpointId: 'b'.repeat(64) }, operationKind: 'tcp_tunnel' },
};

describe('preview direct grant lifetime and target admission', () => {
  it('admits registration-bound preview grants without imposing a clock lifetime', () => {
    expect(DirectRouteGrantPayloadV2Schema.safeParse(payload).success).toBe(true);
  });
  it('keeps expiry mandatory for ordinary TCP and refuses preview target/port disagreement', () => {
    const { preview: _preview, ...ordinaryScope } = payload.scope;
    expect(DirectRouteGrantPayloadV2Schema.safeParse({ ...payload, scope: ordinaryScope }).success).toBe(false);
    expect(DirectRouteGrantPayloadV2Schema.safeParse({ ...payload, scope: { ...payload.scope, allowedPorts: [22] } }).success).toBe(false);
    expect(DirectRouteGrantPayloadV2Schema.safeParse({ ...payload, machineId: 'other' }).success).toBe(false);
  });
});
