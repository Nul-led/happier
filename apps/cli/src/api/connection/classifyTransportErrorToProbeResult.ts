import type { ReadinessProbeResult } from '@happier-dev/connection-supervisor';

import { readAuthenticationStatus } from '@/api/client/httpStatusError';

/**
 * The one answer to "is this failed transport connect a terminal authentication
 * failure, or just unreachable?".
 *
 * The managed connection supervisor treats every failed `connect()` as
 * `server_unreachable` unless a classifier says otherwise, so a supervisor that
 * supplies none can never fire `onAuthFailed`: a Home that revoked the
 * credential puts that connection into the offline retry loop instead of the
 * intended terminal stop. The decision is transport-agnostic — it reads the
 * authentication status the shared HTTP error owner already exposes — so every
 * supervisor consumes this rather than restating it.
 */
export function classifyTransportErrorToProbeResult(
  error: unknown,
): Exclude<ReadinessProbeResult, Readonly<{ status: 'ready' }>> | null {
  const statusCode = readAuthenticationStatus(error);
  if (!statusCode) return null;
  return {
    status: 'auth_failed',
    statusCode,
    errorMessage: error instanceof Error ? error.message : 'Authentication failed',
  };
}
