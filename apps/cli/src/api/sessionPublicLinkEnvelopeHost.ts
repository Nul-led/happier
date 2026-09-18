import {
  PUBLIC_SHARE_DATA_ENCRYPTION_KEY_BYTES,
  PUBLIC_SHARE_KEY_DERIVATION_PATH_V1,
  PUBLIC_SHARE_KEY_DERIVATION_USAGE_V1,
  SessionPublicLinkCreateActionInputV1Schema,
  sealPublicShareEncryptedDataKeyEnvelopeV0,
} from '@happier-dev/protocol';

import { encodeBase64, getRandomBytes } from '@/api/encryption';
import { deriveKey } from '@/utils/deriveKey';
import { openSessionDataEncryptionKey } from '@/api/client/openSessionDataEncryptionKey';
import { isAuthenticationError } from '@/api/client/httpStatusError';
import { fetchSessionById } from '@/session/transport/http/sessionsHttp';
import type { StoredCredentials } from '@/persistence';

export type SessionPublicLinkEnvelopeHostErrorCode =
  | 'cancelled'
  | 'session_access_stale_scope'
  | 'session_data_key_unavailable'
  | 'session_access_session_not_found'
  | 'not_authenticated'
  | 'unsupported_action'
  | 'session_access_request_failed';

export class SessionPublicLinkEnvelopeHostError extends Error {
  constructor(
    readonly code: SessionPublicLinkEnvelopeHostErrorCode,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'SessionPublicLinkEnvelopeHostError';
  }
}

/**
 * Client-generated bearer for the released owner route. The server stores only
 * its hash and echoes it solely at creation/rotation time; the logical Action
 * never accepts or returns it.
 */
export function generatePublicShareTokenHex(): string {
  return Array.from(getRandomBytes(12), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Uses the Protocol-owned current V0 payload and SecretBox framing. The
 * Protocol reader retains the deployed legacy JSON payload solely for
 * compatibility; both UI and CLI write the same current format.
 */
export async function encryptDataKeyForPublicShare(
  dataKey: Uint8Array,
  token: string,
): Promise<string> {
  if (!(dataKey instanceof Uint8Array) || dataKey.length !== PUBLIC_SHARE_DATA_ENCRYPTION_KEY_BYTES) {
    throw new SessionPublicLinkEnvelopeHostError('session_data_key_unavailable');
  }
  const tokenBytes = new TextEncoder().encode(token);
  if (tokenBytes.length === 0) {
    throw new SessionPublicLinkEnvelopeHostError('session_access_request_failed');
  }
  const wrappingKey = await deriveKey(
    tokenBytes,
    PUBLIC_SHARE_KEY_DERIVATION_USAGE_V1,
    [...PUBLIC_SHARE_KEY_DERIVATION_PATH_V1],
  );
  try {
    return encodeBase64(sealPublicShareEncryptedDataKeyEnvelopeV0({
      dataKey,
      wrappingKey,
      randomBytes: getRandomBytes,
    }));
  } catch {
    throw new SessionPublicLinkEnvelopeHostError('session_access_request_failed');
  }
}

/**
 * Materializes the private physical half of the key-free logical
 * `session.public_link.create` intent. The Home remains the final
 * authorization/currentness owner: this trusted host only opens the exact-Home
 * current Session DEK already available to its bound Account credential and
 * seals it for the freshly generated token. Plain sessions stay key-free.
 * Caller-authored envelopes are rejected by the strict logical parse before
 * any effect.
 */
export async function materializeSessionPublicLinkCreateBody(params: Readonly<{
  token: string;
  credentials: StoredCredentials | undefined;
  serverHttpBaseUrl: string;
  input: unknown;
  isCurrent?: () => boolean | Promise<boolean>;
  signal?: AbortSignal;
}>): Promise<Readonly<{ token: string; encryptedDataKey?: string }>> {
  const logical = SessionPublicLinkCreateActionInputV1Schema.parse(params.input);
  const assertCurrent = async (): Promise<void> => {
    if (params.signal?.aborted) {
      throw new SessionPublicLinkEnvelopeHostError('cancelled');
    }
    if (params.isCurrent) {
      let current = false;
      try {
        current = await params.isCurrent();
      } catch {
        current = false;
      }
      if (!current) throw new SessionPublicLinkEnvelopeHostError('session_access_stale_scope');
    }
  };

  await assertCurrent();
  let rawSession: Awaited<ReturnType<typeof fetchSessionById>>;
  try {
    rawSession = await fetchSessionById({
      token: params.token,
      serverUrl: params.serverHttpBaseUrl,
      sessionId: logical.sessionId,
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (error) {
    if (params.signal?.aborted) {
      throw new SessionPublicLinkEnvelopeHostError('cancelled');
    }
    if (isAuthenticationError(error)) {
      throw new SessionPublicLinkEnvelopeHostError('not_authenticated');
    }
    throw new SessionPublicLinkEnvelopeHostError('session_access_request_failed');
  }
  await assertCurrent();
  if (!rawSession || rawSession.id !== logical.sessionId) {
    throw new SessionPublicLinkEnvelopeHostError('session_access_session_not_found', 404);
  }
  const encryptionMode = (rawSession as Readonly<{ encryptionMode?: unknown }>).encryptionMode === 'plain'
    ? 'plain'
    : 'e2ee';
  const freshToken = generatePublicShareTokenHex().trim();
  if (!freshToken) {
    throw new SessionPublicLinkEnvelopeHostError('session_access_request_failed');
  }
  if (encryptionMode === 'plain') {
    await assertCurrent();
    return { token: freshToken };
  }

  if (!params.credentials || params.credentials.token !== params.token) {
    throw new SessionPublicLinkEnvelopeHostError('session_data_key_unavailable');
  }
  const sessionDataKey = openSessionDataEncryptionKey({
    credential: params.credentials,
    encryptedDataEncryptionKeyBase64: (rawSession as Readonly<{ dataEncryptionKey?: unknown }>).dataEncryptionKey,
  });
  if (!sessionDataKey) {
    throw new SessionPublicLinkEnvelopeHostError('session_data_key_unavailable');
  }
  await assertCurrent();
  const encryptedDataKey = await encryptDataKeyForPublicShare(sessionDataKey, freshToken);
  await assertCurrent();
  return { token: freshToken, encryptedDataKey };
}
