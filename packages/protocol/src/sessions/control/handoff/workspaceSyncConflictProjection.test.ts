import { describe, expect, it } from 'vitest';

import { projectWorkspaceSyncConflictPages } from './workspaceSyncConflictProjection.js';

const fileConflict = (relationshipId: string, path: string) => ({
  relationshipId,
  path,
  alpha: { kind: 'file' as const, digest: 'a'.repeat(40) },
  beta: { kind: 'file' as const, digest: 'b'.repeat(40) },
});

const page = (relationshipId: string, paths: readonly string[]) => ({
  status: 'page' as const,
  relationshipId,
  totalCount: paths.length,
  nextCursor: null,
  conflicts: paths.map((path) => fileConflict(relationshipId, path)),
});

describe('projectWorkspaceSyncConflictPages', () => {
  it('shows a conflicted link beside a clean spoke without claiming a global total', () => {
    const projection = projectWorkspaceSyncConflictPages({
      relationships: [
        { relationshipId: 'rel-ab', controllerMachineId: 'machine-a' },
        { relationshipId: 'rel-ac', controllerMachineId: 'machine-a' },
      ],
      pages: [
        { relationshipId: 'rel-ab', page: page('rel-ab', ['src/index.ts']) },
        { relationshipId: 'rel-ac', page: page('rel-ac', []) },
      ],
    });
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]).toMatchObject({
      path: 'src/index.ts',
      entries: [{ relationshipId: 'rel-ab' }],
    });
    expect(projection.coverage.complete).toBe(true);
    expect(projection.coverage.unknownRelationshipIds).toEqual([]);
    // The clean spoke is an explicit empty link, not an absent one.
    expect(projection.coverage.emptyRelationshipIds).toEqual(['rel-ac']);
    expect(projection.coverage.shownPathCount).toBe(1);
  });

  it('groups one path seen on two links into a single row with both entries', () => {
    const projection = projectWorkspaceSyncConflictPages({
      relationships: [
        { relationshipId: 'rel-ab', controllerMachineId: 'machine-a' },
        { relationshipId: 'rel-ac', controllerMachineId: 'machine-a' },
      ],
      pages: [
        { relationshipId: 'rel-ab', page: page('rel-ab', ['src/index.ts']) },
        { relationshipId: 'rel-ac', page: page('rel-ac', ['src/index.ts']) },
      ],
    });
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]?.entries.map((entry) => entry.relationshipId).sort()).toEqual([
      'rel-ab',
      'rel-ac',
    ]);
    // Pairwise entries are preserved per link; they are not summed as unique files.
    expect(projection.coverage.shownPathCount).toBe(1);
    expect(projection.coverage.complete).toBe(true);
  });

  it('keeps loaded rows when another link invalidates its cursor', () => {
    const projection = projectWorkspaceSyncConflictPages({
      relationships: [
        { relationshipId: 'rel-ab', controllerMachineId: 'machine-a' },
        { relationshipId: 'rel-ac', controllerMachineId: 'machine-a' },
      ],
      pages: [
        { relationshipId: 'rel-ab', page: page('rel-ab', ['src/index.ts']) },
        {
          relationshipId: 'rel-ac',
          page: { status: 'cursor_invalidated' as const, relationshipId: 'rel-ac' },
        },
      ],
    });
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]).toMatchObject({ path: 'src/index.ts' });
    expect(projection.coverage.complete).toBe(false);
    expect(projection.coverage.unknownRelationshipIds).toEqual(['rel-ac']);
    expect(projection.rows[0]?.coverage.complete).toBe(false);
  });

  it('marks partial pages and unloaded links as unknown coverage, never as zero', () => {
    const partial = {
      ...page('rel-ab', ['src/index.ts']),
      totalCount: 5,
      nextCursor: 'cursor-2',
    };
    const projection = projectWorkspaceSyncConflictPages({
      relationships: [
        { relationshipId: 'rel-ab', controllerMachineId: 'machine-a' },
        { relationshipId: 'rel-ac', controllerMachineId: 'machine-a' },
      ],
      pages: [{ relationshipId: 'rel-ab', page: partial }],
    });
    expect(projection.rows).toHaveLength(1);
    expect(projection.coverage.complete).toBe(false);
    expect(projection.coverage.unknownRelationshipIds).toEqual(['rel-ac']);
    // A partial page keeps its loaded rows but stays explicitly partial.
    expect(projection.coverage.partialRelationshipIds).toEqual(['rel-ab']);
    // A partial page never authorizes a complete unique total.
    expect('totalUniqueFileCount' in projection.coverage).toBe(false);
  });
});
