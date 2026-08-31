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
