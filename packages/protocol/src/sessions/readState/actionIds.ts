import { z } from 'zod';

/**
 * The one user-invocable Session read-state intent (Lane 09B §5.3).
 *
 * Only an explicit human mark-read/mark-unread is this Action. Automatic
 * viewport synchronization stays an internal owner operation and deliberately
 * has no separate id: an automatic foreground read observation must not become
 * a tool that lets an Agent mark a human's messages read.
 *
 * This leaf carries only the id so the canonical Action id registry can import
 * it without pulling the read-state content schemas into that module graph.
 */
export const SESSION_READ_STATE_ACTION_IDS_V1 = [
  'session.read_state.set',
] as const;

export const SessionReadStateActionIdV1Schema = z.enum(SESSION_READ_STATE_ACTION_IDS_V1);
export type SessionReadStateActionIdV1 = z.infer<typeof SessionReadStateActionIdV1Schema>;

const SESSION_READ_STATE_ACTION_ID_SET: ReadonlySet<string> = new Set(SESSION_READ_STATE_ACTION_IDS_V1);

export function isSessionReadStateActionIdV1(value: string): value is SessionReadStateActionIdV1 {
  return SESSION_READ_STATE_ACTION_ID_SET.has(value);
}
