import type { PluginCancellationOptions } from '@happier-dev/plugin-sdk';
import {
    MAX_TRIAGE_LINKED_SESSIONS_PAGE_SIZE_V1,
    type TriageEntryPresentationStateV1,
    type TriageEntryRefV1,
    type TriageSourceWorkflowSubjectV1,
} from '@happier-dev/triage-protocol/v1';

import type { CorpusCollectionsV1 } from '../collections/bindCorpusCollections.js';
import { CORPUS_SESSION_LINKS_INDEX_ID } from '../collections/ids.js';
import { fromCorpusStoredRow } from '../collections/rowCodec.js';
import type {
    CorpusFixPullRequestLinkV1,
    CorpusSessionLinkRowV1,
    CorpusUserMarkRowV1,
} from '../collections/rows.js';
import { sameTriageEntryReference } from '../identity/components.js';
import { deriveSessionLinkEntryTag, deriveUserMarkTag } from '../identity/tags.js';

/**
 * The read and resolution half of the fix-PR link (`design/FIX-LINK.md`).
 *
 * The relationship "this pull request fixes that issue or error group" has two
 * inputs and no store of its own:
 *
 * - the user's explicit choice, kept on the entry's `user-marks` row and written
 *   only by `setPinned.ts#setFixPullRequest`, the one `user-marks` writer;
 * - the candidates a fixing Session already implies: a Session linked in
 *   `session-links` to both the entry and a pull request.
 *
 * Nothing here writes. The derived half is recomputed from the Session links on
 * every read, so unlinking the PR from the Session removes the candidate by
 * construction and there is no second copy of the relationship to drift.
 */

/** One pull request a fixing Session is linked to. */
export type TriageCoLinkedEntryV1 = Readonly<{
    entryRef: TriageEntryRefV1;
    displayPath: string;
    linkedAtMs: number;
}>;

export type TriageFixPullRequestSourcesV1 = Readonly<{
    linked: readonly CorpusFixPullRequestLinkV1[];
    dismissed: readonly TriageEntryRefV1[];
    /** Every other entry a Session linked to this entry is also linked to, of any kind. */
    coLinked: readonly TriageCoLinkedEntryV1[];
    /** A Session-links page was cut, so `coLinked` may be missing candidates. */
    incomplete: boolean;
}>;

type FixReadCollections = Pick<CorpusCollectionsV1, 'userMarks' | 'sessionLinks'>;

export async function readFixPullRequestSources(input: Readonly<{
    collections: FixReadCollections;
    entryRef: TriageEntryRefV1;
    signal?: AbortSignal;
}>): Promise<TriageFixPullRequestSourcesV1> {
    const { collections, entryRef } = input;
    const options: PluginCancellationOptions | undefined = input.signal ? { signal: input.signal } : undefined;

    const markTag = await deriveUserMarkTag(collections.userMarks, entryRef, options);
    const stored = await collections.userMarks.get(markTag, options);
    const choice = stored ? fromCorpusStoredRow<CorpusUserMarkRowV1>(stored).value.fixPullRequests : undefined;

    // One bounded page per relation, the same page the detail's linked-Session
    // read uses. A cut page is reported rather than walked without bound.
    let incomplete = false;
    const entryTag = await deriveSessionLinkEntryTag(collections.sessionLinks, entryRef, options);
    const sessions = await collections.sessionLinks.query({
        index: CORPUS_SESSION_LINKS_INDEX_ID.byEntry,
        prefix: [entryTag],
        order: 'asc',
        limit: MAX_TRIAGE_LINKED_SESSIONS_PAGE_SIZE_V1,
    }, options);
    if (sessions.nextCursor !== undefined) incomplete = true;

    const coLinked: TriageCoLinkedEntryV1[] = [];
    for (const sessionRow of sessions.rows) {
        const { sessionId } = fromCorpusStoredRow<CorpusSessionLinkRowV1>(sessionRow).value;
        const siblings = await collections.sessionLinks.query({
            index: CORPUS_SESSION_LINKS_INDEX_ID.bySession,
            prefix: [sessionId],
            order: 'asc',
            limit: MAX_TRIAGE_LINKED_SESSIONS_PAGE_SIZE_V1,
        }, options);
        if (siblings.nextCursor !== undefined) incomplete = true;
        for (const siblingRow of siblings.rows) {
            const sibling = fromCorpusStoredRow<CorpusSessionLinkRowV1>(siblingRow).value;
            if (sameTriageEntryReference(sibling.entryRef, entryRef)) continue;
            const seen = coLinked.findIndex((entry) => sameTriageEntryReference(entry.entryRef, sibling.entryRef));
            if (seen === -1) {
                // The derived set is bounded like every other relationship page
                // the detail reads; past it the answer says it is incomplete.
                if (coLinked.length >= MAX_TRIAGE_LINKED_SESSIONS_PAGE_SIZE_V1) {
                    incomplete = true;
                    continue;
                }
                coLinked.push({
                    entryRef: sibling.entryRef,
                    displayPath: sibling.displayPathAtLink,
                    linkedAtMs: sibling.linkedAtMs,
                });
            } else if (coLinked[seen]!.linkedAtMs < sibling.linkedAtMs) {
                coLinked[seen] = { ...coLinked[seen]!, linkedAtMs: sibling.linkedAtMs };
            }
        }
    }

    return Object.freeze({
        linked: choice?.linked ?? [],
        dismissed: choice?.dismissed ?? [],
        coLinked: Object.freeze(coLinked),
        incomplete,
    });
}

