import { describe, expect, it } from 'vitest';

import { IrohError } from '@happier-dev/iroh-native';

import {
    classifyIrohHomeTunnelSwitchFailure,
    IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR,
    IROH_HOME_TUNNEL_PROBE_FAILED_ERROR,
    IROH_HOME_TUNNEL_STALE_FOCUS_ERROR,
    IROH_HOME_TUNNEL_STALE_GENERATION_ERROR,
    IROH_HOME_TUNNEL_SUSPENDED_ERROR,
    type IrohHomeTunnelFailureClass,
} from './fallback';

const fallbackAllowedInputs: readonly unknown[] = [
    new IrohError('unavailable', 'Native Iroh transport is unavailable.'),
    new IrohError('transport', 'transport closed'),
    new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:health-unavailable`),
    new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:probe-timeout`),
    new Error(IROH_HOME_TUNNEL_SUSPENDED_ERROR),
];

const failClosedInputs: ReadonlyArray<Readonly<{ input: unknown; failureClass: IrohHomeTunnelFailureClass }>> = [
    { input: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:auth-failed`), failureClass: 'identity-auth' },
    { input: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:identity-mismatch`), failureClass: 'identity-auth' },
    { input: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:features-unavailable`), failureClass: 'verification-incomplete' },
    { input: new IrohError('identity_mismatch', 'native lease does not match'), failureClass: 'identity-auth' },
    { input: new IrohError('endpoint_key_unavailable', 'key unavailable'), failureClass: 'endpoint-config' },
    { input: new IrohError('relay_auth_failed', 'relay rejected'), failureClass: 'identity-auth' },
    { input: new IrohError('invalid_descriptor', 'descriptor rejected'), failureClass: 'descriptor-integrity' },
    { input: new IrohError('endpoint_identity_invalid', 'endpoint id rejected'), failureClass: 'descriptor-integrity' },
    { input: new Error(IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR), failureClass: 'descriptor-integrity' },
    { input: new IrohError('invalid_preamble', 'bad preamble byte'), failureClass: 'protocol' },
    { input: new IrohError('unsupported_alpn', 'ALPN rejected'), failureClass: 'protocol' },
    { input: new IrohError('endpoint_config_conflict', 'conflict'), failureClass: 'endpoint-config' },
    { input: new IrohError('resource_limit', 'cap rejected'), failureClass: 'endpoint-config' },
    { input: new Error(IROH_HOME_TUNNEL_STALE_GENERATION_ERROR), failureClass: 'stale-target' },
    { input: new Error(IROH_HOME_TUNNEL_STALE_FOCUS_ERROR), failureClass: 'stale-target' },
    { input: new Error(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:unrecognized-future-reason`), failureClass: 'unclassified' },
    { input: new Error('iroh relay admission rejected'), failureClass: 'unclassified' },
    { input: new Error('boom'), failureClass: 'unclassified' },
    { input: 'not-an-error', failureClass: 'unclassified' },
    { input: undefined, failureClass: 'unclassified' },
];

describe('classifyIrohHomeTunnelSwitchFailure', () => {
    it.each(fallbackAllowedInputs.map((input) => ({ input, label: input instanceof Error ? input.message : String(input) })))('allows the canonical HTTPS fallback for $label', ({ input }) => {
        expect(classifyIrohHomeTunnelSwitchFailure(input)).toEqual({
            fallbackAllowed: true,
            failureClass: 'carrier-unavailable',
        });
    });

    it.each(failClosedInputs.map(({ input, failureClass }) => ({ input, failureClass, label: String(input instanceof Error ? input.message : input) })))(
        'fails closed for $label with class $failureClass',
        ({ input, failureClass }) => {
            expect(classifyIrohHomeTunnelSwitchFailure(input)).toEqual({ fallbackAllowed: false, failureClass });
        },
    );

    it('returns fixed outcomes that never carry input-derived data', () => {
        const secretish = new Error('token=super-secret url=https://private.example.test');
        const classification = classifyIrohHomeTunnelSwitchFailure(secretish);
        expect(Object.values(classification)).not.toContain(secretish.message);
        expect(classification).toEqual({ fallbackAllowed: false, failureClass: 'unclassified' });
    });
});
