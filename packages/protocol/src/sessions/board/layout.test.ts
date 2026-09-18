import { describe, expect, it } from 'vitest';
import { SessionBoardLayoutV1Schema } from './layout.js';

describe('Session Board layout', () => {
  const tab = { id: 'Overview', title: 'Overview', items: [{ itemId: 'Note', width: 'wide' }] };
  it('preserves semantic identity and permits an item in distinct views', () => {
    const layout = { v: 1, tabs: [tab, { ...tab, id: 'second' }] };
    expect(SessionBoardLayoutV1Schema.parse(layout)).toEqual(layout);
  });
  it('rejects duplicate views and placements, pixels and viewer-local state', () => {
    for (const layout of [
      { v: 1, tabs: [tab, tab] },
      { v: 1, tabs: [{ ...tab, items: [...tab.items, ...tab.items] }] },
      { v: 1, tabs: [{ ...tab, items: [{ itemId: 'Note', width: 400 }] }] },
      { v: 1, tabs: [tab], activeTab: 'Overview' },
    ]) expect(SessionBoardLayoutV1Schema.safeParse(layout).success).toBe(false);
  });
});
