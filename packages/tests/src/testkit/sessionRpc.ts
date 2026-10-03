import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { createLegacyRpcClient, type RpcSocket } from './syntheticAgent/rpcClient';
import { waitFor } from './timing';
import { unwrapSerializedJsonValue } from './unwrapSerializedJsonValue';
type SafeParseResult<T> = { success: true; data: T } | { success: false };
type ParseSchema<T> = { safeParse: (input: unknown) => SafeParseResult<T> };

class LegacyEncryptedSessionRpcApplicationError extends Error {
  readonly name = 'LegacyEncryptedSessionRpcApplicationError';
}

export async function callLegacyEncryptedSessionRpc<TReq, TRes>(params: {
  ui: RpcSocket;
  sessionId: string;
  method: string;
  req: TReq;
  secret: Uint8Array;
  schema: ParseSchema<TRes>;
  timeoutMs?: number;
}): Promise<TRes> {
  let out: TRes | undefined;
  let lastAck: unknown = null;
  let lastDecrypted: unknown = null;

  const isRpcErrorEnvelope = (value: unknown): value is { ok: false; error?: unknown; errorCode?: unknown; errorMessage?: unknown } => {
    return !!value && typeof value === 'object' && (value as { ok?: unknown }).ok === false;
  };

  const client = createLegacyRpcClient(params.ui, params.secret, 'session');

  try {
    await waitFor(
      async () => {
        const method = params.method.startsWith(`${params.sessionId}:`)
          ? params.method
          : `${params.sessionId}:${params.method}`;
        const res = await client.call(method, params.req);
        lastAck = res;
        if (res.ok !== true) {
          if (res.errorCode === RPC_ERROR_CODES.UPDATE_REQUIRED) {
            throw new LegacyEncryptedSessionRpcApplicationError(`RPC returned application error (${res.errorCode}): ${res.error}`);
          }
          return false;
        }
        const decrypted = unwrapSerializedJsonValue(res.result);
        lastDecrypted = decrypted;
        if (isRpcErrorEnvelope(decrypted)) {
          const errorCode = typeof decrypted.errorCode === 'string' ? ` (${decrypted.errorCode})` : '';
          const errorMessage =
            typeof decrypted.error === 'string'
              ? decrypted.error
              : typeof decrypted.errorMessage === 'string'
                ? decrypted.errorMessage
                : 'Unknown RPC error';
          throw new LegacyEncryptedSessionRpcApplicationError(`RPC returned application error${errorCode}: ${errorMessage}`);
        }
        const parsed = params.schema.safeParse(decrypted);
        if (!parsed.success) return false;
        out = parsed.data;
        return true;
      },
      {
        timeoutMs: params.timeoutMs ?? 25_000,
        shouldRetryOnError: (error) => !(error instanceof LegacyEncryptedSessionRpcApplicationError),
      },
    );
  } catch (error) {
    if (error instanceof LegacyEncryptedSessionRpcApplicationError) {
      throw error;
    }
    throw new Error(
      `RPC call timed out waiting for a valid response: ${params.method}; ack=${JSON.stringify(lastAck)} decrypted=${JSON.stringify(lastDecrypted)} cause=${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (out === undefined) {
    throw new Error(
      `RPC call did not return a valid response: ${params.method}; ack=${JSON.stringify(lastAck)} decrypted=${JSON.stringify(lastDecrypted)}`,
    );
  }
  return out;
}
