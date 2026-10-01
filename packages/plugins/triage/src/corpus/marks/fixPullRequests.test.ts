import { describe, expect, it } from 'vitest';
import type { TriageEntryRefV1, TriageSourceWorkflowSubjectV1 } from '@happier-dev/triage-protocol/v1';

import { CORPUS_USER_MARKS_INDEX_ID } from '../collections/ids.js';
import type { CorpusUserMarkRowV1 } from '../collections/rows.js';
import { deriveUserMarkTag } from '../identity/tags.js';
import {
    createTestkitCorpusCollections,
    type TestkitCorpusCollections,
} from '../testkit/corpusCollections.test-support.js';
import { testkitEntryRef, testkitLocator } from '../testkit/observations.test-support.js';
import { linkEntryToSession } from '../../sessions/entrySessionLinks.js';
import {
    readFixPullRequestSources,
    resolveFixPullRequests,
    type TriageFixPullRequestPresentationV1,
} from './fixPullRequests.js';
import { setFixPullRequest, setPinned } from './setPinned.js';

const SENTRY = { pluginId: 'happier.sentry', localId: 'errors' } as const;
const GITHUB = { pluginId: 'happier.scm-github', localId: 'github' } as const;

/** A Sentry error group: the entry that is being fixed. */
const ERROR_REF: TriageEntryRefV1 = testkitEntryRef({
    source: SENTRY,
    kindId: 'error-group',
    collisionScope: 'acme/web',
    entryId: 'WEB-1A2',
});
const ERROR_DISPLAY = { title: 'TypeError: cannot read id', scopeLabel: 'acme/web' } as const;

function githubPr(entryId: string): TriageEntryRefV1 {
    return testkitEntryRef({ source: GITHUB, kindId: 'pull-request', collisionScope: 'acme/web', entryId });
}
const GITHUB_ISSUE = testkitEntryRef({ source: GITHUB, kindId: 'issue', collisionScope: 'acme/web', entryId: '903' });

const SUBJECTS: Readonly<Record<string, TriageSourceWorkflowSubjectV1>> = {
    'pull-request': 'pullRequest',
    issue: 'issue',
    'error-group': 'errorIssue',
};
const workflowSubjectOf = (ref: TriageEntryRefV1) => SUBJECTS[ref.kindId] ?? null;

async function link(fixture: TestkitCorpusCollections, entryRef: TriageEntryRefV1, sessionId: string, nowMs: number) {
    const result = await linkEntryToSession({
        collections: fixture.collections,
        entryRef,
        display: { locator: testkitLocator({ displayPath: `acme/web ${entryRef.entryId}` }), scopeLabel: 'acme/web' },
        sessionId: sessionId as never,
        nowMs,
    });
    expect(result.status).toBe('linked');
}

async function resolve(
    fixture: TestkitCorpusCollections,
    presentation: Readonly<Record<string, TriageFixPullRequestPresentationV1>> = {},
) {
    const sources = await readFixPullRequestSources({ collections: fixture.collections, entryRef: ERROR_REF });
    return resolveFixPullRequests(sources, {
        workflowSubjectOf,
        presentationOf: (ref) => presentation[ref.entryId] ?? null,
    });
}

