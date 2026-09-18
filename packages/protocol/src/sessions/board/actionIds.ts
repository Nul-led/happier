import { z } from 'zod';

/**
 * The four user-invocable Board intents. People (UI/CLI) and supported Agents
 * reach the same durable Board through these ids; there is no Agent-specific
 * Board tool and no second Board vocabulary.
 *
 * This leaf carries only the ids so the canonical Action id registry can import
 * it without pulling the Board document schemas into that module graph.
 */
export const SESSION_BOARD_ACTION_IDS_V1 = [
  'session.board.get',
  'session.board.item.upsert',
  'session.board.item.remove',
  'session.board.layout.update',
] as const;

export const SessionBoardActionIdV1Schema = z.enum(SESSION_BOARD_ACTION_IDS_V1);
export type SessionBoardActionIdV1 = z.infer<typeof SessionBoardActionIdV1Schema>;

const SESSION_BOARD_ACTION_ID_SET: ReadonlySet<string> = new Set(SESSION_BOARD_ACTION_IDS_V1);

export function isSessionBoardActionIdV1(value: string): value is SessionBoardActionIdV1 {
  return SESSION_BOARD_ACTION_ID_SET.has(value);
}
