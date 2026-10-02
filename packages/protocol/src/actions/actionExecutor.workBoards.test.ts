import { describe, expect, it } from 'vitest';

import { createActionExecutor, type ActionExecutorDeps } from './actionExecutor.js';
import { getActionSpec } from './actionSpecs.js';
import type { ActionId } from './actionIds.js';
import { buildWorkBoardItemKeyV1, WorkBoardsV1Schema, type BoardItemRefV1, type WorkBoardIntentV1 } from '../boards/workBoardV1.js';
import { normalizeSessionListFilterV1 } from '../sessions/listFilter/sessionListFilterV1.js';
import { createWorkBoardArtifactPortV1 } from '../boards/workBoardArtifactV1.js';
import { createWorkBoardArtifactBoundary } from '../boards/workBoardArtifactV1.testkit.js';

const ref = (serverId: string, id: string): BoardItemRefV1 => ({ kind: 'session', qualifiedId: { serverId, id } });

/** Artifact persistence is the system boundary; Board logic and Action admission stay real. */
function createBoundary(initial: unknown = null) {
  const rawBoards = initial && typeof initial === 'object' && 'boards' in initial && Array.isArray(initial.boards) ? initial.boards : [];
  const boundary = createWorkBoardArtifactBoundary(rawBoards);
  const workBoardArtifacts = createWorkBoardArtifactPortV1(boundary.transport);
  // This focused persistence harness supplies only ports the Board Action corridor can reach.
  const executor = createActionExecutor({ workBoardArtifacts } as unknown as ActionExecutorDeps);
  const execute = (id: string, input: unknown = {}) => executor.execute(id as ActionId, input, { surface: 'mcp', bypassApprovals: true });
  const apply = (intent: WorkBoardIntentV1) => execute('boards.apply', { intent });
  return { execute, apply, read: boundary.readCollection, workBoardArtifacts };
}