describe('fix pull request links', () => {
    it('derives a cross-source fix PR from a Session linked to both the error and the PR, and nothing else', async () => {
        const fixture = createTestkitCorpusCollections({ accountEncryptionMode: 'e2ee' });
        await link(fixture, ERROR_REF, 'session-a', 1_000);
        await link(fixture, githubPr('41'), 'session-a', 2_000);
        // Co-linked, but an issue is not a pull request.
        await link(fixture, GITHUB_ISSUE, 'session-a', 3_000);
        // A PR worked on in a Session that never touched the error.
        await link(fixture, githubPr('77'), 'session-b', 4_000);

        const resolved = await resolve(fixture, { 41: 'active' });

        expect(resolved.candidates).toEqual([{
            entryRef: githubPr('41'),
            origins: ['session'],
            status: 'open',
            display: { displayPath: 'acme/web 41' },
        }]);
        expect(resolved.primary?.entryRef).toEqual(githubPr('41'));
        expect(resolved.incomplete).toBe(false);
    });

    it('records an explicit link on the error mark without pinning it, and keeps an existing pin', async () => {
        const fixture = createTestkitCorpusCollections();
        const pr = githubPr('52');

        expect(await setFixPullRequest({
            collections: fixture.collections,
            entryRef: ERROR_REF,
            displayAtMark: ERROR_DISPLAY,
            linked: true,
            fixPullRequest: pr,
            displayAtLink: { title: 'Guard missing id', scopeLabel: 'acme/web' },
            nowMs: 5_000,
        })).toEqual({ status: 'linked' });

        const resolved = await resolve(fixture, { 52: 'resolved' });
        expect(resolved.candidates).toEqual([{
            entryRef: pr,
            origins: ['user'],
            status: 'merged',
            display: { title: 'Guard missing id', scopeLabel: 'acme/web' },
        }]);
        expect(resolved.primary?.entryRef).toEqual(pr);

        // The mark exists only for the link: it is not a pin.
        const pinned = await fixture.collections.userMarks.query({
            index: CORPUS_USER_MARKS_INDEX_ID.byPinned,
            prefix: [true],
            order: 'asc',
        });
        expect(pinned.rows).toHaveLength(0);

        // Pinning afterwards keeps the link, and unpinning keeps the row.
        await setPinned({ collections: fixture.collections, entryRef: ERROR_REF, pinned: true, displayAtMark: ERROR_DISPLAY, nowMs: 6_000 });
        const markTag = await deriveUserMarkTag(fixture.collections.userMarks, ERROR_REF);
        expect((await fixture.collections.userMarks.get(markTag))?.value).toMatchObject({ pinned: true, markedAtMs: 6_000 });
        expect(await setPinned({ collections: fixture.collections, entryRef: ERROR_REF, pinned: false, nowMs: 7_000 }))
            .toEqual({ status: 'unpinned', markTag });
        const kept = (await fixture.collections.userMarks.get(markTag))?.value as unknown as CorpusUserMarkRowV1;
        expect(kept.pinned).toBe(false);
        expect((await resolve(fixture)).candidates.map((c) => c.entryRef)).toEqual([pr]);
    });

    it('unlinks a derived candidate without touching the Session link, and relinking restores it', async () => {
        const fixture = createTestkitCorpusCollections();
        const pr = githubPr('41');
        await link(fixture, ERROR_REF, 'session-a', 1_000);
        await link(fixture, pr, 'session-a', 2_000);

        expect(await setFixPullRequest({
            collections: fixture.collections,
            entryRef: ERROR_REF,
            displayAtMark: ERROR_DISPLAY,
            linked: false,
            fixPullRequest: pr,
            nowMs: 3_000,
        })).toEqual({ status: 'unlinked' });

        expect((await resolve(fixture)).candidates).toEqual([]);
        // The Session still worked on the PR.
        const sources = await readFixPullRequestSources({ collections: fixture.collections, entryRef: ERROR_REF });
        expect(sources.coLinked.map((c) => c.entryRef)).toEqual([pr]);

        await setFixPullRequest({
            collections: fixture.collections,
            entryRef: ERROR_REF,
            displayAtMark: ERROR_DISPLAY,
            linked: true,
            fixPullRequest: pr,
            displayAtLink: { title: 'Guard missing id', scopeLabel: 'acme/web' },
            nowMs: 4_000,
        });
        expect((await resolve(fixture)).candidates).toEqual([
            expect.objectContaining({ entryRef: pr, origins: ['user', 'session'] }),
        ]);
    });

    it('never renders a PR closed without merging, and prefers open, then merged, then unknown', async () => {
        const fixture = createTestkitCorpusCollections();
        await link(fixture, ERROR_REF, 'session-a', 1_000);
        await link(fixture, githubPr('1'), 'session-a', 2_000);
        await link(fixture, githubPr('2'), 'session-a', 3_000);
        await link(fixture, githubPr('3'), 'session-a', 4_000);

        const onlyClosed = await resolve(fixture, { 1: 'closed', 2: 'closed', 3: 'suppressed' });
        expect(onlyClosed.primary).toBeNull();
        expect(onlyClosed.candidates.map((c) => c.status)).toEqual(['closed', 'closed', 'closed']);

        const mixed = await resolve(fixture, { 1: 'closed', 2: 'resolved' });
        expect(mixed.primary?.entryRef).toEqual(githubPr('2'));
        expect(mixed.candidates.map((c) => [c.entryRef.entryId, c.status])).toEqual([
            ['2', 'merged'],
            ['3', 'unknown'],
            ['1', 'closed'],
        ]);

        const open = await resolve(fixture, { 1: 'closed', 2: 'resolved', 3: 'active' });
        expect(open.primary?.entryRef).toEqual(githubPr('3'));
    });
});
