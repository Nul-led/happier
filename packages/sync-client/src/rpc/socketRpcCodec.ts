import { createRpcCallError } from '@happier-dev/protocol/rpcErrors';

export type SocketRpcContent =
  | Readonly<{ mode: 'plain' }>
  | Readonly<{ mode: 'e2ee'; cipher: Readonly<{
      encryptRaw(value: unknown): Promise<string>;
      decryptRaw(ciphertext: string): Promise<unknown | null>;
    }> }>;

async function encode(content: SocketRpcContent, value: unknown): Promise<unknown> {
  return content.mode === 'plain' ? value : content.cipher.encryptRaw(value);
}
async function decode(content: SocketRpcContent, value: unknown): Promise<unknown> {
  if (content.mode === 'plain') return value;
  if (typeof value !== 'string') throw createRpcCallError({ error: 'Invalid encrypted RPC content', errorCode: 'RPC_CONTENT_UNAVAILABLE' });
  return content.cipher.decryptRaw(value);
}
async function decodeRequestParams(content: SocketRpcContent, value: unknown): Promise<unknown> {
  const opened = await decode(content, value);
  if (content.mode === 'e2ee' && opened === null) throw createRpcCallError({ error: 'Unable to open RPC content', errorCode: 'RPC_CONTENT_UNAVAILABLE' });
  return opened;
}
async function decodeResult(content: SocketRpcContent, acknowledgement: unknown): Promise<unknown> {
  if (!acknowledgement || typeof acknowledgement !== 'object') throw createRpcCallError({ error: 'Invalid RPC acknowledgement' });
  const ack = acknowledgement as { ok?: unknown; result?: unknown; error?: unknown; errorCode?: unknown };
  if (ack.ok === true) return decode(content, ack.result);
  throw createRpcCallError({
    error: typeof ack.error === 'string' ? ack.error : 'RPC call failed',
    errorCode: typeof ack.errorCode === 'string' ? ack.errorCode : undefined,
  });
}
/** Responders encode their raw result; the relay owns the outer acknowledgement. */
export const socketRpcCodec = Object.freeze({ encodeParams: encode, decodeResult, decodeRequestParams, encodeResponse: encode });
