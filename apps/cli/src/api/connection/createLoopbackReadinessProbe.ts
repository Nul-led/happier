import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import axios from 'axios';
import type { ReadinessProbeResult } from '@happier-dev/connection-supervisor';

import { isAuthenticationStatus } from '@/api/client/httpStatusError';
import { resolveLoopbackHttpUrl } from '@/api/client/loopbackUrl';
import { decodeServerFeaturesResponseBody } from '@/features/serverFeaturesParse';

export function createLoopbackHomeIdentityProbe(params: Readonly<{
  serverUrl: string;
  expectedServerIdentityId?: string;
}>): () => Promise<ReadinessProbeResult> {
  const serverUrl = resolveLoopbackHttpUrl(params.serverUrl).replace(/\/+$/, '');

  return async () => {
    try {
      const featuresResponse = await axios.get(`${serverUrl}/v1/features`, {
        timeout: 5_000,
        responseType: 'stream',
        validateStatus: () => true,
      });

      if (featuresResponse.status >= 500) {
        return {
          status: 'retry_later',
          errorMessage: `Home identity probe returned ${featuresResponse.status}`,
        };
      }
      if (featuresResponse.status >= 400) {
        return {
          status: 'server_unreachable',
          errorMessage: `Home identity probe returned ${featuresResponse.status}`,
        };
      }
      const parsed = await decodeServerFeaturesResponseBody(
        featuresResponse.data,
        featuresResponse.headers?.['content-length'],
      );
      if (params.expectedServerIdentityId) {
        const observedIdentity = parsed
          ? parsed.capabilities.serverIdentity.serverIdentityId?.trim() ?? ''
          : '';
        if (observedIdentity !== params.expectedServerIdentityId) {
          return {
            status: 'auth_failed',
            errorMessage: 'Home identity did not match the expected profile',
          };
        }
      }
      return { status: 'ready' };
    } catch (error) {
      return {
        status: 'server_unreachable',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

export function createLoopbackReadinessProbe(params: Readonly<{
  serverUrl: string;
  token: string;
  expectedServerIdentityId?: string;
}>): () => Promise<ReadinessProbeResult> {
  const serverUrl = resolveLoopbackHttpUrl(params.serverUrl).replace(/\/+$/, '');

  return async () => {
    const identity = await createLoopbackHomeIdentityProbe(params)();
    if (identity.status !== 'ready') return identity;

    try {
      const authResponse = await axios.get(`${serverUrl}/v1/auth/ping`, {
        timeout: 5_000,
        validateStatus: () => true,
        headers: {
          ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(),
          Authorization: `Bearer ${params.token}`,
        },
      });

      if (isAuthenticationStatus(authResponse.status)) {
        return {
          status: 'auth_failed',
          statusCode: authResponse.status,
          errorMessage: `Authenticated probe returned ${authResponse.status}`,
        };
      }

      if (authResponse.status >= 500) {
        return {
          status: 'retry_later',
          errorMessage: `Authenticated probe returned ${authResponse.status}`,
        };
      }

      if (authResponse.status >= 400) {
        return {
          status: 'server_unreachable',
          errorMessage: `Authenticated probe returned ${authResponse.status}`,
        };
      }

      return { status: 'ready' };
    } catch (error) {
      return {
        status: 'server_unreachable',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
