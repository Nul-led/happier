import type { SessionFollowSourceMaterialResolver } from './sessionFollowSourceHydrator';

export type SessionFollowSourceMaterialController = SessionFollowSourceMaterialResolver & Readonly<{
  removeSource: (sourceSessionId: string) => void;
  retainSources: (sourceSessionIds: readonly string[]) => void;
  dispose: () => void;
}>;

/**
 * Process-local custody for source Session DEKs prepared by the Lane 06 owner.
 * It has no persistence, Account-key fallback, authorization decisions, or
 * Follow orchestration; the receiver removes entries when Lane 09 reports that
 * an edge is no longer current and disposes the whole controller at shutdown.
 */
export function createSessionFollowSourceMaterialResolver(): SessionFollowSourceMaterialController {
  const keys = new Map<string, Uint8Array>();
  let disposed = false;

  const removeSource = (sourceSessionId: string) => {
    const key = keys.get(sourceSessionId);
    key?.fill(0);
    keys.delete(sourceSessionId);
  };

  return {
    installPreparedDataKey: ({ sourceSessionId, dataKey }) => {
      if (disposed) throw new Error('session_follow_source_material_disposed');
      if (dataKey.byteLength !== 32) throw new Error('session_follow_source_data_key_invalid');
      removeSource(sourceSessionId);
      keys.set(sourceSessionId, dataKey.slice());
      return 'installed';
    },
    resolveForHydration: ({ sourceSessionId, signal }) => {
      signal.throwIfAborted();
      const key = keys.get(sourceSessionId);
      return key
        ? { mode: 'e2ee', dataKey: key.slice() }
        : { mode: 'unavailable' };
    },
    removeSource,
    retainSources: (sourceSessionIds) => {
      const retained = new Set(sourceSessionIds);
      for (const sourceSessionId of keys.keys()) {
        if (!retained.has(sourceSessionId)) removeSource(sourceSessionId);
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const key of keys.values()) key.fill(0);
      keys.clear();
    },
  };
}
