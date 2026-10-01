import { describe, expect, it } from 'vitest';
import { WorkspaceTabsV1Schema } from './workspaceTabsV1.js';

const tab = (id: string) => ({ id, target: { kind: 'plugin:removed:page', params: { subPath: 'item', serverId: 'home-a' } }, pinned: false });
const valid = () => ({ v: 1, tabsById: { a: tab('a'), b: tab('b'), c: tab('c') }, order: ['b', 'a', 'c'], pairs: [['a', 'b']] });

describe('portable workspace tabs V1', () => {
    it('retains unknown destinations and portable split membership while accepting an empty tab set', () => {
        expect(WorkspaceTabsV1Schema.parse(valid())).toEqual(valid());
        expect(WorkspaceTabsV1Schema.parse({ v: 1, tabsById: {}, order: [], pairs: [] })).toEqual({ v: 1, tabsById: {}, order: [], pairs: [] });
    });

    it('rejects mismatched identities, incomplete or duplicated order, and overlapping split members', () => {
        for (const value of [
            { ...valid(), tabsById: { ...valid().tabsById, a: tab('other') } },
            { ...valid(), order: ['a', 'b'] },
            { ...valid(), order: ['a', 'a', 'c'] },
            { ...valid(), order: ['a', 'b', 'missing'] },
            { ...valid(), pairs: [['a']] },
            { ...valid(), pairs: [['a', 'a']] },
            { ...valid(), pairs: [['a', 'missing']] },
            { ...valid(), pairs: [['a', 'b'], ['b', 'c']] },
        ]) expect(WorkspaceTabsV1Schema.safeParse(value).success).toBe(false);
    });

    it('rejects device-local state and unknown fields at every envelope boundary', () => {
        for (const value of [
            { ...valid(), activeTabId: 'a' },
            { ...valid(), tabsById: { ...valid().tabsById, a: { ...tab('a'), preview: true } } },
            { ...valid(), tabsById: { ...valid().tabsById, a: { ...tab('a'), target: { ...tab('a').target, groupId: 'group:1' } } } },
        ]) expect(WorkspaceTabsV1Schema.safeParse(value).success).toBe(false);
    });
});
