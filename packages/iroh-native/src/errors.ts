export type IrohErrorCode =
  | 'unavailable'
  | 'invalid_descriptor'
  | 'endpoint_identity_invalid'
  | 'identity_mismatch'
  | 'endpoint_key_unavailable'
  | 'relay_auth_failed'
  | 'invalid_preamble'
  | 'unsupported_alpn'
  | 'endpoint_config_conflict'
  | 'loopback_bind_failed'
  | 'home_unreachable'
  | 'transport_timeout'
  | 'transport_closed'
  | 'resource_limit'
  | 'cancelled'
  | 'transport'
  | 'unknown';

export class IrohError extends Error {
  readonly code: IrohErrorCode;
  constructor(code: IrohErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IrohError';
    this.code = code;
  }
}

const NATIVE_ERROR_CODES: Readonly<Record<string, IrohErrorCode>> = {
  unavailable: 'unavailable',
  native_unavailable: 'unavailable',
  'engine-unavailable': 'unavailable',
  invalid_request: 'invalid_descriptor',
  'invalid-request': 'invalid_descriptor',
  invalid_descriptor: 'invalid_descriptor',
  'endpoint-identity-invalid': 'endpoint_identity_invalid',
  endpoint_identity_invalid: 'endpoint_identity_invalid',
  'endpoint-identity-mismatch': 'identity_mismatch',
  endpoint_identity_mismatch: 'identity_mismatch',
  identity_mismatch: 'identity_mismatch',
  endpoint_key_unavailable: 'endpoint_key_unavailable',
  'endpoint-key-unavailable': 'endpoint_key_unavailable',
  relay_auth_failed: 'relay_auth_failed',
  'relay-auth-failed': 'relay_auth_failed',
  invalid_preamble: 'invalid_preamble',
  'invalid-preamble': 'invalid_preamble',
  unsupported_alpn: 'unsupported_alpn',
  'unsupported-alpn': 'unsupported_alpn',
  endpoint_config_conflict: 'endpoint_config_conflict',
  loopback_bind_failed: 'loopback_bind_failed',
  'loopback-bind-failed': 'loopback_bind_failed',
  home_unreachable: 'home_unreachable',
  'home-unreachable': 'home_unreachable',
  transport_timeout: 'transport_timeout',
  'transport-timeout': 'transport_timeout',
  transport_closed: 'transport_closed',
  'transport-closed': 'transport_closed',
  resource_limit: 'resource_limit',
  'resource-limit': 'resource_limit',
  cancelled: 'cancelled',
  'transport-unavailable': 'transport',
  transport: 'transport',
  'machine-control-invalid': 'invalid_descriptor',
  'machine-admission-rejected': 'unknown',
};

/** Canonical native-code normalization shared by Node, Expo, and desktop. */
export function classifyIrohNativeErrorCode(nativeCode: string): IrohErrorCode {
  return NATIVE_ERROR_CODES[nativeCode] ?? 'unknown';
}

