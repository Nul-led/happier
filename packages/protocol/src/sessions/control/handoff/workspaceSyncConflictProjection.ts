import type {
  WorkspaceSyncConflictPageV1,
  WorkspaceSyncConflictV1,
} from './workspaceSyncSchemas.js';

export type WorkspaceSyncConflictProjectionRelationship = Readonly<{
  relationshipId: string;
  controllerMachineId: string;
}>;

export type WorkspaceSyncConflictProjectionPage = Readonly<{
  relationshipId: string;
  page: WorkspaceSyncConflictPageV1;
}>;

export type WorkspaceSyncConflictProjectionRow = Readonly<{
  path: string;
  entries: readonly WorkspaceSyncConflictV1[];
  coverage: Readonly<{ complete: boolean }>;
}>;

export type WorkspaceSyncConflictProjection = Readonly<{
  rows: readonly WorkspaceSyncConflictProjectionRow[];
  coverage: Readonly<{
    complete: boolean;
    unknownRelationshipIds: readonly string[];
    partialRelationshipIds: readonly string[];
    emptyRelationshipIds: readonly string[];
    shownPathCount: number;
  }>;
}>;

/**
 * Pure grouping of loaded pairwise conflict pages by set path. The caller
 * supplies the in-scope membership explicitly (for example the filtered
 * relationships.list result); this owner derives no topology graph, opens no
 * cursor and reads no endpoint. Incomplete pages never become “no conflicts”
 * and pairwise entries are never summed as unique files.
 */
export function projectWorkspaceSyncConflictPages(input: Readonly<{
  relationships: readonly WorkspaceSyncConflictProjectionRelationship[];
  pages: readonly WorkspaceSyncConflictProjectionPage[];
}>): WorkspaceSyncConflictProjection {
  const pagesByRelationship = new Map(input.pages.map((entry) => [entry.relationshipId, entry.page]));
  const unknownRelationshipIds: string[] = [];
  const partialRelationshipIds: string[] = [];
  const emptyRelationshipIds: string[] = [];
  const rowsByPath = new Map<string, WorkspaceSyncConflictV1[]>();

  for (const relationship of input.relationships) {
    const loaded = pagesByRelationship.get(relationship.relationshipId);
    if (!loaded || loaded.status === 'cursor_invalidated') {
      unknownRelationshipIds.push(relationship.relationshipId);
      continue;
    }
    if (loaded.conflicts.length === 0 && loaded.nextCursor === null) {
      emptyRelationshipIds.push(relationship.relationshipId);
    }
    if (loaded.nextCursor !== null) {
      partialRelationshipIds.push(relationship.relationshipId);
    }
    for (const conflict of loaded.conflicts) {
      const row = rowsByPath.get(conflict.path);
      if (row) row.push(conflict);
      else rowsByPath.set(conflict.path, [conflict]);
    }
  }

  const complete = unknownRelationshipIds.length === 0 && partialRelationshipIds.length === 0;
  const rows = [...rowsByPath.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([path, entries]) => ({
      path,
      entries: Object.freeze([...entries]) as readonly WorkspaceSyncConflictV1[],
      coverage: { complete },
    }));
  return {
    rows: Object.freeze(rows),
    coverage: {
      complete,
      unknownRelationshipIds: Object.freeze([...unknownRelationshipIds]),
      partialRelationshipIds: Object.freeze([...partialRelationshipIds]),
      emptyRelationshipIds: Object.freeze([...emptyRelationshipIds]),
      shownPathCount: rows.length,
    },
  };
}