describe('Boards through the canonical Action executor', () => {
  it('round-trips every existing intent through individual Board Artifacts', async () => {
    const b = createBoundary();
    expect(await b.execute('boards.list')).toEqual({ ok: true, result: { boards: [] } });
    expect(await b.apply({ kind: 'create', board: { id: 'b1', name: 'Overview' } }))
      .toMatchObject({ ok: true, result: { boardId: 'b1', board: { id: 'b1', mode: 'canvas', source: { picked: [] } } } });
    expect(await b.apply({ kind: 'update', boardId: 'b1', patch: {
      name: 'Release', mode: 'by_status', snap: false, pinnedInSessions: true,
      source: { sections: ['needs_you', 'running'], filter: normalizeSessionListFilterV1(), picked: [ref('a', 's1')] },
    } })).toMatchObject({ ok: true, result: { board: { name: 'Release', mode: 'by_status', snap: false, pinnedInSessions: true } } });
    expect(await b.apply({ kind: 'add_items', boardId: 'b1', refs: [ref('a', 's1'), ref(' a ', 's1 '), ref('b', 's1')] }))
      .toMatchObject({ ok: true, result: { board: { source: { picked: [ref('a', 's1'), ref('b', 's1')] } } } });
    const key = buildWorkBoardItemKeyV1(ref('a', 's1'));
    expect(await b.execute('boards.apply', { intent: { kind: 'set_positions', boardId: 'b1', positionsByItemRef: { [key]: { x: 24.4, y: 48.6 } } } }))
      .toMatchObject({ ok: true, result: { board: { positionsByItemRef: { [key]: { x: 24, y: 49 } } } } });
    expect(await b.execute('boards.list')).toMatchObject({ ok: true, result: { boards: [{ id: 'b1', name: 'Release' }] } });
    expect(await b.apply({ kind: 'remove_item', boardId: 'b1', ref: ref('a', 's1') }))
      .toMatchObject({ ok: true, result: { board: { source: { picked: [ref('b', 's1')] } } } });
    expect(await b.apply({ kind: 'delete', boardId: 'b1' })).toEqual({ ok: true, result: { boardId: 'b1', board: null } });
    expect(b.read()).toEqual({ v: 1, boards: [] });
  });

  it('accepts Board membership beyond the unrelated Account settings collection quota', async () => {
    const b = createBoundary();
    await b.apply({ kind: 'create', board: { id: 'b1', name: 'Overview' } });
    expect(await b.apply({ kind: 'add_items', boardId: 'b1', refs: Array.from({ length: 300 }, (_, i) => ref('a', `s${i}`)) }))
      .toMatchObject({ ok: true });
    expect(WorkBoardsV1Schema.parse(b.read()).boards[0]?.source.picked).toHaveLength(300);
  });

  it.each([
    { kind: 'update', boardId: 'gone', patch: { name: 'New name' } },
    { kind: 'delete', boardId: 'gone' },
    { kind: 'add_items', boardId: 'gone', refs: [ref('a', 's')] },
    { kind: 'remove_item', boardId: 'gone', ref: ref('a', 's') },
    { kind: 'set_positions', boardId: 'gone', positionsByItemRef: {} },
  ] as const)('$kind returns a typed missing-board error without a write', async (intent) => {
    const b = createBoundary();
    expect(await b.execute('boards.apply', { intent })).toMatchObject({ ok: false, errorCode: 'board_not_found' });
    expect(b.read()).toBeNull();
  });

  it('preserves existing picks for a source-only update and refuses editing an unreadable Board', async () => {
    const b = createBoundary();
    await b.apply({ kind: 'create', board: { id: 'b1', name: 'Overview' } });
    await b.apply({ kind: 'add_items', boardId: 'b1', refs: [ref('a', 's1')] });
    await b.apply({ kind: 'update', boardId: 'b1', patch: { source: { sections: ['my_machines'] } } });
    expect(WorkBoardsV1Schema.parse(b.read()).boards[0]?.source.picked).toEqual([ref('a', 's1')]);
    const unreadable = { id: 'b1', broken: true };
    const malformed = createBoundary({ boards: [unreadable] });
    expect(await malformed.execute('boards.list')).toMatchObject({ ok: true, result: { boards: [] } });
    expect(await malformed.apply({ kind: 'update', boardId: 'b1', patch: { name: 'Overview' } }))
      .toMatchObject({ ok: false, errorCode: 'invalid_board_record' });
    expect(malformed.read()).toEqual({ v: 1, boards: [unreadable] });
  });

  it('keeps every existing position when an agent moves one item, even with stale membership', async () => {
    const b = createBoundary();
    await b.apply({ kind: 'create', board: { id: 'b1', name: 'Overview' } });
    const a = buildWorkBoardItemKeyV1(ref('a', 'section-only'));
    const other = buildWorkBoardItemKeyV1(ref('other-home', 'other'));
    await b.execute('boards.apply', { intent: { kind: 'set_positions', boardId: 'b1',
      positionsByItemRef: { [a]: { x: 1, y: 2 }, [other]: { x: 3, y: 4 } } } });
    expect(await b.execute('boards.apply', { intent: { kind: 'set_positions', boardId: 'b1',
      positionsByItemRef: { [a]: { x: 5, y: 6 } }, membership: { liveItemKeys: [], unavailableServerIds: [] } } }))
      .toMatchObject({ ok: true, result: { board: { positionsByItemRef: { [a]: { x: 5, y: 6 }, [other]: { x: 3, y: 4 } } } } });
  });

  it('rejects a conflicting outer target instead of writing another board', async () => {
    const b = createBoundary();
    expect(await b.execute('boards.apply', { boardId: 'other', intent: { kind: 'create', board: { id: 'b1', name: 'Overview' } } }))
      .toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
    expect(b.read()).toBeNull();
  });

  it('preserves opaque stored Boards and unknown source values without admitting them as mutation input', async () => {
    const unreadable = { id: 'future', name: 'Future', source: { picked: [] }, newField: true };
    const unknownPick = { kind: 'future-kind', qualifiedId: { serverId: 'a', id: 'future-item' } };
    const b = createBoundary({ v: 1, boards: [unreadable,
      { id: 'known', name: 'Known', source: { sections: ['needs_you', 'future-section'], picked: [unknownPick] } },
    ] });
    expect(await b.execute('boards.list')).toMatchObject({ ok: true, result: { boards: [{ id: 'known' }] } });
    expect(await b.apply({ kind: 'update', boardId: 'known', patch: { source: { sections: ['running'] } } })).toMatchObject({ ok: true });
    const stored = WorkBoardsV1Schema.parse(b.read());
    expect(stored.unreadable).toEqual([unreadable]);
    expect(stored.boards[0]?.source.unknown).toEqual({ sections: ['future-section'], picked: [unknownPick] });
    const before = b.read();
    expect(await b.execute('boards.apply', { intent: { kind: 'update', boardId: 'known', patch: { source: { unknown: { sections: ['future-section'] } } } } }))
      .toMatchObject({ ok: false, errorCode: 'invalid_parameters' });
    expect(b.read()).toEqual(before);
  });

  it('uses the no-membership remove fallback for agents rather than pruning on their stale projection', async () => {
    const b = createBoundary();
    const item = ref('a', 'live-item');
    const key = buildWorkBoardItemKeyV1(item);
    await b.apply({ kind: 'create', board: { id: 'b1', name: 'Overview' } });
    await b.apply({ kind: 'update', boardId: 'b1', patch: { source: { sections: ['needs_you'], picked: [item] } } });
    await b.apply({ kind: 'set_positions', boardId: 'b1', positionsByItemRef: { [key]: { x: 1, y: 2 } } });
    expect(await b.apply({ kind: 'remove_item', boardId: 'b1', ref: item, membership: { liveItemKeys: [], unavailableServerIds: [] } }))
      .toMatchObject({ ok: true, result: { board: { source: { picked: [] }, positionsByItemRef: { [key]: { x: 1, y: 2 } } } } });
  });

  it('publishes typed agent/MCP/CLI/plugin contracts and defaults mutation approval closed', async () => {
    for (const id of ['boards.list', 'boards.apply']) {
      const spec = getActionSpec(id as ActionId);
      expect(spec.surfaces).toMatchObject({ agent: true, mcp: true, cli: true, plugin: true });
      expect(spec.executionPlacement).toBe('account');
    }
    const b = createBoundary();
    // Unlike the round-trip cases, this uses the real unwired-policy default.
    const executor = createActionExecutor({ workBoardArtifacts: b.workBoardArtifacts } as unknown as ActionExecutorDeps);
    expect(await executor.execute('boards.apply' as ActionId, { intent: { kind: 'create', board: { id: 'b1', name: 'Overview' } } }, { surface: 'agent' }))
      .toMatchObject({ ok: false, errorCode: 'approvals_not_supported' });
    expect(b.read()).toBeNull();
  });
});
