import type { IrohErrorCode } from '@happier-dev/iroh-native';

/**
 * Stable Iroh Home tunnel error identities. This module is the single owner of
 * these strings; the supervisor/runtime throw through them so the switch-time
 * classifier never scatters or drifts from the produced identities.
 */
export const IROH_HOME_TUNNEL_SUSPENDED_ERROR = 'iroh_home_tunnel_suspended';
export const IROH_HOME_TUNNEL_PROBE_FAILED_ERROR = 'iroh_home_tunnel_probe_failed';
export const IROH_HOME_TUNNEL_STALE_GENERATION_ERROR = 'iroh_home_tunnel_stale_generation';
export const IROH_HOME_TUNNEL_STALE_FOCUS_ERROR = 'iroh_home_tunnel_stale_focus';
export const IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR = 'iroh_home_tunnel_invalid_endpoint';

/**
 * Lane-06 fallback matrix: the independently valid canonical HTTPS carrier may
 * serve the switch only when the Iroh acquisition failed purely on native
 * availability, transport loss, or bounded health reachability. Identity, auth,
 * descriptor/integrity, protocol (ALPN/preamble), endpoint-config, and
 * stale-target failures fail closed: the switch target is unsafe or stale, so
 * `syncSwitchServer` must never run for it. Unknown errors fail closed.
 */
export type IrohHomeTunnelFailureClass =
    | 'carrier-unavailable'
    | 'identity-auth'
    | 'descriptor-integrity'
    | 'protocol'
    | 'endpoint-config'
    | 'stale-target'
    | 'verification-incomplete'
    | 'unclassified';

export type IrohHomeTunnelSwitchFailureClassification = Readonly<{
    fallbackAllowed: boolean;
    failureClass: IrohHomeTunnelFailureClass;
}>;

const FALLBACK_ALLOWED: IrohHomeTunnelSwitchFailureClassification = {
    fallbackAllowed: true,
    failureClass: 'carrier-unavailable',
};

function failClosed(failureClass: IrohHomeTunnelFailureClass): IrohHomeTunnelSwitchFailureClassification {
    return { fallbackAllowed: false, failureClass };
}

/** Known native codes; codes added to `IrohErrorCode` later fail closed by default. */
const IROH_ERROR_CLASSIFICATIONS: Partial<Record<IrohErrorCode, IrohHomeTunnelSwitchFailureClassification>> = {
    unavailable: FALLBACK_ALLOWED,
    transport: FALLBACK_ALLOWED,
    home_unreachable: FALLBACK_ALLOWED,
    transport_timeout: FALLBACK_ALLOWED,
    transport_closed: FALLBACK_ALLOWED,
    endpoint_identity_invalid: failClosed('descriptor-integrity'),
    identity_mismatch: failClosed('identity-auth'),
    endpoint_key_unavailable: failClosed('endpoint-config'),
    relay_auth_failed: failClosed('identity-auth'),
    invalid_descriptor: failClosed('descriptor-integrity'),
    invalid_preamble: failClosed('protocol'),
    unsupported_alpn: failClosed('protocol'),
    endpoint_config_conflict: failClosed('endpoint-config'),
    loopback_bind_failed: failClosed('endpoint-config'),
    resource_limit: failClosed('endpoint-config'),
    cancelled: failClosed('unclassified'),
    unknown: failClosed('unclassified'),
};

function readIrohErrorCode(error: unknown): IrohErrorCode | null {
    if (typeof error !== 'object' || error === null) return null;
    const candidate = error as Readonly<{ name?: unknown; code?: unknown }>;
    if (candidate.name !== 'IrohError' || typeof candidate.code !== 'string') return null;
    return Object.prototype.hasOwnProperty.call(IROH_ERROR_CLASSIFICATIONS, candidate.code)
        ? candidate.code as IrohErrorCode
        : null;
}

/**
 * Probe-chain reasons (readiness/feature/identity verification through the
 * lease origin). A bounded probe timeout is a reachability outcome, not an
 * auth or identity denial: the readiness probe reports auth denial as
 * `auth-failed` before any timeout can.
 */
const PROBE_REASON_CLASSIFICATIONS: Record<string, IrohHomeTunnelSwitchFailureClassification> = {
    'health-unavailable': FALLBACK_ALLOWED,
    'probe-timeout': FALLBACK_ALLOWED,
    'auth-failed': failClosed('identity-auth'),
    'identity-mismatch': failClosed('identity-auth'),
    'features-unavailable': failClosed('verification-incomplete'),
};

/**
 * Classifies one Iroh Home tunnel acquisition failure for the switch boundary.
 * Returns stable typed outcomes only; the input error is never modified, and
 * no token, URL credential, or endpoint data enters the result.
 */
export function classifyIrohHomeTunnelSwitchFailure(error: unknown): IrohHomeTunnelSwitchFailureClassification {
    // Native/module boundaries may recreate the package module, so class
    // identity is not a stable part of the exported error contract. Match its
    // exact public name/code shape; unknown or future codes still fail closed.
    const irohErrorCode = readIrohErrorCode(error);
    if (irohErrorCode !== null) {
        return IROH_ERROR_CLASSIFICATIONS[irohErrorCode] ?? failClosed('unclassified');
    }
    const message = error instanceof Error ? error.message : '';
    if (message === IROH_HOME_TUNNEL_SUSPENDED_ERROR) return FALLBACK_ALLOWED;
    if (message.startsWith(`${IROH_HOME_TUNNEL_PROBE_FAILED_ERROR}:`)) {
        const reason = message.slice(IROH_HOME_TUNNEL_PROBE_FAILED_ERROR.length + 1);
        return PROBE_REASON_CLASSIFICATIONS[reason] ?? failClosed('unclassified');
    }
    if (message === IROH_HOME_TUNNEL_STALE_GENERATION_ERROR || message === IROH_HOME_TUNNEL_STALE_FOCUS_ERROR) {
        return failClosed('stale-target');
    }
    if (message === IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR) return failClosed('descriptor-integrity');
    return failClosed('unclassified');
}
