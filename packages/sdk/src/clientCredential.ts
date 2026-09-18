import {
  AccountApiTokenEncryptionAccessResponseV1Schema,
  parseAccountApiTokenBearerV1,
  parseAccountApiTokenCredentialV1,
} from '@happier-dev/protocol/auth/accountApiTokens';
import { openApiTokenEncryptionAccessV1 } from '@happier-dev/protocol';
import { decodeBase64 } from '@happier-dev/protocol/crypto/base64';

import { HappierClientClosedError, HappierTransportError } from './errors.js';

/** One root-client secret lifetime, shared by every derived handle. */
export function createClientCredential(token: string) {
  const parsed = parseAccountApiTokenCredentialV1(token);
  const bearer = parsed?.bearer ?? token;
  const identity = parseAccountApiTokenBearerV1(bearer);
  if (identity === null || (token.startsWith('hapc_') && parsed === null)) {
    throw new TypeError('token must be an exact Happier API Token or encryption-capable credential');
  }
  if (parsed === null) return { bearer, encryption: undefined, dispose: () => undefined };

  const pins = { serverIdentityId: parsed.serverIdentityId, accountId: parsed.accountId,
    contentPublicKey: parsed.contentPublicKey, tokenId: identity.tokenId };
  const wrappingSecret = decodeBase64(parsed.wrappingSecret, 'base64url');
  let material: Readonly<{ type: 'dataKey'; machineKey: Uint8Array }> | undefined;
  let initialization: Promise<NonNullable<typeof material>> | undefined;
  let disposed = false;

  const getMaterial = (retrieve: () => Promise<unknown>) => {
    if (disposed) return Promise.reject(new HappierClientClosedError());
    if (material) return Promise.resolve(material);
    initialization ??= (async () => {
      try {
        const response = AccountApiTokenEncryptionAccessResponseV1Schema.safeParse(await retrieve());
        if (disposed) throw new HappierClientClosedError();
        const key = response.success && response.data.accountId === pins.accountId
          && response.data.tokenId === pins.tokenId
          ? openApiTokenEncryptionAccessV1({ context: pins, wrappingSecret,
            encryptionAccess: response.data.encryptionAccess }) : null;
        if (!key) throw new HappierTransportError('The API credential encryption material could not be opened.', {
          code: 'invalid_encrypted_envelope',
        });
        material = { type: 'dataKey', machineKey: key };
        return material;
      } catch (error) {
        initialization = undefined;
        throw error;
      }
    })();
    return initialization;
  };
  return {
    bearer,
    encryption: { pins, getMaterial },
    dispose: () => {
      disposed = true;
      wrappingSecret.fill(0);
      material?.machineKey.fill(0);
      material = undefined;
      initialization = undefined;
    },
  };
}

export type ClientCredential = ReturnType<typeof createClientCredential>;

/** Cancels only this waiter; the shared bootstrap retains its root lifetime. */
export function waitForClientMaterial<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
