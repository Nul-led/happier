import { describe, expect, it, vi } from 'vitest';

import type { SelectionListDynamicSection, SelectionListSectionDescriptor } from '@/components/ui/selectionList';

import {
    buildUniversalSearchSections,
    type BuildUniversalSearchSectionsInput,
} from './buildUniversalSearchSections';
import { buildUniversalSearchScopeKey } from './universalSearchResult';
import type { UniversalSearchResult } from './universalSearchResult';

function input(
    overrides: Partial<BuildUniversalSearchSectionsInput> = {},
): BuildUniversalSearchSectionsInput {
    return {
        query: '',
        commands: [],
        sessions: [],
        projects: [],
        searchSettingsPages: () => [],
        transcript: { status: 'absent' },
        files: { status: 'absent' },
        commits: { status: 'absent' },
        pluginSections: [],
        onCommitResult: () => {},
        ...overrides,
    };
}

function dynamicSections(
    sections: ReadonlyArray<SelectionListSectionDescriptor>,
): ReadonlyArray<SelectionListDynamicSection> {
    return sections.filter((section): section is SelectionListSectionDescriptor & SelectionListDynamicSection & { kind: 'dynamic' } => (
        section.kind === 'dynamic'
    ));
}

function sessionEntity(id: string, updatedAt: number, serverId = 'home-a') {
    return { sessionId: id, serverId, title: `Session ${id}`, updatedAt };
}

function staticOptionIds(
    sections: ReadonlyArray<SelectionListSectionDescriptor>,
    id: string,
): readonly string[] {
    const section = sections.find((candidate) => candidate.id === id);
    return section && 'options' in section ? section.options.map((option) => option.id) : [];
}

