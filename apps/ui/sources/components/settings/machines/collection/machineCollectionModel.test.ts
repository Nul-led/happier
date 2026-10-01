import { describe, expect, it } from 'vitest';

import type { Machine } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

import type { ActiveSelectionMachineGroup } from '../hooks/useActiveSelectionMachineGroups';
import {
    buildMachineCollection,
    machineCollectionHref,
    resolveMachineCollectionLandingHref,
    resolveSelectedMachineCollectionKey,
} from './machineCollectionModel';

function machine(id: string, overrides: Partial<Machine> & { displayName?: string; host?: string; platform?: string } = {}): Machine {
    const { displayName, host, platform, ...rest } = overrides;
    return {
        id,
        active: false,
        activeAt: 0,
        metadata: { displayName, host: host ?? `${id}.local`, platform: platform ?? 'linux' },
        ...rest,
    } as unknown as Machine;
}

function group(serverId: string, machines: Machine[], overrides: Partial<ActiveSelectionMachineGroup> = {}): ActiveSelectionMachineGroup {
    return { serverId, serverName: `Home ${serverId}`, machines, status: 'idle', ...overrides };
}

describe('buildMachineCollection', () => {
    it('lists one ungrouped section for a single Home, named and sorted by what the user sees', () => {
        const collection = buildMachineCollection({
            groups: [group('a', [machine('m2', { host: 'zeta.local' }), machine('m1', { displayName: 'Alpha', platform: 'darwin' })])],
            groupedByHome: false,
            nowMs: 0,
        });
        expect(collection.count).toBe(2);
        expect(collection.sections).toHaveLength(1);
        expect(collection.sections[0]?.title).toBeNull();
        expect(collection.sections[0]?.rows.map((row) => [row.title, row.platformLabel])).toEqual([
            ['Alpha', 'macOS'],
            ['zeta.local', 'Linux'],
        ]);
    });

    it('groups by Home only when several Homes are visible, keeping empty Homes with their status', () => {
        const collection = buildMachineCollection({
            groups: [group('a', [machine('m1')]), group('b', [], { status: 'signedOut' })],
            groupedByHome: true,
            nowMs: 0,
        });
        expect(collection.sections.map((section) => [section.title, section.rows.length, section.status])).toEqual([
            ['Home a', 1, 'idle'],
            ['Home b', 0, 'signedOut'],
        ]);
    });

    it('tells two machines with the same name apart in the list', () => {
        const collection = buildMachineCollection({
            groups: [group('s1', [
                machine('f98b860d-63e0', { displayName: 'lima-happier-fresh', host: 'lima-happier-fresh' }),
                machine('0c1d2e3f-9999', { displayName: 'lima-happier-fresh', host: 'lima-happier-fresh' }),
            ])],
            groupedByHome: false,
        });
        const titles = collection.sections[0]!.rows.map((row) => row.title);
        expect(new Set(titles).size).toBe(2);
    });

    it("reads each row's presence line from the shared presence owner", () => {
        const collection = buildMachineCollection({
            groups: [group('s1', [machine('m-1', { displayName: 'Studio', active: false, activeAt: 1 })])],
            groupedByHome: false,
        });
        expect(collection.sections[0]!.rows[0]!.presence).toMatch(/Offline/);
    });

    it('lists a machine whose details cannot be read as locked, never by its id', () => {
        const collection = buildMachineCollection({
            groups: [group('s1', [{ ...machine('f98b860d-63e0'), metadata: null } as unknown as Machine])],
            groupedByHome: false,
        });
        const row = collection.sections[0]!.rows[0]!;
        expect(row.title).toBe(t('machine.lockedMachine'));
        expect(row.title).not.toContain('f98b');
    });

    it('gives a locked machine the reason it cannot be read', () => {
        const collection = buildMachineCollection({
            groups: [group('s1', [{
                ...machine('f98b860d-63e0'),
                metadata: null,
                availability: { kind: 'locked', reason: 'encryption_material_unavailable' },
            } as unknown as Machine])],
            groupedByHome: false,
        });
        expect(collection.sections[0]!.rows[0]!.reason).toBe(t('machine.lockedReason.missingKey'));
    });

    it('filters by name or host when a query is typed', () => {
        const collection = buildMachineCollection({
            groups: [group('a', [machine('m1', { displayName: 'Build box', host: 'ci.internal' }), machine('m2', { host: 'laptop.local' })])],
            groupedByHome: false,
            query: 'CI',
            nowMs: 0,
        });
        expect(collection.sections[0]?.rows.map((row) => row.machineId)).toEqual(['m1']);
    });
});

describe('machine collection navigation', () => {
    const collection = buildMachineCollection({
        groups: [group('a', [machine('m1', { displayName: 'Alpha' }), machine('m2', { displayName: 'Beta' })])],
        groupedByHome: false,
        nowMs: 0,
    });

    it('opens a machine inside the collection, scoped to its Home', () => {
        expect(machineCollectionHref({ machineId: 'm 1', serverId: 'srv/a' })).toBe('/settings/machines/m%201?serverId=srv%2Fa');
    });

    it('lands on the last visited machine, then the first machine', () => {
        expect(resolveMachineCollectionLandingHref({ collection, lastVisited: { machineId: 'm2', serverId: 'a' }, isDesktop: false }))
            .toBe('/settings/machines/m2?serverId=a');
        expect(resolveMachineCollectionLandingHref({ collection, lastVisited: { machineId: 'gone', serverId: 'a' }, isDesktop: false }))
            .toBe('/settings/machines/m1?serverId=a');
    });

    it('lands on this computer on desktop, else on adding a machine, when there are no machines', () => {
        const empty = buildMachineCollection({ groups: [group('a', [])], groupedByHome: false, nowMs: 0 });
        expect(resolveMachineCollectionLandingHref({ collection: empty, lastVisited: null, isDesktop: true })).toBe('/settings/machines/this-computer');
        expect(resolveMachineCollectionLandingHref({ collection: empty, lastVisited: null, isDesktop: false })).toBe('/settings/machines/add');
    });

    it('selects the row the route names', () => {
        expect(resolveSelectedMachineCollectionKey('/settings/machines/m2', { serverId: 'a' })).toBe('machine:a:m2');
        expect(resolveSelectedMachineCollectionKey('/settings/machines/m2', {})).toBe('machine::m2');
        expect(resolveSelectedMachineCollectionKey('/settings/machines/this-computer', {})).toBe('thisComputer');
        expect(resolveSelectedMachineCollectionKey('/settings/machines/pools/p1', { serverId: 'a' })).toBe('pool:a:p1');
        expect(resolveSelectedMachineCollectionKey('/settings/machines/pools/new', { serverId: 'a' })).toBe('poolDraft:a');
        // The machine being added is the collection's draft row (lab M4).
        expect(resolveSelectedMachineCollectionKey('/settings/machines/add', {})).toBe('machineDraft');
        expect(resolveSelectedMachineCollectionKey('/settings/machines', {})).toBeNull();
    });
});
