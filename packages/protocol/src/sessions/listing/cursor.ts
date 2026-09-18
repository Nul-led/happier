import { decodeBase64, encodeBase64 } from '../../crypto/base64.js';

export const V2_SESSION_LIST_CURSOR_V1_PREFIX = 'cursor_v1_' as const;
export const V2_SESSION_LIST_CURSOR_V2_PREFIX = 'cursor_v2_' as const;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeV2SessionListCursorV1(sessionId: string): string {
  return `${V2_SESSION_LIST_CURSOR_V1_PREFIX}${sessionId}`;
}

export function decodeV2SessionListCursorV1(cursor: string): string | null {
  if (typeof cursor !== 'string') return null;
  if (!cursor.startsWith(V2_SESSION_LIST_CURSOR_V1_PREFIX)) return null;
  const sessionId = cursor.slice(V2_SESSION_LIST_CURSOR_V1_PREFIX.length);
  return sessionId.length > 0 ? sessionId : null;
}

export type V2SessionListCursorV2 = Readonly<{
  sessionId: string;
  meaningfulActivityAt: number;
}>;

export function encodeV2SessionListCursorV2(cursor: V2SessionListCursorV2): string {
  const payload = JSON.stringify({
    sessionId: cursor.sessionId,
    meaningfulActivityAt: cursor.meaningfulActivityAt,
  });
  return `${V2_SESSION_LIST_CURSOR_V2_PREFIX}${encodeBase64(textEncoder.encode(payload), 'base64url')}`;
}

export function decodeV2SessionListCursorV2(cursor: string): V2SessionListCursorV2 | null {
  if (typeof cursor !== 'string') return null;
  if (!cursor.startsWith(V2_SESSION_LIST_CURSOR_V2_PREFIX)) return null;
  try {
    const payload = cursor.slice(V2_SESSION_LIST_CURSOR_V2_PREFIX.length);
    const decoded = JSON.parse(textDecoder.decode(decodeBase64(payload, 'base64url')));
    if (!decoded || typeof decoded !== 'object') return null;
    const sessionId = typeof decoded.sessionId === 'string' ? decoded.sessionId : '';
    const meaningfulActivityAt = (decoded as { meaningfulActivityAt?: unknown }).meaningfulActivityAt;
    if (!sessionId || typeof meaningfulActivityAt !== 'number' || !Number.isFinite(meaningfulActivityAt) || meaningfulActivityAt < 0) {
      return null;
    }
    return { sessionId, meaningfulActivityAt: Math.trunc(meaningfulActivityAt) };
  } catch {
    return null;
  }
}