/** The PR's lifecycle as the fix link reads it. */
export type TriageFixPullRequestStatusV1 = 'open' | 'merged' | 'closed' | 'unknown';
export type TriageFixPullRequestPresentationV1 = TriageEntryPresentationStateV1;

export type TriageFixPullRequestV1 = Readonly<{
    entryRef: TriageEntryRefV1;
    /** `user` when the reader linked it; `session` when a fixing Session implies it. */
    origins: readonly ('user' | 'session')[];
    status: TriageFixPullRequestStatusV1;
    display: Readonly<{ title?: string; scopeLabel?: string; displayPath?: string }>;
}>;

export type TriageResolvedFixPullRequestsV1 = Readonly<{
    /** Ranked: open, merged, unknown, then closed; a user link before a derived one; newest first. */
    candidates: readonly TriageFixPullRequestV1[];
    /** The PR whose Files and Checks the detail renders. Never a PR closed without merging. */
    primary: TriageFixPullRequestV1 | null;
    incomplete: boolean;
}>;

/**
 * Pull-request lifecycle in the source-neutral vocabulary (`CONTRACT.md` §4):
 * merged or completed is `resolved`; closed without merging is `closed`.
 */
function statusOf(presentation: TriageFixPullRequestPresentationV1 | null): TriageFixPullRequestStatusV1 {
    switch (presentation) {
        case 'active':
            return 'open';
        case 'resolved':
            return 'merged';
        case 'closed':
        case 'suppressed':
            return 'closed';
        default:
            return 'unknown';
    }
}

const STATUS_RANK: Readonly<Record<TriageFixPullRequestStatusV1, number>> = {
    open: 0,
    merged: 1,
    unknown: 2,
    closed: 3,
};

export function resolveFixPullRequests(
    sources: TriageFixPullRequestSourcesV1,
    projection: Readonly<{
        /** The kind's declared workflow subject, from the admitted source descriptors. */
        workflowSubjectOf(entryRef: TriageEntryRefV1): TriageSourceWorkflowSubjectV1 | null;
        /** The PR's presentation state in the reader's projection, or `null` when not projected. */
        presentationOf(entryRef: TriageEntryRefV1): TriageFixPullRequestPresentationV1 | null;
    }>,
): TriageResolvedFixPullRequestsV1 {
    const isDismissed = (entryRef: TriageEntryRefV1) =>
        sources.dismissed.some((dismissed) => sameTriageEntryReference(dismissed, entryRef));

    type Draft = { candidate: TriageFixPullRequestV1; user: boolean; linkedAtMs: number };
    const drafts: Draft[] = [];

    for (const link of sources.linked) {
        drafts.push({
            candidate: {
                entryRef: link.entryRef,
                origins: ['user'],
                status: statusOf(projection.presentationOf(link.entryRef)),
                display: { title: link.displayAtLink.title, scopeLabel: link.displayAtLink.scopeLabel },
            },
            user: true,
            linkedAtMs: link.linkedAtMs,
        });
    }
    for (const coLinked of sources.coLinked) {
        // A co-linked issue, error group or anything a source did not declare as
        // a pull request is not a fix candidate.
        if (projection.workflowSubjectOf(coLinked.entryRef) !== 'pullRequest') continue;
        if (isDismissed(coLinked.entryRef)) continue;
        const existing = drafts.find((draft) => sameTriageEntryReference(draft.candidate.entryRef, coLinked.entryRef));
        if (existing) {
            existing.candidate = { ...existing.candidate, origins: ['user', 'session'] };
            continue;
        }
        drafts.push({
            candidate: {
                entryRef: coLinked.entryRef,
                origins: ['session'],
                status: statusOf(projection.presentationOf(coLinked.entryRef)),
                display: { displayPath: coLinked.displayPath },
            },
            user: false,
            linkedAtMs: coLinked.linkedAtMs,
        });
    }

    drafts.sort((left, right) =>
        STATUS_RANK[left.candidate.status] - STATUS_RANK[right.candidate.status]
        || Number(right.user) - Number(left.user)
        || right.linkedAtMs - left.linkedAtMs);

    const candidates = Object.freeze(drafts.map((draft) => Object.freeze(draft.candidate)));
    const primary = candidates.find((candidate) => candidate.status !== 'closed') ?? null;
    return Object.freeze({ candidates, primary, incomplete: sources.incomplete });
}
