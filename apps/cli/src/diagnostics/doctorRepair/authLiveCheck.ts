/**
 * Live auth verification for the active server profile.
 *
 * Hits `GET /v1/account/profile` with the stored bearer token and a short
 * timeout. We interpret the outcome conservatively so offline/network failures
 * DON'T cause a false "expired" report:
 *
 * The canonical validator owns validity and confirmed account identity.
 * Preserve that result so consumers cannot lose the verified account when
 * selecting a machine for an opaque credential.
 */

import {
  validateStoredAuthTokenAgainstServer,
  type ActiveServerStoredTokenValidationResult,
} from '@/auth/validateStoredAuthTokenAgainstActiveServer';

export type LiveAuthResult = ActiveServerStoredTokenValidationResult;

const DEFAULT_TIMEOUT_MS = 3_000;

export async function checkAuthLive(params: Readonly<{
  serverUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}>): Promise<LiveAuthResult> {
  const url = String(params.serverUrl ?? '').trim();
  const token = String(params.token ?? '').trim();
  if (!url || !token) return { state: 'unknown', httpStatus: null, reasonCode: 'missing-profile-credentials' };
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = params.fetchImpl ?? fetch;

  return validateStoredAuthTokenAgainstServer({
    token,
    serverUrl: url,
    timeoutMs,
    fetchImpl,
  });
}
