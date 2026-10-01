import type { PluginInvocationContext } from '@happier-dev/plugin-sdk';
import type { ActionHandler } from '@happier-dev/plugin-sdk/actions';

import { bindCorpusCollections } from '../corpus/collections/bindCorpusCollections.js';
import type { CorpusCollectionsV1 } from '../corpus/collections/bindCorpusCollections.js';
import { readFixPullRequestSources } from '../corpus/marks/fixPullRequests.js';
import { setFixPullRequest } from '../corpus/marks/setPinned.js';
import { requireTriageAccountStorage } from '../requiredAccountStorage.js';
import type {
    TriageReadFixPullRequestsInputV1,
    TriageReadFixPullRequestsResultV1,
    TriageSetFixPullRequestInputV1,
    TriageSetFixPullRequestResultV1,
} from './fixPullRequestsProtocol.js';

/**
 * The two fix-PR Actions: transport to the one `user-marks` writer and the
 * read over `user-marks` plus `session-links`. They decide nothing; the corpus
 * owners do (`design/FIX-LINK.md`).
 */

export type TriageFixPullRequestsDepsV1 = Readonly<{
    collections: Pick<CorpusCollectionsV1, 'userMarks' | 'sessionLinks'>;
    nowMs: () => number;
    signal?: AbortSignal;
}>;

export async function readTriageFixPullRequests(
    input: TriageReadFixPullRequestsInputV1,
    deps: TriageFixPullRequestsDepsV1,
): Promise<TriageReadFixPullRequestsResultV1> {
    const sources = await readFixPullRequestSources({
        collections: deps.collections,
        entryRef: input.entryRef,
        ...(deps.signal ? { signal: deps.signal } : {}),
    });
    return {
        v: 1,
        linked: sources.linked.map((link) => ({ ...link })),
        dismissed: [...sources.dismissed],
        coLinked: sources.coLinked.map((entry) => ({ ...entry })),
        incomplete: sources.incomplete,
    };
}

export async function setTriageFixPullRequest(
    input: TriageSetFixPullRequestInputV1,
    deps: TriageFixPullRequestsDepsV1,
): Promise<TriageSetFixPullRequestResultV1> {
    const common = {
        collections: deps.collections,
        entryRef: input.entryRef,
        displayAtMark: input.displayAtMark,
        fixPullRequest: input.fixPullRequest,
        nowMs: deps.nowMs(),
        ...(deps.signal ? { signal: deps.signal } : {}),
    };
    const result = input.linked
        ? await setFixPullRequest({ ...common, linked: true, displayAtLink: input.displayAtLink })
        : await setFixPullRequest({ ...common, linked: false });
    return { v: 1, status: result.status };
}

function depsFor(context: PluginInvocationContext): TriageFixPullRequestsDepsV1 {
    return {
        collections: bindCorpusCollections(requireTriageAccountStorage(context)),
        nowMs: () => Date.now(),
        ...(context.signal ? { signal: context.signal } : {}),
    };
}

export function createTriageReadFixPullRequestsActionHandler(): ActionHandler<
    TriageReadFixPullRequestsInputV1,
    TriageReadFixPullRequestsResultV1
> {
    return async (input, context: PluginInvocationContext) => await readTriageFixPullRequests(input, depsFor(context));
}

export function createTriageSetFixPullRequestActionHandler(): ActionHandler<
    TriageSetFixPullRequestInputV1,
    TriageSetFixPullRequestResultV1
> {
    return async (input, context: PluginInvocationContext) => await setTriageFixPullRequest(input, depsFor(context));
}