function readStringField(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function readNativeCode(error: unknown): string | null {
  return readStringField(error, 'nativeCode')
    ?? readStringField(error, 'code')
    ?? readStringField(
      typeof error === 'object' && error !== null
        ? (error as Record<string, unknown>).userInfo
        : null,
      'code',
    );
}

function readPrefixedNativeFailure(message: string): Readonly<{ code: string; message: string }> | null {
  const prefix = 'iroh_native_error:';
  if (!message.startsWith(prefix)) return null;
  const encoded = message.slice(prefix.length);
  const separator = encoded.indexOf(':');
  if (separator <= 0) return null;
  return { code: encoded.slice(0, separator), message: encoded.slice(separator + 1) };
}

/**
 * Normalizes real Expo CodedException/NSError/Java exception shapes without
 * serializing the error object (which could carry native/private fields).
 */
export function normalizeIrohNativeError(
  error: unknown,
  fallbackCode: IrohErrorCode = 'unavailable',
): IrohError {
  if (error instanceof IrohError) {
    return error.name === 'IrohError'
      ? error
      : new IrohError(error.code, error.message, { cause: error });
  }
  const message = error instanceof Error ? error.message : 'Iroh native operation failed';
  const prefixed = readPrefixedNativeFailure(message);
  if (prefixed) {
    return new IrohError(classifyIrohNativeErrorCode(prefixed.code), prefixed.message, { cause: error });
  }
  const nativeCode = readNativeCode(error);
  return new IrohError(
    nativeCode === null ? fallbackCode : classifyIrohNativeErrorCode(nativeCode),
    message,
    { cause: error },
  );
}

export const IROH_HOME_TUNNEL_SUSPENDED_ERROR = 'iroh_home_tunnel_suspended';
export const IROH_HOME_TUNNEL_PROBE_FAILED_ERROR = 'iroh_home_tunnel_probe_failed';
export const IROH_HOME_TUNNEL_STALE_GENERATION_ERROR = 'iroh_home_tunnel_stale_generation';
export const IROH_HOME_TUNNEL_STALE_FOCUS_ERROR = 'iroh_home_tunnel_stale_focus';
export const IROH_HOME_TUNNEL_INVALID_ENDPOINT_ERROR = 'iroh_home_tunnel_invalid_endpoint';

export type IrohHomeCarrierFailureClass =
  | 'carrier-unavailable'
  | 'identity-auth'
  | 'descriptor-integrity'
  | 'protocol'
  | 'endpoint-config'
  | 'stale-target'
  | 'verification-incomplete'
  | 'unclassified';

export type IrohHomeCarrierFailureClassification = Readonly<{
  fallbackAllowed: boolean;
  failureClass: IrohHomeCarrierFailureClass;
}>;

const FALLBACK_ALLOWED: IrohHomeCarrierFailureClassification = {
  fallbackAllowed: true,
  failureClass: 'carrier-unavailable',
};

function failClosed(failureClass: IrohHomeCarrierFailureClass): IrohHomeCarrierFailureClassification {
  return { fallbackAllowed: false, failureClass };
}

const IROH_ERROR_CLASSIFICATIONS: Readonly<Record<IrohErrorCode, IrohHomeCarrierFailureClassification>> = {
  unavailable: FALLBACK_ALLOWED,
  transport: FALLBACK_ALLOWED,
  home_unreachable: FALLBACK_ALLOWED,
  transport_timeout: FALLBACK_ALLOWED,
  transport_closed: FALLBACK_ALLOWED,
  invalid_descriptor: failClosed('descriptor-integrity'),
  endpoint_identity_invalid: failClosed('descriptor-integrity'),
  identity_mismatch: failClosed('identity-auth'),
  endpoint_key_unavailable: failClosed('endpoint-config'),
  relay_auth_failed: failClosed('identity-auth'),
  invalid_preamble: failClosed('protocol'),
  unsupported_alpn: failClosed('protocol'),
  endpoint_config_conflict: failClosed('endpoint-config'),
  loopback_bind_failed: failClosed('endpoint-config'),
  resource_limit: failClosed('endpoint-config'),
  cancelled: failClosed('unclassified'),
  unknown: failClosed('unclassified'),
};

const PROBE_REASON_CLASSIFICATIONS: Readonly<Record<string, IrohHomeCarrierFailureClassification>> = {
  'health-unavailable': FALLBACK_ALLOWED,
  'probe-timeout': FALLBACK_ALLOWED,
  'auth-failed': failClosed('identity-auth'),
  'identity-mismatch': failClosed('identity-auth'),
  'features-unavailable': failClosed('verification-incomplete'),
};

function readIrohErrorCode(error: unknown): IrohErrorCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as Readonly<{ name?: unknown; code?: unknown }>;
  if (
    (candidate.name !== 'IrohError' && candidate.name !== 'IrohNativeOperationError')
    || typeof candidate.code !== 'string'
  ) return null;
  return Object.prototype.hasOwnProperty.call(IROH_ERROR_CLASSIFICATIONS, candidate.code)
    ? candidate.code as IrohErrorCode
    : null;
}

/**
 * Classifies one Home Iroh acquisition failure. An independently trusted HTTPS
 * origin may remain usable only after native unavailability or bounded network
 * reachability/connection loss. Identity, authorization, descriptor integrity,
 * protocol, endpoint configuration, cancellation, and unknown failures fail
 * closed. Callers remain responsible for independently validating HTTPS trust.
 */
export function classifyIrohHomeCarrierFailure(error: unknown): IrohHomeCarrierFailureClassification {
  const code = readIrohErrorCode(error);
  if (code !== null) return IROH_ERROR_CLASSIFICATIONS[code];

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
