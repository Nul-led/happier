import { describe, expect, it } from 'vitest';

import { collectRetainedSessionInventoryVisibility } from './sessionInventoryVisibility';

describe('collectRetainedSessionInventoryVisibility', () => {
  it('keeps sessions visible in either active or archived inventory across pages', async () => {
    const visible = await collectRetainedSessionInventoryVisibility({
      retainedSessionIds: ['active', 'archived', 'gone'],
      scopes: ['active', 'archived'],
      fetchInventoryPage: async ({ scope, cursor }) => scope === 'active'
        ? { sessions: cursor ? [{ id: 'active' }] : [], hasNext: !cursor, nextCursor: cursor ? null : 'page-2' }
        : { sessions: [{ id: 'archived' }], hasNext: false, nextCursor: null },
    });

    expect([...visible].sort()).toEqual(['active', 'archived']);
  });

  it('rejects an incomplete page instead of authorizing removal of unseen sessions', async () => {
    await expect(collectRetainedSessionInventoryVisibility({
      retainedSessionIds: ['gone'],
      scopes: ['active', 'archived'],
      fetchInventoryPage: async () => ({ sessions: [], hasNext: true, nextCursor: null }),
    })).rejects.toThrow('session_inventory_incomplete');
  });

  it('rejects a repeated cursor and preserves the fetch failure', async () => {
    await expect(collectRetainedSessionInventoryVisibility({
      retainedSessionIds: ['gone'],
      scopes: ['active'],
      fetchInventoryPage: async () => ({ sessions: [], hasNext: true, nextCursor: 'repeat' }),
    })).rejects.toThrow('session_inventory_cursor_stalled');
    await expect(collectRetainedSessionInventoryVisibility({
      retainedSessionIds: ['gone'],
      scopes: ['active'],
      fetchInventoryPage: async () => { throw new Error('network_unavailable'); },
    })).rejects.toThrow('network_unavailable');
  });
});
