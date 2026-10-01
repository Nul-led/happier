import { parseSessionListQueryActionResultV1 } from '../../sessions/awareness/action.js';
import { SESSION_LIST_PAGE_MAX_LIMIT, type SessionListQueryV1 } from '../../sessions/listing/query.js';
import type { ActionExecutorContext, ActionExecutorDeps } from './types.js';

/** Reads server-proved membership; relation structure and ordinary access stay server-owned. */
export async function readActionCallerLedSubtreeSessionIds(
  deps: Pick<ActionExecutorDeps, 'sessionList'>,
  context: ActionExecutorContext,
): Promise<ReadonlySet<string> | null> {
  const root = context.defaultSessionId?.trim();
  if (!root || context.sessionListAccess === 'unavailable') return null;
  if (context.sessionListAccess === 'current_session') return new Set([root]);
  const ids = new Set<string>();
  for (const storage of ['active', 'archived'] as const) {
    let cursor: string | undefined;
    do {
      const query: SessionListQueryV1 = {
        v: 1, storage, includeInactive: true, scope: 'all_accessible', attention: 'any',
        audiences: [], tagIds: [], underSessionId: root, limit: SESSION_LIST_PAGE_MAX_LIMIT,
        ...(cursor ? { cursor } : {}),
      };
      let result: ReturnType<typeof parseSessionListQueryActionResultV1>;
      try {
        result = parseSessionListQueryActionResultV1(await deps.sessionList({
          context, query,
          ...(context.serverId !== undefined ? { serverId: context.serverId } : {}),
          ...(context.signal ? { signal: context.signal } : {}),
        }));
      } catch {
        return null;
      }
      if (!result) return null;
      for (const session of result.sessions) {
        const id: unknown = 'id' in session ? session.id : 'sessionId' in session ? session.sessionId : undefined;
        if (typeof id === 'string') ids.add(id);
      }
      if (!result.hasNext) break;
      if (!result.nextCursor || result.nextCursor === cursor) return null;
      cursor = result.nextCursor;
    } while (true);
  }
  return ids;
}