describe('buildUniversalSearchSections', () => {
    it('issues no remote request on an empty query: every corpus section is gated off', () => {
        const transcriptResolve = vi.fn(async () => []);
        const filesResolve = vi.fn(async () => []);
        const commitsResolve = vi.fn(async () => []);
        const sections = buildUniversalSearchSections(input({
            query: '',
            transcript: { status: 'ready', resolverKey: 'home-a', resolve: transcriptResolve },
            files: { status: 'ready', resolverKey: 'ws', resolve: filesResolve },
            commits: { status: 'ready', resolverKey: 'ws', resolve: commitsResolve },
        }));

        for (const section of dynamicSections(sections)) {
            expect(section.visibleWhen?.('')).toBe(false);
            expect(section.visibleWhen?.('   ')).toBe(false);
            expect(section.visibleWhen?.('needle')).toBe(true);
        }
        expect(transcriptResolve).not.toHaveBeenCalled();
        expect(filesResolve).not.toHaveBeenCalled();
        expect(commitsResolve).not.toHaveBeenCalled();
    });

    it('bounds empty-query local recents and offers the complete candidate set to the host matcher once a query is typed', () => {
        const sessions = Array.from({ length: 25 }, (_, index) => ({
            ...sessionEntity(`s${index}`, index),
            title: index === 24 ? 'Exact hidden needle' : `Unrelated session ${index}`,
        }));

        const empty = buildUniversalSearchSections(input({ query: '', sessions }));
        const emptySection = empty.find((section) => section.id === 'sessions');
        expect(emptySection?.kind).toBe('static');
        expect(emptySection && 'options' in emptySection ? emptySection.options.length : -1).toBe(5);

        const typed = buildUniversalSearchSections(input({ query: 'Exact hidden needle', sessions }));
        const typedSection = typed.find((section) => section.id === 'sessions');
        expect(typedSection && 'options' in typedSection ? typedSection.options.length : -1).toBe(25);
        expect(typedSection && 'options' in typedSection
            ? typedSection.options.some((option) => option.label === 'Exact hidden needle')
            : false).toBe(true);

        const projects = Array.from({ length: 25 }, (_, index) => ({
            workspaceRefId: `wr-${index}`,
            serverId: 'home-a',
            machineId: 'machine-a',
            rootPath: `/repo/${index}`,
            title: index === 24 ? 'Exact project needle' : `Unrelated project ${index}`,
            lastOpenedAtMs: index,
        }));
        const typedProjects = buildUniversalSearchSections(input({
            query: 'Exact project needle',
            projects,
        }));
        const projectSection = typedProjects.find((section) => section.id === 'projects');
        expect(projectSection && 'options' in projectSection ? projectSection.options.length : -1).toBe(25);
        expect(projectSection && 'options' in projectSection
            ? projectSection.options.some((option) => option.label === 'Exact project needle')
            : false).toBe(true);
    });

    it('presents recent sessions only through the canonical Session section for empty and typed queries', () => {
        const recentCommand = {
            id: 'session-s1',
            kind: 'recentSession' as const,
            title: 'Recent session',
            category: 'Recent Sessions',
            action: () => {},
        };
        const empty = buildUniversalSearchSections(input({
            commands: [recentCommand],
            sessions: [sessionEntity('s1', 1)],
        }));
        expect(empty.flatMap((section) => 'options' in section ? section.options : [])
            .filter((option) => option.label === 'Recent session')).toHaveLength(0);
        expect(staticOptionIds(empty, 'sessions')).toHaveLength(1);

        const typed = buildUniversalSearchSections(input({
            query: 'Recent session',
            commands: [recentCommand],
            sessions: [sessionEntity('s1', 1)],
        }));
        const typedOptions = typed.flatMap((section) => 'options' in section ? section.options : []);
        expect(typedOptions.some((option) => option.id === 'command:session-s1')).toBe(false);
        expect(staticOptionIds(typed, 'sessions')).toHaveLength(1);
    });

    it('preserves provider order for corpus sections instead of re-running the host matcher', async () => {
        const results: UniversalSearchResult[] = [
            {
                id: 'm1',
                scopeKey: buildUniversalSearchScopeKey(['home-b']),
                sourceId: 'transcript',
                kind: 'message',
                // Deliberately does NOT contain the query: an FTS/semantic hit
                // whose displayed label lacks the literal term must survive.
                title: 'Deployment postmortem',
                target: { kind: 'session', sessionId: 'sess-1', serverId: 'home-b', seq: 42 },
            },
        ];
        const sections = buildUniversalSearchSections(input({
            query: 'rollback',
            transcript: { status: 'ready', resolverKey: 'home-b', resolve: async () => results },
        }));
        const transcript = dynamicSections(sections).find((section) => section.id === 'transcript');
        expect(transcript?.resultFiltering).toBe('provider');

        const resolved = await transcript!.resolve('rollback', new AbortController().signal);
        expect(resolved.options).toHaveLength(1);
        expect(resolved.options[0]?.id)
            .toBe(`transcript::${buildUniversalSearchScopeKey(['home-b'])}::m1`);
    });

    it('projects a source-owned bounded-coverage hint through the canonical section status', () => {
        const sections = buildUniversalSearchSections(input({
            query: 'older work',
            transcript: {
                status: 'ready',
                resolverKey: 'daemon:home-a:machine-a',
                resultHint: 'Local memory storage limits can make older coverage partial.',
                resolve: async () => [],
            },
        }));

        expect(dynamicSections(sections).find((section) => section.id === 'transcript')?.resultHint)
            .toBe('Local memory storage limits can make older coverage partial.');
    });

    it('namespaces option ids by source so two providers cannot collide on the same row id', async () => {
        const sections = buildUniversalSearchSections(input({
            query: 'x',
            transcript: {
                status: 'ready',
                resolverKey: 'home-a',
                resolve: async () => [{
                    id: '1',
                    scopeKey: buildUniversalSearchScopeKey(['home-a']),
                    sourceId: 'transcript',
                    kind: 'message',
                    title: 'Transcript one',
                    target: { kind: 'session', sessionId: 's', serverId: 'home-a' },
                }],
            },
            files: {
                status: 'ready',
                resolverKey: 'ws',
                resolve: async () => [{
                    id: '1',
                    scopeKey: buildUniversalSearchScopeKey(['home-a', 'm', '/repo']),
                    sourceId: 'files',
                    kind: 'file',
                    title: 'File one',
                    target: {
                        kind: 'workspaceFile',
                        scope: { serverId: 'home-a', machineId: 'm', rootPath: '/repo' },
                        path: 'a.ts',
                        workspaceRefId: null,
                        sessionId: 's',
                        serverId: 'home-a',
                    },
                }],
            },
        }));
        const signal = new AbortController().signal;
        const byId = dynamicSections(sections);
        const transcript = await byId.find((s) => s.id === 'transcript')!.resolve('x', signal);
        const files = await byId.find((s) => s.id === 'files')!.resolve('x', signal);
        expect(transcript.options[0]?.id).not.toBe(files.options[0]?.id);
    });

    it('binds an unavailable source to a truthful empty hint, never an activatable row or an error', async () => {
        const sections = buildUniversalSearchSections(input({
            query: 'anything',
            transcript: { status: 'unavailable', resolverKey: 'home-a|indexing', hint: 'Still indexing' },
        }));
        const transcript = dynamicSections(sections).find((section) => section.id === 'transcript');
        expect(transcript).toBeDefined();
        const resolved = await transcript!.resolve('anything', new AbortController().signal);
        expect(resolved.options).toHaveLength(0);
        expect(resolved.emptyHint).toBe('Still indexing');
    });

    it('omits an absent source entirely rather than rendering an empty group for it', () => {
        const sections = buildUniversalSearchSections(input({ query: 'q', files: { status: 'absent' } }));
        expect(sections.some((section) => section.id === 'files')).toBe(false);
    });

    it('keys sensitive resolvers by their target so a superseded scope cannot replay cached rows', () => {
        const build = (accountScope: string) => dynamicSections(buildUniversalSearchSections(input({
            query: 'q',
            transcript: {
                status: 'ready',
                resolverKey: `${accountScope}|home-a`,
                resolve: async () => [],
            },
        }))).find((section) => section.id === 'transcript')?.resolverKey;

        expect(build('account-1')).not.toBe(build('account-2'));
    });

    it('records the selected identity without navigating, so the surface owns dismiss-then-activate', async () => {
        const onCommitResult = vi.fn();
        const sections = buildUniversalSearchSections(input({
            query: 'x',
            onCommitResult,
            files: {
                status: 'ready',
                resolverKey: 'ws',
                resolve: async () => [{
                    id: 'a.ts',
                    scopeKey: buildUniversalSearchScopeKey(['home-a', 'm', '/repo']),
                    sourceId: 'files',
                    kind: 'file',
                    title: 'a.ts',
                    target: {
                        kind: 'workspaceFile',
                        scope: { serverId: 'home-a', machineId: 'm', rootPath: '/repo' },
                        path: 'a.ts',
                        workspaceRefId: null,
                        sessionId: 'sess',
                        serverId: 'home-a',
                    },
                }],
            },
        }));
        const files = dynamicSections(sections).find((section) => section.id === 'files')!;
        const resolved = await files.resolve('x', new AbortController().signal);
        resolved.options[0]?.onSelect?.();
        expect(onCommitResult).toHaveBeenCalledTimes(1);
        expect(onCommitResult.mock.calls[0]?.[0]?.target).toMatchObject({ kind: 'workspaceFile', path: 'a.ts' });
    });

    it('scopes local session row identity by Home, so the same session id on two Homes is two rows', () => {
        const homeA = buildUniversalSearchSections(input({
            query: 'session',
            sessions: [sessionEntity('sess-1', 1, 'home-a')],
        }));
        const homeB = buildUniversalSearchSections(input({
            query: 'session',
            sessions: [sessionEntity('sess-1', 1, 'home-b')],
        }));

        const idA = staticOptionIds(homeA, 'sessions')[0];
        const idB = staticOptionIds(homeB, 'sessions')[0];
        expect(idA).toBeDefined();
        expect(idA).not.toBe(idB);

        // Both Homes projected at once: two distinct rows, not one merged row.
        const both = buildUniversalSearchSections(input({
            query: 'session',
            sessions: [sessionEntity('sess-1', 1, 'home-a'), sessionEntity('sess-1', 2, 'home-b')],
        }));
        expect(new Set(staticOptionIds(both, 'sessions')).size).toBe(2);
    });

    it('drops a held selection on a target switch instead of retaining it onto another target\u2019s row', async () => {
        const buildFor = (scope: Readonly<{ serverId: string; machineId: string; rootPath: string }>) =>
            buildUniversalSearchSections(input({
                query: 'readme',
                files: {
                    status: 'ready',
                    resolverKey: `${scope.serverId}|${scope.machineId}|${scope.rootPath}`,
                    resolve: async () => [{
                        id: 'README.md',
                        scopeKey: buildUniversalSearchScopeKey([
                            scope.serverId,
                            scope.machineId,
                            scope.rootPath,
                        ]),
                        sourceId: 'files',
                        kind: 'file',
                        title: 'README.md',
                        target: {
                            kind: 'workspaceFile',
                            scope,
                            path: 'README.md',
                            workspaceRefId: null,
                            sessionId: 'sess',
                            serverId: scope.serverId,
                        },
                    }],
                },
            }));

        const signal = new AbortController().signal;
        const before = dynamicSections(buildFor({ serverId: 'home-a', machineId: 'm1', rootPath: '/a' }))
            .find((section) => section.id === 'files')!;
        const after = dynamicSections(buildFor({ serverId: 'home-a', machineId: 'm2', rootPath: '/b' }))
            .find((section) => section.id === 'files')!;

        const beforeRows = await before.resolve('readme', signal);
        const afterRows = await after.resolve('readme', signal);

        // Same repo-relative path in two checkouts is two identities, and the
        // resolver rebinding is what drops the superseded target's in-flight work.
        expect(beforeRows.options[0]?.id).not.toBe(afterRows.options[0]?.id);
        expect(before.resolverKey).not.toBe(after.resolverKey);
    });

    it('projects plugin provider sections through without adding host plugin policy', () => {
        const pluginSection: SelectionListDynamicSection = {
            id: 'plugin-search:acme:issues',
            title: 'Acme issues',
            resolverKey: 'plugin-search:acme:issues|gen-3',
            resultFiltering: 'provider',
            resolve: async () => ({ options: [] }),
        };
        const sections = buildUniversalSearchSections(input({ query: 'x', pluginSections: [pluginSection] }));
        const projected = dynamicSections(sections).find((section) => section.id === pluginSection.id);
        expect(projected?.resolverKey).toBe(pluginSection.resolverKey);
        expect(projected?.resultFiltering).toBe('provider');
        expect(projected?.showSkeletonsOnFirstLoad).toBe(true);
        expect(projected?.resultTransition).toBe('none');
    });

    it('uses truthful first-load status without applying directory-drill motion to typed queries', () => {
        const source = { status: 'ready' as const, resolverKey: 'target', resolve: async () => [] };
        const sections = buildUniversalSearchSections(input({
            query: 'needle',
            transcript: source,
            files: source,
            commits: source,
        }));
        const remote = dynamicSections(sections).filter((section) => (
            section.id === 'transcript'
            || section.id === 'files'
            || section.id === 'commits'
        ));

        expect(remote.length).toBeGreaterThan(0);
        for (const section of remote) {
            expect(section.showSkeletonsOnFirstLoad).toBe(true);
            expect(section.resultTransition).toBe('none');
        }
    });

    it('keeps commands as the leading static sections built by the canonical command adapter', () => {
        const sections = buildUniversalSearchSections(input({
            query: '',
            commands: [
                { id: 'new-session', title: 'New Session', category: 'Sessions', action: () => {} },
            ],
        }));
        expect(sections[0]?.kind).toBe('static');
        expect(sections[0] && 'options' in sections[0] ? sections[0].options[0]?.id : null)
            .toBe('command:new-session');
    });
});
