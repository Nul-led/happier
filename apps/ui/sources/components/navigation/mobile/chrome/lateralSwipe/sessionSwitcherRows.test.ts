import { describe, expect, it } from 'vitest';

import { readSessionSwitcherRows } from './sessionSwitcherRows';

describe('switcher rows for open tabs that are not sessions', () => {
    const read = (context: string | null, unavailable: boolean) => readSessionSwitcherRows({
        entries: [{ key: 'tab:t1', section: 'openTabs', sessionKey: null, tabId: 't1' }],
        state: {},
        addressByKey: new Map(),
        tabsById: new Map([['t1', { tabId: 't1', title: 'Appearance', icon: 'palette', unavailable, session: null, context }]]),
        draftScope: null,
        nowMs: 0,
    });

    it('gives the tab its one line from its owner, so a card or row is never just a name', () => {
        expect(read('Settings', false)[0]?.status).toEqual({ text: 'Settings', tone: 'quiet' });
        expect(read('Not available on this phone', true)[0]?.status).toEqual({ text: 'Not available on this phone', tone: 'offline' });
        expect(read(null, false)[0]?.status).toBeNull();
    });
});
