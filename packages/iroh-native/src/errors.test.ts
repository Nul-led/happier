import { describe, expect, it } from 'vitest';

import {
  classifyIrohHomeCarrierFailure,
  IrohError,
  IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR,
  IROH_HOME_TUNNEL_PROBE_FAILED_ERROR,
  IROH_HOME_TUNNEL_STALE_FOCUS_ERROR,
  IROH_HOME_TUNNEL_STALE_GENERATION_ERROR,
  IROH_HOME_TUNNEL_SUSPENDED_ERROR,
  type IrohHomeCarrierFailureClass,
} from './errors';

describe('classifyIrohHomeCarrierFailure', () => {
  it('allows independently trusted HTTPS only for pre-acquisition host/native unavailability', () => {
    expect(classifyIrohHomeCarrierFailure(new IrohError('unavailable', 'unavailable'))).toEqual({
      fallbackAllowed: true,
      failureClass: 'carrier-unavailable',
    });
    for (const error of [
      new Error(IROH_HOME_TUNNEL_SUSPENDED_ERROR),
    ]) {
      expect(classifyIrohHomeCarrierFailure(error)).toEqual({
        fallbackAllowed: true,
        failureClass: 'carrier-unavailable',
      });
    }
  });

  it('fails closed for every identity, integrity, protocol, auth, config, cancellation, and unknown failure', () => {
    const cases: ReadonlyArray<Readonly<{ error: unknown; failureClass: IrohHomeCarrierFailureClass }>> = [
      { error: new IrohError('endpoint_identity_invalid', 'invalid endpoint identity'), failureClass: 'descriptor-integrity' },
      { error: new IrohError('identity_mismatch', 'wrong Home'), failureClass: 'identity-auth' },
      { error: new IrohError('invalid_descriptor', 'invalid descriptor'), failureClass: 'descriptor-integrity' },
      { error: new IrohError('endpoint_key_unavailable', 'key unavailable'), failureClass: 'endpoint-config' },
      { error: new IrohError('endpoint_config_conflict', 'config conflict'), failureClass: 'endpoint-config' },
      { error: new IrohError('loopback_bind_failed', 'bind failed'), failureClass: 'endpoint-config' },
      { error: new IrohError('resource_limit', 'resource limit'), failureClass: 'endpoint-config' },
      { error: new IrohError('transport', 'transport failure'), failureClass: 'carrier-unavailable' },
      { error: new IrohError('home_unreachable', 'Home unreachable'), failureClass: 'carrier-unavailable' },
      { error: new IrohError('transport_timeout', 'transport timeout'), failureClass: 'carrier-unavailable' },
      { error: new IrohError('transport_closed', 'transport closed'), failureClass: 'carrier-unavailable' },
      { error: { name: 'IrohNativeOperationError', code: 'transport_timeout' }, failureClass: 'carrier-unavailable' },
      { error: new IrohError('relay_auth_failed', 'relay denied'), failureClass: 'identity-auth' },
      { error: new IrohError('invalid_preamble', 'invalid preamble'), failureClass: 'protocol' },
      { error: new IrohError('unsupported_alpn', 'unsupported ALPN'), failureClass: 'protocol' },
      { error: new IrohError('cancelled', 'cancelled'), failureClass: 'unclassified' },
      { error: new IrohError('unknown', 'unknown'), failureClass: 'unclassified' },
      { error: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:auth-failed`), failureClass: 'identity-auth' },
      { error: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:identity-mismatch`), failureClass: 'identity-auth' },
      { error: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:health-unavailable`), failureClass: 'verification-incomplete' },
      { error: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:probe-timeout`), failureClass: 'verification-incomplete' },
      { error: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:features-unavailable`), failureClass: 'verification-incomplete' },
      { error: new Error(IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR), failureClass: 'descriptor-integrity' },
      { error: new Error(IROH_HOME_TUNNEL_STALE_GENERATION_ERROR), failureClass: 'stale-target' },
      { error: new Error(IROH_HOME_TUNNEL_STALE_FOCUS_ERROR), failureClass: 'stale-target' },
      { error: { name: 'Error', code: 'transport_timeout' }, failureClass: 'unclassified' },
      { error: new Error('future failure'), failureClass: 'unclassified' },
      { error: undefined, failureClass: 'unclassified' },
    ];
    for (const { error, failureClass } of cases) {
      expect(classifyIrohHomeCarrierFailure(error)).toEqual({ fallbackAllowed: false, failureClass });
    }
  });

  it('never reflects error messages or other input-derived data in its outcome', () => {
    const secretish = new Error('token=secret url=https://private.example.test');
    const classification = classifyIrohHomeCarrierFailure(secretish);
    expect(classification).toEqual({ fallbackAllowed: false, failureClass: 'unclassified' });
    expect(Object.values(classification)).not.toContain(secretish.message);
  });
});
