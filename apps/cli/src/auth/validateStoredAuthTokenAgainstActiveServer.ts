import { isAuthenticationStatus } from '@/api/client/httpStatusError';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { fetchServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { resolveCurrentCliHomeTarget } from '@/server/homeTarget';

import { verifyTerminalAuthEnrollmentRuntime } from './terminalAuthEnrollmentClient';
import { acquireTerminalAuthEnrollmentRuntime } from './terminalAuthEnrollmentRuntime';

export type ActiveServerStoredTokenValidationResult = Readonly<
  | { state: 'valid'; httpStatus: number }
  | { state: 'invalid'; httpStatus: number; reasonCode: string }
  | { state: 'unknown'; httpStatus: number | null; reasonCode: string }
>;

type StoredAuthTokenValidationParams = Readonly<{
  token: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

function readResponseCode(body: unknown, fallback: string): string {
  return typeof (body as { code?: unknown })?.code === 'string' && (body as { code: string }).code.trim()
    ? (body as { code: string }).code.trim()
    : fallback;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function validateStoredAuthTokenAgainstServer(
  params: StoredAuthTokenValidationParams,
): Promise<ActiveServerStoredTokenValidationResult> {
  const trimmedToken = String(params.token ?? '').trim();
  if (!trimmedToken) {
    return { state: 'invalid', httpStatus: 401, reasonCode: 'missing-token' };
  }
  const baseUrl = String(params.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return { state: 'unknown', httpStatus: null, reasonCode: 'missing-server-url' };
  }
  const fetchImpl = params.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(`${baseUrl}/v1/account/profile`, {
      method: 'GET',
      headers: {
        ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(),
        Authorization: `Bearer ${trimmedToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(params.timeoutMs ?? 5_000),
    });

    const body = await readJsonBody(response);
    if (response.ok) {
      const accountId = (body as { id?: unknown } | null)?.id;
      if (typeof accountId === 'string' && accountId.trim().length > 0) {
        return { state: 'valid', httpStatus: response.status };
      }
      return { state: 'unknown', httpStatus: response.status, reasonCode: 'invalid-profile-response' };
    }

    if (isAuthenticationStatus(response.status)) {
      return {
        state: 'invalid',
        httpStatus: response.status,
        reasonCode: readResponseCode(body, 'not_authenticated'),
      };
    }

    return {
      state: 'unknown',
      httpStatus: response.status,
      reasonCode: readResponseCode(body, `http-${response.status}`),
    };
  } catch (error) {
    return {
      state: 'unknown',
      httpStatus: null,
      reasonCode: error instanceof Error ? error.name : 'request-error',
    };
  }
}

export async function validateStoredAuthTokenAgainstActiveServer(
  token: string,
): Promise<ActiveServerStoredTokenValidationResult> {
  const target = await resolveCurrentCliHomeTarget().catch(() => null);
  if (!target?.descriptor) {
    return validateStoredAuthTokenAgainstServer({
      token,
      baseUrl: resolveServerHttpBaseUrl(),
    });
  }

  const acquired = await acquireTerminalAuthEnrollmentRuntime(
    target.descriptor,
    target.preferredTransport,
  );
  if (!acquired.ok) {
    return {
      state: 'unknown',
      httpStatus: null,
      reasonCode: acquired.reason === 'fail_closed'
        ? 'home-carrier-fail-closed'
        : 'home-carrier-unavailable',
    };
  }
  try {
    const snapshot = await fetchServerFeaturesSnapshot({
      serverUrl: acquired.runtime.runtimeOrigin,
      token,
    });
    verifyTerminalAuthEnrollmentRuntime({
      target,
      runtime: acquired.runtime,
      snapshot,
    });
    return await validateStoredAuthTokenAgainstServer({
      token,
      baseUrl: acquired.runtime.runtimeOrigin,
    });
  } catch (error) {
    return {
      state: 'unknown',
      httpStatus: null,
      reasonCode: error instanceof Error ? error.name : 'home-carrier-verification-failed',
    };
  } finally {
    await acquired.close().catch(() => undefined);
  }
}
import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
