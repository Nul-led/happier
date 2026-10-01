import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    buildSessionListReachabilitySummary,
    createSessionListReachabilitySummaryCache,
} from './buildSessionListReachabilitySummary';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import { storage } from '@/sync/domains/state/storage';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import { setActiveServerId, upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import { projectManager } from '@/sync/runtime/orchestration/projectManager';
import { getSessionAvatarId, getSessionName, getSessionSubtitle } from '@/utils/sessions/sessionUtils';
import { buildSessionListViewData } from '@/sync/domains/session/listing/sessionListViewData';
import { buildSessionListIndexWithServerScope } from '@/sync/store/sessionListIndex/buildSessionListIndexWithServerScope';
import { t } from '@/text';

describe('buildSessionListReachabilitySummary', () => {
    let previousState: ReturnType<typeof storage.getState>;
    beforeEach(() => {
        previousState = storage.getState();
        storage.setState({ sessions: {}, machines: {}, machineListByServerId: {}, sessionListRowsByServerId: {}, ordinarySessionListMembershipByServerId: {} });
        projectManager.clear();
    });
    afterEach(() => {
        storage.setState(previousState, true);
        projectManager.clear();
    });

    it('keeps a foreign Home workspace instead of the hydrated same-ID Session project', async () => {
        const homeA = await upsertServerProfile({ serverUrl: 'https://workspace-a.example.test', name: 'A' });
        const homeB = await upsertServerProfile({ serverUrl: 'https://workspace-b.example.test', name: 'B' });
        await setActiveServerId(homeA.id, { scope: 'device' });
        const sessionA = createSessionFixture({ id: 'same-session', serverId: homeA.id,
            metadata: { machineId: 'machine-a', path: '/repo-a', host: 'a.local' } });
        const sessionB = createSessionFixture({ id: 'same-session', serverId: homeB.id,
            metadata: { machineId: 'machine-b', path: '/repo-b', host: 'b.local' } });
        const rowA = buildSessionListRenderableFromSession(sessionA);
        const rowB = buildSessionListRenderableFromSession(sessionB);
        const machineA = createMachineFixture({ id: 'machine-a', active: true });
        const machineB = createMachineFixture({ id: 'machine-b' });
        storage.setState({
            sessions: { [sessionA.id]: sessionA },
            machines: { [machineA.id]: machineA },
            machineListByServerId: { [homeB.id]: [machineB] },
            sessionListRowsByServerId: { [homeA.id]: { [sessionA.id]: rowA }, [homeB.id]: { [sessionB.id]: rowB } },
            ordinarySessionListMembershipByServerId: { [homeA.id]: [sessionA.id], [homeB.id]: [sessionB.id] },
        });
        // Real store/project ownership: the bare accessor materializes A's project.
        expect(storage.getState().getProjectForSession(sessionA.id)?.key.rootPath).toBe('/repo-a');
        const address = { serverId: homeB.id, sessionId: sessionB.id };
        const summary = buildSessionListReachabilitySummary({
            listItems: [{ type: 'session', ...address }],
            machinesById: new Map([[machineB.id, machineB]]),
            workspaceRefs: [],
            resolveSessionRenderable: () => rowB,
        });
        expect(summary.displayByKey.get(sessionAddressKey(address))).toMatchObject({
            machineId: 'machine-b', workspaceSubtitle: 'repo-b',
        });
        expect.soft(getSessionSubtitle(sessionB)).toBe('/repo-b');
        expect.soft(getSessionName(rowB, homeB.id)).toBe('repo-b');
        expect.soft(getSessionAvatarId(rowB, homeB.id)).toBe('machine-b:/repo-b');
        expect.soft(getSessionSubtitle(rowB, homeB.id)).toBe('/repo-b');
        expect.soft(getSessionSubtitle(createSessionFixture({
            ...sessionB,
            metadataLayoutVersion: 1,
            metadata: { machineId: 'machine-b', path: '/shared-b', host: 'b.local' },
            ownerMetadataView: { ...sessionB.metadata!, path: '/private-b' },
        }))).toBe('/private-b');
        expect.soft(getSessionSubtitle(createSessionFixture({
            ...sessionB, metadataLayoutVersion: 1, ownerMetadataView: null,
        }))).toBe(t('status.unknown'));
        const groupedRows = buildSessionListViewData({ [sessionB.id]: rowB }, { [machineB.id]: machineB }, {
            activeGroupingV1: 'project', inactiveGroupingV1: 'project',
            serverScope: { serverId: homeB.id }, sessionTargetState: storage.getState(),
        });
        expect.soft(groupedRows.find((item) => item.type === 'header' && item.headerKind === 'project'))
            .toMatchObject({ title: '/repo-b' });
        const index = buildSessionListIndexWithServerScope({
            sessions: { [sessionB.id]: rowB }, sessionRecords: storage.getState().sessions,
            machines: { [machineB.id]: machineB }, machineRecords: { [machineB.id]: machineB },
            getProjectForSession: storage.getState().getProjectForSession,
            activeGroupingV1: 'project', inactiveGroupingV1: 'project', serverScope: { serverId: homeB.id },
        });
        expect.soft(index.find((item) => item.type === 'header' && item.headerKind === 'project'))
            .toMatchObject({ title: '/repo-b' });
    });

    it('reuses a shared empty summary when there are no session rows', () => {
        const first = buildSessionListReachabilitySummary({
            listItems: [],
            machinesById: new Map(),
            workspaceRefs: [],
            resolveSessionRenderable: () => null,
        });
        const second = buildSessionListReachabilitySummary({
            listItems: [
                {
                    type: 'header',
                    title: 'Today',
                    headerKind: 'date',
                    groupKey: 'server:server-a:day:2026-02-19',
                },
            ] as any,
            machinesById: new Map(),
            workspaceRefs: [],
            resolveSessionRenderable: () => null,
        });

        expect(first).toBe(second);
        expect(first.displayById).toBe(second.displayById);
        expect(first.displayById.size).toBe(0);
        expect(first.hasMultipleMachines).toBe(false);
    });

    it('reuses the same non-empty summary for identical inputs', () => {
        const sessionRenderablesById = {
            'sess-a': {
                metadata: {
                    machineId: 'machine-a',
                    host: 'machine-a.local',
                    path: '/repo-a',
                    homeDir: '/home/user',
                },
            },
            'sess-b': {
                metadata: {
                    machineId: 'machine-b',
                    host: 'machine-b.local',
                    path: '/repo-b',
                    homeDir: '/home/user',
                },
            },
        } as any;
        const input = {
            cache: createSessionListReachabilitySummaryCache(),
            listItems: [
                {
                    type: 'session',
                    sessionId: 'sess-a',
                },
                {
                    type: 'session',
                    sessionId: 'sess-b',
                },
            ] as any,
            machinesById: new Map([
                ['machine-a', { id: 'machine-a', metadata: { host: 'machine-a.local' } }],
                ['machine-b', { id: 'machine-b', metadata: { host: 'machine-b.local' } }],
            ]),
            workspaceRefs: [],
            resolveSessionRenderable: (item: any) => sessionRenderablesById[item.sessionId] ?? null,
        } as const;

        const first = buildSessionListReachabilitySummary(input);
        const second = buildSessionListReachabilitySummary(input);

        expect(first).toBe(second);
        expect(first.hasMultipleMachines).toBe(true);
        expect(first.displayById.get('sess-a')).toEqual({
            machineId: 'machine-a',
            machineLabel: 'machine-a.local',
            workspaceSubtitle: 'repo-a',
            workspaceSubtitleEllipsizeMode: 'tail',
        });
    });

    it('reuses cached display rows when unrelated session rows refresh', () => {
        const renderablesById = {
            'sess-unchanged': {
                metadata: {
                    machineId: 'machine-a',
                    host: 'machine-a.local',
                    path: '/repo-unchanged',
                    homeDir: '/home/user',
                },
            },
            'sess-refreshed': {
                metadata: {
                    machineId: 'machine-a',
                    host: 'machine-a.local',
                    path: '/repo-refreshed',
                    homeDir: '/home/user',
                },
            },
        } as any;
        const machinesById = new Map([
            ['machine-a', { id: 'machine-a', metadata: { host: 'machine-a.local' } }],
        ]);
        const listItems = [
            {
                type: 'session',
                sessionId: 'sess-unchanged',
                serverId: 'server-a',
            },
            {
                type: 'session',
                sessionId: 'sess-refreshed',
                serverId: 'server-a',
            },
        ] as any;
        const workspaceRefs: ReadonlyArray<never> = [];
        const cache = createSessionListReachabilitySummaryCache();
        const first = buildSessionListReachabilitySummary({
            cache,
            listItems,
            machinesById,
            workspaceRefs,
            resolveSessionRenderable: (item: any) => renderablesById[item.sessionId] ?? null,
        });
        const unchangedKey = sessionAddressKey({ serverId: 'server-a', sessionId: 'sess-unchanged' });
        const refreshedKey = sessionAddressKey({ serverId: 'server-a', sessionId: 'sess-refreshed' });
        const unchangedDisplay = first.displayByKey.get(unchangedKey);
        const second = buildSessionListReachabilitySummary({
            cache,
            listItems,
            machinesById,
            workspaceRefs,
            resolveSessionRenderable: (item: any) => item.sessionId === 'sess-refreshed'
                ? { ...renderablesById['sess-refreshed'], presence: 1 }
                : renderablesById[item.sessionId] ?? null,
        });

        expect(second).not.toBe(first);
        expect(second.displayByKey.get(unchangedKey)).toBe(unchangedDisplay);
        expect(second.displayByKey.get(refreshedKey)).toMatchObject({
            machineId: 'machine-a',
            workspaceSubtitle: 'repo-refreshed',
        });
    });

    it('keeps delimiter-bearing qualified Session addresses distinct in cache and display maps', () => {
        const addresses = [
            { serverId: 'https://home.example/a', sessionId: 'b:c' },
            { serverId: 'https://home.example/a:b', sessionId: 'c' },
        ] as const;
        const renderables = new Map(addresses.map((address, index) => [
            sessionAddressKey(address),
            { metadata: { host: `machine-${index}.local`, path: `/repo-${index}` } },
        ]));
        const summary = buildSessionListReachabilitySummary({
            listItems: addresses.map((address) => ({ type: 'session' as const, ...address })),
            machinesById: new Map(),
            workspaceRefs: [],
            resolveSessionRenderable: (item) => renderables.get(sessionAddressKey({
                serverId: item.serverId!,
                sessionId: item.sessionId,
            })) as any,
        });

        expect(summary.displayByKey.size).toBe(2);
        expect(summary.displayByKey.get(sessionAddressKey(addresses[0]))?.workspaceSubtitle).toBe('repo-0');
        expect(summary.displayByKey.get(sessionAddressKey(addresses[1]))?.workspaceSubtitle).toBe('repo-1');
    });

    it('preserves path subtitles even when no machine metadata is available', () => {
        const sessionRenderablesById = {
            'sess-path-only': {
                metadata: {
                    path: '/repo-only',
                    homeDir: '/home/user',
                },
            },
        } as any;
        const summary = buildSessionListReachabilitySummary({
            listItems: [
                {
                    type: 'session',
                    sessionId: 'sess-path-only',
                },
            ] as any,
            machinesById: new Map(),
            workspaceRefs: [],
            resolveSessionRenderable: (item: any) => sessionRenderablesById[item.sessionId] ?? null,
        });

        expect(summary.displayById.get('sess-path-only')).toEqual({
            machineId: null,
            machineLabel: '',
            workspaceSubtitle: 'repo-only',
            workspaceSubtitleEllipsizeMode: 'tail',
        });
        expect(summary.hasMultipleMachines).toBe(false);
    });

    it('uses renamed workspace refs for date-grouped row subtitles', () => {
        const sessionRenderablesById = {
            'sess-renamed': {
                metadata: {
                    machineId: 'machine-stale',
                    host: 'stale.local',
                    path: '/home/user/stale-repo',
                    homeDir: '/home/user',
                },
            },
        } as any;
        const summary = buildSessionListReachabilitySummary({
            listItems: [
                {
                    type: 'session',
                    sessionId: 'sess-renamed',
                    serverId: 'server-a',
                    groupKind: 'date',
                },
            ] as any,
            machinesById: new Map(),
            workspaceRefs: [
                {
                    id: 'workspace-ref-renamed',
                    serverId: 'server-a',
                    machineId: 'machine-stale',
                    rootPath: '/home/user/stale-repo',
                    label: 'Renamed Workspace',
                    createdAtMs: 1,
                    lastOpenedAtMs: null,
                },
            ],
            resolveSessionRenderable: (item: any) => sessionRenderablesById[item.sessionId] ?? null,
        });

        expect(summary.displayById.get('sess-renamed')).toEqual({
            machineId: 'machine-stale',
            machineLabel: 'stale.local',
            workspaceSubtitle: 'Renamed Workspace',
            workspaceSubtitleEllipsizeMode: 'tail',
        });
    });

    it('uses stable display attribution instead of live RPC reachability for row summaries', () => {
        storage.setState({
            sessions: {
                'sess-replaced': createSessionFixture({
                    id: 'sess-replaced',
                    serverId: 'server-a',
                    active: false,
                    metadata: {
                        machineId: 'machine-old',
                        host: 'old.local',
                        path: '/home/user/repo',
                        homeDir: '/home/user',
                    },
                }),
            },
            machines: {
                'machine-old': createMachineFixture({
                    id: 'machine-old',
                    active: false,
                    activeAt: 1,
                    replacedByMachineId: 'machine-current',
                    replacedAt: 2,
                    metadata: { host: 'old.local', homeDir: '/home/user', platform: 'linux', happyCliVersion: 'test', happyHomeDir: '/home/user/.happier' },
                }),
                'machine-current': createMachineFixture({
                    id: 'machine-current',
                    active: false,
                    activeAt: 3,
                    metadata: { displayName: 'Current machine', host: 'current.local', homeDir: '/home/user', platform: 'linux', happyCliVersion: 'test', happyHomeDir: '/home/user/.happier' },
                }),
            },
        });
        storage.setState({ machineListByServerId: { 'server-a': Object.values(storage.getState().machines) } });

        const summary = buildSessionListReachabilitySummary({
            listItems: [
                {
                    type: 'session',
                    sessionId: 'sess-replaced',
                    serverId: 'server-a',
                },
            ] as any,
            machinesById: new Map([
                ['machine-old', { id: 'machine-old', metadata: { host: 'old.local' } }],
                ['machine-current', { id: 'machine-current', metadata: { displayName: 'Current machine', host: 'current.local' } }],
            ]),
            workspaceRefs: [],
            resolveSessionRenderable: () => ({
                metadata: {
                    machineId: 'machine-old',
                    host: 'old.local',
                    path: '/home/user/repo',
                    homeDir: '/home/user',
                },
            }) as any,
        });

        expect(summary.displayById.get('sess-replaced')).toEqual({
            machineId: 'machine-current',
            machineLabel: 'Current machine',
            workspaceSubtitle: 'repo',
            workspaceSubtitleEllipsizeMode: 'tail',
        });
    });
});
