import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { HappyError } from '@/utils/errors/errors';
import { backoff } from '@/utils/timing/time';
import { serverFetch, type ServerFetch } from '@/sync/http/client';
import { invalidateAccountEncryptionModeCache } from './apiAccountEncryptionMode';
import {
  assertCurrentAccountStoredContentServerCompatibility,
  requireCurrentAccountStoredContentServerCompatibility,
} from '@/sync/api/capabilities/accountStoredContentCompatibility';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import {
  AccountEncryptionMigrateSuccessResponseSchema,
  AccountEncryptionMigrateAnyErrorResponseSchema,
  type AccountEncryptionMigrateRequest,
} from '@happier-dev/protocol';

export { AccountEncryptionMigrateRequestSchema, type AccountEncryptionMigrateRequest } from '@happier-dev/protocol';

export async function migrateAccountEncryptionMode(
  credentials: AuthCredentials,
  request: AccountEncryptionMigrateRequest,
  options: Readonly<{
    retry?: 'default' | 'none';
    request?: ServerFetch;
    target?: Readonly<{ serverUrl: string; serverId: string }>;
  }> = {},
): Promise<import('@happier-dev/protocol').AccountEncryptionMigrateSuccessResponse> {
  if (options.target) {
    assertCurrentAccountStoredContentServerCompatibility(
      await probeServerFeaturesAtUrl({
        endpointUrl: options.target.serverUrl,
        serverId: options.target.serverId,
        force: true,
      }),
    );
  } else {
    await requireCurrentAccountStoredContentServerCompatibility();
  }
  const migrateOnce = async () => {
    const response = await (options.request ?? serverFetch)(
      '/v1/account/encryption/migrate',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      },
      options.retry === 'none'
        ? { includeAuth: false, retry: 'none' }
        : { includeAuth: false },
    );

    const data: unknown = await response.json().catch(() => null);
    const success = AccountEncryptionMigrateSuccessResponseSchema.safeParse(data);
    if (response.ok && success.success) {
      invalidateAccountEncryptionModeCache();
      return success.data;
    }
    if (response.ok) {
      throw new HappyError(
        'This server returned an incompatible account encryption migration response',
        false,
        {
          status: response.status,
          kind: 'server',
          code:
            'account-encryption-migration-response-incompatible',
        },
      );
    }

    const parsedError = AccountEncryptionMigrateAnyErrorResponseSchema.safeParse(data);
    if (parsedError.success) {
      const err = parsedError.data;
      if (err.error === 'not_found') {
        throw new HappyError('Encryption opt-out is not enabled on this server', false, {
          status: response.status,
          kind: 'config',
          code: err.error,
        });
      }
      if (err.error === 'invalid-params' && err.reason) {
        throw new HappyError('Failed to update encryption setting', false, {
          status: response.status,
          kind: 'server',
          code: err.reason,
        });
      }
      throw new HappyError('Failed to update encryption setting', false, {
        status: response.status,
        kind: 'server',
        code: err.error,
      });
    }

    if (response.status === 404) {
      throw new HappyError('Encryption opt-out is not enabled on this server', false, {
        status: response.status,
        kind: 'config',
      });
    }

    throw new HappyError('Failed to update encryption setting', false, { status: response.status, kind: 'server' });
  };
  if (options.retry === 'none') {
    return await migrateOnce();
  }
  return await backoff(migrateOnce);
}
