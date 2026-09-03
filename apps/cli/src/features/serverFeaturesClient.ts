import type { FeaturesResponse as ServerFeatures } from '@happier-dev/protocol';

import { normalizeBaseUrl, withAbortTimeout } from '../diagnostics/httpClient';
import { parseServerFeatures } from './serverFeaturesParse';

export type CliServerFeaturesSnapshot =
  | Readonly<{ status: 'ready'; features: ServerFeatures }>
  | Readonly<{ status: 'unsupported'; reason: 'endpoint_missing' | 'invalid_payload' }>
  | Readonly<{ status: 'error'; reason: 'network' | 'timeout' | 'response_status' }>;

function isEndpointMissing(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

export async function fetchServerFeaturesSnapshot(params: {
  serverUrl: string;
  /** Home credential requests the exact authenticated descriptor projection. */
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<CliServerFeaturesSnapshot> {
  const timeoutMs = params.timeoutMs ?? 6000;
  const token = params.token?.trim();
  const path = token ? '/v1/features/authenticated' : '/v1/features';

  try {
    const response = await withAbortTimeout(
      timeoutMs,
      async (signal) => await fetch(`${normalizeBaseUrl(params.serverUrl)}${path}`, {
        method: 'GET',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        signal,
      }),
      params.signal,
    );

    if (!response.ok) {
      return isEndpointMissing(response.status)
        ? { status: 'unsupported', reason: 'endpoint_missing' }
        : { status: 'error', reason: 'response_status' };
    }

    const payload: unknown = await response.json();
    const parsed = parseServerFeatures(payload);
    if (!parsed) {
      return { status: 'unsupported', reason: 'invalid_payload' };
    }

    return {
      status: 'ready',
      features: parsed,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return {
      status: 'error',
      reason: isTimeout ? 'timeout' : 'network',
    };
  }
}
