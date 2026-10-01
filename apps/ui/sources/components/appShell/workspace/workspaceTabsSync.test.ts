import { describe, expect, it } from 'vitest';
import { createWorkspaceTabsSync } from './workspaceTabsSync';
import { emptyWorkspaceTabs, type SharedWorkspaceTabs } from './workspaceSyncedTabs';
import { normalizeWorkspaceSingletonTabs } from './workspaceDestinationPolicy';
import type { CompactAppDestination } from '../destinations/compactAppDestinationCatalog';

const tab = (id: string) => ({ id, target: { kind: 'settings', params: { pageId: id } }, pinned: false });
const record = (...ids: string[]) => ({ v: 1 as const, tabsById: Object.fromEntries(ids.map(id => [id, tab(id)])), order: ids, pairs: [] });
const singletonKind = 'plugin:acme.notes:notes';
const singletonCatalog = [{ id: singletonKind, kind: 'plugin', container: 'appPage', destination: { pluginId: 'acme.notes', localId: 'notes' },
    title: 'Notes', icon: 'document-text-outline', order: 40, placement: { kind: 'rail', region: 'plugins' },
    activation: 'navigate', availability: 'available', routePath: '/plugins/acme.notes/notes',
}] satisfies readonly CompactAppDestination[];

describe('workspace KV synchronization', () => {
    it('rebases concurrent app-page opens to one catalog-owned identity while keeping the latest reopen target', async () => {
        const kind = singletonKind;
        const catalog = singletonCatalog;
        const remote = { ...tab('remote'), target: { kind, params: { subPath: 'first' } } };
        const local = { ...tab('local'), target: { kind, params: { subPath: 'second' } }, pinned: true };
        const opaque1 = { ...tab('opaque1'), target: { kind: 'unknown', params: { opaque: 'kept' } } };
        const opaque2 = { ...opaque1, id: 'opaque2' };
        let stored: SharedWorkspaceTabs = { v: 1, tabsById: { remote, opaque1, opaque2 }, order: ['remote', 'opaque1', 'opaque2'], pairs: [] };
        let conflict = true;
        const controller = createWorkspaceTabsSync({ transport: {
            read: async () => ({ value: emptyWorkspaceTabs(), version: 0 }),
            compareAndSet: async value => {
                if (conflict) { conflict = false; return { success: false as const, value: stored, version: 1 }; }
                stored = value;
                return { success: true as const, version: 2 };
            },
        }, onRecord: () => {}, normalizeRecord: value => normalizeWorkspaceSingletonTabs(value, catalog) });
        await controller.refresh();
        controller.enqueue([{ type: 'open', tab: local }, { type: 'pairs', pairs: [['local', 'opaque1']] }]);
        await controller.flush();
        expect(stored.order).toEqual(['remote', 'opaque1', 'opaque2']);
        expect(stored.tabsById.remote).toMatchObject({ id: 'remote', target: local.target, pinned: true });
        expect(stored.pairs).toEqual([['remote', 'opaque1']]);
        expect(controller.getSnapshot().record).toEqual(stored);
        controller.stop();
    });
    it('retains a close accepted during an in-flight singleton identity merge', async () => {
        const remote = { ...tab('remote'), target: { kind: singletonKind, params: {} } };
        const local = { ...tab('local'), target: remote.target };
        let stored: SharedWorkspaceTabs = { v: 1, tabsById: { remote }, order: ['remote'], pairs: [] };
        let conflicts = true;
        let closePending = true;
        const controller = createWorkspaceTabsSync({ transport: {
            read: async () => ({ value: emptyWorkspaceTabs(), version: 0 }),
            compareAndSet: async value => {
                if (conflicts) { conflicts = false; return { success: false as const, value: stored, version: 1 }; }
                if (closePending) {
                    closePending = false;
                    controller.enqueue([{ type: 'close', tabId: 'local' }]);
                    expect(controller.getSnapshot().record?.order).toEqual([]);
                }
                stored = value;
                return { success: true as const, version: 2 };
            },
        }, onRecord: () => {}, normalizeRecord: value => normalizeWorkspaceSingletonTabs(value, singletonCatalog) });
        await controller.refresh();
        controller.enqueue([{ type: 'open', tab: local }]);
        await controller.flush();
        expect(stored.order).toEqual([]);
        controller.stop();
    });
    it.each([false, true])('preserves original operation identities when a proposed singleton winner is closed before CAS commits: close=%s', async closeDuringWrite => {
        const remote = { ...tab('remote'), target: { kind: singletonKind, params: { subPath: 'old' } } };
        const local = { ...tab('local'), target: { kind: singletonKind, params: { subPath: 'new' } } };
        let stored: SharedWorkspaceTabs = { v: 1, tabsById: { remote }, order: ['remote'], pairs: [] };
        let conflicts = true;
        const controller = createWorkspaceTabsSync({ transport: {
            read: async () => ({ value: stored, version: 0 }),
            compareAndSet: async value => {
                if (conflicts) {
                    conflicts = false;
                    if (closeDuringWrite) controller.enqueue([{ type: 'close', tabId: 'local' }]);
                    stored = emptyWorkspaceTabs();
                    return { success: false as const, value: stored, version: 1 };
                }
                stored = value;
                return { success: true as const, version: 2 };
            },
        }, onRecord: () => {}, normalizeRecord: value => normalizeWorkspaceSingletonTabs(value, singletonCatalog) });
        await controller.refresh();
        controller.enqueue([{ type: 'open', tab: local }]);
        await controller.flush();
        expect(stored.order).toEqual(closeDuringWrite ? [] : ['local']);
        if (!closeDuringWrite) expect(stored.tabsById.local.target).toEqual(local.target);
        controller.stop();
    });
    it('applies a newly declared singleton policy to cached tabs even when its subsequent KV reread fails', async () => {
        let catalog: readonly CompactAppDestination[] = [];
        let unavailable = false;
        const first = { ...tab('first'), target: { kind: singletonKind, params: { subPath: 'first' } } };
        const second = { ...tab('second'), target: { kind: singletonKind, params: { subPath: 'last' } } };
        const third = { ...second, id: 'third' };
        const opaque = { ...tab('opaque'), target: { kind: 'unknown', params: {} } };
        const stored: SharedWorkspaceTabs = { v: 1, tabsById: { first, second, third, opaque }, order: ['first', 'second', 'third', 'opaque'],
            pairs: [['first', 'second'], ['third', 'opaque']] };
        const projections: SharedWorkspaceTabs[] = [];
        const controller = createWorkspaceTabsSync({ transport: {
            read: async () => { if (unavailable) throw new Error('KV is unavailable'); return { value: stored, version: 0 }; },
            compareAndSet: async () => { throw new Error('Catalog refresh must not publish'); },
        }, onRecord: value => projections.push(value), normalizeRecord: value => normalizeWorkspaceSingletonTabs(value, catalog) });
        await controller.refresh();
        expect(projections.at(-1)?.order).toEqual(stored.order);
        catalog = singletonCatalog;
        unavailable = true;
        await expect(controller.refresh()).rejects.toThrow('KV is unavailable');
        expect(projections.at(-1)?.order).toEqual(['first', 'opaque']);
        expect(projections.at(-1)?.tabsById.first.target).toEqual(second.target);
        expect(projections.at(-1)?.pairs).toEqual([['first', 'opaque']]);
        controller.stop();
    });
    it('distinguishes a tombstone from stored JSON null and does not resurrect creation-only enrollment', async () => {
        const publications: string[][] = [];
        let deleted = true;
        const controller = createWorkspaceTabsSync({
            transport: {
                read: async () => ({ value: null, version: -1 }),
                compareAndSet: async (value, version) => {
                    if (deleted) { deleted = false; return { success: false as const, value: null, version: 4, tombstone: true as const }; }
                    expect(version).toBe(4);
                    publications.push([...value.order]);
                    return { success: true as const, version: 5 };
                },
            }, enroll: () => [{ type: 'open', tab: tab('saved') }], onRecord: () => {},
        });
        controller.enqueue([{ type: 'open', tab: tab('intentional') }]);
        await controller.flush();
        expect(publications).toEqual([['intentional']]);
        controller.stop();
        const invalid = createWorkspaceTabsSync({ transport: {
            read: async () => ({ value: null, version: 4 }),
            compareAndSet: async () => { throw new Error('Stored null is not a tombstone'); },
        }, onRecord: () => {} });
        await expect(invalid.refresh()).rejects.toMatchObject({ code: 'workspace_tabs_schema_invalid' });
        invalid.stop();
    });
    it('rebases on a CAS winner, keeps concurrent edits during an in-flight write and never writes on read', async () => {
        let stored: SharedWorkspaceTabs = record('a');
        let version = 0;
        let conflicts = true;
        const publications: string[][] = [];
        const controller = createWorkspaceTabsSync({
            transport: {
                read: async () => ({ value: stored, version }),
                compareAndSet: async (value, expected) => {
                    if (conflicts) {
                        conflicts = false;
                        stored = record('a', 'remote'); version++;
                        controller.enqueue([{ type: 'open', tab: tab('second') }]);
                        return { success: false as const, value: stored, version };
                    }
                    expect(expected).toBe(version);
                    stored = value; version++;
                    publications.push([...stored.order]);
                    return { success: true as const, version };
                },
            },
            onRecord: () => {},
        });
        await controller.refresh();
        expect(publications).toEqual([]);
        controller.enqueue([{ type: 'open', tab: tab('local') }]);
        await controller.flush();
        expect(stored.order).toEqual(['a', 'remote', 'local', 'second']);
        expect(controller.getSnapshot().status).toBe('synced');
        controller.stop();
    });

    it('does not resurrect remote closures, refuses malformed records, and retires scope before applying responses', async () => {
        let current = true;
        const controller = createWorkspaceTabsSync({
            transport: {
                read: async () => ({ value: record(), version: 2 }),
                compareAndSet: async () => ({ success: false as const, value: record(), version: 3 }),
            },
            onRecord: () => {}, shouldContinue: () => current,
        });
        await controller.refresh();
        controller.enqueue([{ type: 'patch', tabId: 'closed', pinned: true }]);
        await controller.flush();
        expect(controller.getSnapshot().record).toEqual(emptyWorkspaceTabs());
        current = false;
        controller.enqueue([{ type: 'open', tab: tab('late') }]);
        await controller.refresh();
        expect(controller.getSnapshot().record?.order).toEqual([]);
        controller.stop();

        const malformed = createWorkspaceTabsSync({ transport: {
            read: async () => ({ value: { v: 1, tabsById: {}, order: ['missing'], pairs: [] }, version: 1 }),
            compareAndSet: async () => { throw new Error('Must not overwrite malformed stored evidence'); },
        }, onRecord: () => {} });
        await expect(malformed.refresh()).rejects.toMatchObject({ code: 'workspace_tabs_schema_invalid' });
        malformed.stop();
    });
});
