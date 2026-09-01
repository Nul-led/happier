import type { PluginInvocationContext } from '@happier-dev/plugin-sdk';
import type { TriageSourceFailureV1 } from '@happier-dev/triage-protocol/v1';
import {
  fitActionResultPageV1,
  fitActionResultSequenceV1,
} from '@happier-dev/triage-sources/projection/actionResultSequence';

import { admitGithubDetailInvocation, admitGithubEntryInvocation } from './admission.js';
import {
  GithubCapabilitiesInputV1Schema,
  GithubChangedFilesInputV1Schema,
  GithubChecksInputV1Schema,
  GithubFeedbackInputV1Schema,
  GithubFeedbackResultV1Schema,
  GithubOverviewInputV1Schema,
  GithubTimelineInputV1Schema,
  type GithubChangedFilesResultV1,
  type GithubCapabilitiesResultV1,
  type GithubChecksResultV1,
  type GithubFeedbackResultV1,
  type GithubOverviewResultV1,
  type GithubTimelineResultV1,
} from './detail/contracts.js';
import { projectGithubRepositoryCapabilities } from './capabilities.js';
import {
  readGithubFeedbackConnection,
  type GithubFeedbackCommentV1,
} from './feedback.js';
import { readGithubRepositoryIdFromCollisionScope } from './identity.js';
import {
  decodeGithubDetailContinuation,
  encodeGithubDetailContinuation,
} from './detail/continuation.js';
import {
  GITHUB_DETAIL_BOUNDS_V1,
  projectGithubCheckRows,
} from './detail/projection.js';
import {
  readGithubChangedFilesPage,
  readGithubChecksSurface,
  readGithubTimelinePage,
  type GithubDetailPageV1,
} from './detail/reads.js';
import { toTriageFailure } from './mapping/protocol.js';
import { readGithubIssue, readGithubPullRequest } from './get.js';
import { createGithubRepositoryReader } from './repositories.js';

/**
 * The seven bound source-native detail operations.
 *
 * Each is the whole vertical for one Action invocation: it validates the
 * published input, admits the configured instance through the SAME rule `scan`
 * and `get` use, resolves the route from current source evidence, materializes
 * that exact account inside one request closure, and shapes the result into the
 * published contract. It owns no registry, no cache, no second route authority,
 * and it writes no configured state.
 *
 * The detail body invokes these; it never holds a credential, constructs a URL,
 * or sees a raw provider body. What crosses back is only what the boundary
 * projector copied.
 *
 * Every failure is a STATED outcome rather than an empty result. A timeline
 * refused for permission, a changed-file walk stopped at GitHub's documented
 * ceiling, and a pull request with no changed files at all are three different
 * answers, and each panel is given the one that is true.
 */

const INVALID_INPUT_FAILURE: TriageSourceFailureV1 = Object.freeze({
  class: 'unsupportedContract',
  code: 'github_detail_input_invalid',
});

const CONTINUATION_UNREADABLE_FAILURE: TriageSourceFailureV1 = Object.freeze({
  class: 'unsupportedContract',
  code: 'github_detail_continuation_unreadable',
});

/**
 * Resolves the page one paged detail read starts from.
 *
 * A continuation this source did not mint, or one minted under a different page
 * geometry, is refused rather than reinterpreted: resuming at a page number that
 * names different rows would silently skip or repeat part of the collection.
 */
function resolvePage(
  continuation: string | undefined,
  limit: number,
): Readonly<{ ok: true; page: number }> | Readonly<{ ok: false }> {
  if (continuation === undefined) return Object.freeze({ ok: true as const, page: 1 });
  const frontier = decodeGithubDetailContinuation(continuation);
  if (frontier === null || frontier.perPage !== limit) {
    return Object.freeze({ ok: false as const });
  }
  return Object.freeze({ ok: true as const, page: frontier.page });
}

function mintContinuation(nextPage: number | null, perPage: number): string | null {
  return nextPage === null
    ? null
    : encodeGithubDetailContinuation({ v: 1, page: nextPage, perPage });
}

type PagedShape<TRow> = Readonly<{
  rows: readonly TRow[];
  omittedRowCount: number;
  projectionTruncated: boolean;
  incomplete?: 'ceiling' | 'pagination';
  continuation?: string;
}>;

/** Shapes one settled page into the members every paged plane result shares. */
function shapePage<TRow>(
  page: GithubDetailPageV1<TRow>,
  perPage: number,
): PagedShape<TRow> {
  const continuation = mintContinuation(page.nextPage, perPage);
  // A next page this source cannot mint a token for ends the walk, and saying so
  // is the point: a silently dropped position reads as a finished collection.
  const incomplete = page.incomplete
    ?? (page.nextPage !== null && continuation === null ? 'pagination' : null);
  return Object.freeze({
    rows: page.rows,
    omittedRowCount: page.omittedRowCount,
    projectionTruncated: page.projectionTruncated,
    ...(incomplete === null ? {} : { incomplete }),
    ...(continuation === null ? {} : { continuation }),
  });
}

function unavailable(failure: TriageSourceFailureV1): Readonly<{
  kind: 'unavailable';
  failure: TriageSourceFailureV1;
}> {
  return Object.freeze({ kind: 'unavailable' as const, failure });
}

export async function readGithubCapabilities(
  input: unknown,
  context: PluginInvocationContext,
): Promise<GithubCapabilitiesResultV1> {
  const parsed = GithubCapabilitiesInputV1Schema.safeParse(input);
  if (!parsed.success) return unavailable(INVALID_INPUT_FAILURE);
  const request = parsed.data;
  const admitted = await admitGithubDetailInvocation({
    instance: request.instance,
    localRef: request.localRef,
    routingToken: request.routingToken,
    admissibleKinds: ['pull-request', 'issue'],
  }, context);
  if (!admitted.ok) return unavailable(admitted.failure);
  return Object.freeze({
    kind: 'capabilities' as const,
    ...projectGithubRepositoryCapabilities(admitted.repository),
  });
}

/* -------------------------------------------------------------------- overview */

const ENTRY_ABSENT_FAILURE: TriageSourceFailureV1 = Object.freeze({
  class: 'unknown',
  code: 'github_entry_absent',
});

const ENTRY_NOT_OBSERVED_FAILURE: TriageSourceFailureV1 = Object.freeze({
  class: 'unknown',
  code: 'github_entry_not_observed',
});

/** One explicit exact entity reread; the launched observation remains the initial view. */
export async function readGithubOverview(
  input: unknown,
  context: PluginInvocationContext,
): Promise<GithubOverviewResultV1> {
  const parsed = GithubOverviewInputV1Schema.safeParse(input);
  if (!parsed.success) return unavailable(INVALID_INPUT_FAILURE);
  const request = parsed.data;
  const admitted = await admitGithubEntryInvocation({
    instance: request.instance,
    localRef: request.localRef,
    routingToken: request.routingToken,
    admissibleKinds: ['pull-request', 'issue'],
  }, context);
  if (!admitted.ok) return unavailable(admitted.failure);

  const dependencies = Object.freeze({
    client: admitted.client,
    now: Date.now,
    signal: admitted.signal,
    repositories: createGithubRepositoryReader({ client: admitted.client, now: Date.now }),
  });
  if (admitted.kindId === 'pull-request') {
    const read = await readGithubPullRequest(
      admitted.localRef,
      admitted.route,
      dependencies.repositories,
      dependencies,
    );
    if (read.observation.kind === 'unresolved') {
      return unavailable(toTriageFailure(read.observation.failure));
    }
    if (read.observation.kind === 'absent') return unavailable(ENTRY_ABSENT_FAILURE);
    if (read.observation.kind !== 'present' || read.overview === null) {
      return unavailable(ENTRY_NOT_OBSERVED_FAILURE);
    }
    return Object.freeze({
      kind: 'overview' as const,
      kindId: 'pull-request' as const,
      observedAtMs: Date.now(),
      ...read.overview,
    });
  }

  const read = await readGithubIssue(
    admitted.localRef,
    admitted.route,
    dependencies.repositories,
    dependencies,
  );
  if (read.observation.kind === 'unresolved') {
    return unavailable(toTriageFailure(read.observation.failure));
  }
  if (read.observation.kind === 'absent') return unavailable(ENTRY_ABSENT_FAILURE);
  if (read.observation.kind !== 'present' || read.overview === null) {
    return unavailable(ENTRY_NOT_OBSERVED_FAILURE);
  }
  return Object.freeze({
    kind: 'overview' as const,
    kindId: 'issue' as const,
    observedAtMs: Date.now(),
    ...read.overview,
  });
}

/* ------------------------------------------------------------------- timeline */

/** One bounded page of the event timeline of a pull request or an issue. */
export async function listGithubTimeline(
  input: unknown,
  context: PluginInvocationContext,
): Promise<GithubTimelineResultV1> {
  const parsed = GithubTimelineInputV1Schema.safeParse(input);
  if (!parsed.success) return unavailable(INVALID_INPUT_FAILURE);
  const request = parsed.data;
  const position = resolvePage(request.continuation, request.limit);
  if (!position.ok) return unavailable(CONTINUATION_UNREADABLE_FAILURE);

  const admitted = await admitGithubDetailInvocation({
    instance: request.instance,
    localRef: request.localRef,
    routingToken: request.routingToken,
    admissibleKinds: ['pull-request', 'issue'],
  }, context);
  if (!admitted.ok) return unavailable(admitted.failure);

  const page = await readGithubTimelinePage({
    route: admitted.route,
    entryNumber: admitted.entryNumber,
    perPage: request.limit,
    page: position.page,
  }, { client: admitted.client, now: Date.now });
  if (!page.ok) return unavailable(toTriageFailure(page.failure));

  return Object.freeze({
    kind: 'timeline' as const,
    ...shapePage(page.value, request.limit),
  });
}

/* -------------------------------------------------------------- changed files */

/** One bounded page of the changed files of a pull request. */
export async function listGithubChangedFiles(
  input: unknown,
  context: PluginInvocationContext,
): Promise<GithubChangedFilesResultV1> {
  const parsed = GithubChangedFilesInputV1Schema.safeParse(input);
  if (!parsed.success) return unavailable(INVALID_INPUT_FAILURE);
  const request = parsed.data;
  const position = resolvePage(request.continuation, request.limit);
  if (!position.ok) return unavailable(CONTINUATION_UNREADABLE_FAILURE);

  const admitted = await admitGithubDetailInvocation({
    instance: request.instance,
    localRef: request.localRef,
    routingToken: request.routingToken,
    // An issue has no changed files, and answering with an empty page would be a
    // different claim from "this plane does not apply to this kind".
    admissibleKinds: ['pull-request'],
  }, context);
  if (!admitted.ok) return unavailable(admitted.failure);

  const page = await readGithubChangedFilesPage({
    route: admitted.route,
    entryNumber: admitted.entryNumber,
    perPage: request.limit,
    page: position.page,
  }, { client: admitted.client, now: Date.now });
  if (!page.ok) return unavailable(toTriageFailure(page.failure));

  return Object.freeze({
    kind: 'changedFiles' as const,
    ...shapePage(page.value, request.limit),
  });
}

/* ------------------------------------------------------------------- feedback */

/** Reads one independently paged feedback connection; issues expose comments only. */
export async function readGithubFeedback(
  input: unknown,
  context: PluginInvocationContext,
): Promise<GithubFeedbackResultV1> {
  const parsed = GithubFeedbackInputV1Schema.safeParse(input);
  if (!parsed.success) return unavailable(INVALID_INPUT_FAILURE);
  const request = parsed.data;

  const admitted = await admitGithubDetailInvocation({
    instance: request.instance,
    localRef: request.localRef,
    routingToken: request.routingToken,
    admissibleKinds: request.connection === 'comments'
      ? ['pull-request', 'issue']
      : ['pull-request'],
  }, context);
  if (!admitted.ok) return unavailable(admitted.failure);
  const repositoryId = readGithubRepositoryIdFromCollisionScope(admitted.localRef.collisionScope);
  if (repositoryId === null) return unavailable(INVALID_INPUT_FAILURE);

  const common = {
    route: admitted.route,
    repositoryId,
    number: admitted.entryNumber,
    cursor: request.cursor ?? null,
  };
  const connectionInput = admitted.kindId === 'issue'
    ? { ...common, kindId: 'issue' as const, connection: 'comments' as const }
    : request.connection === 'threadReplies'
      ? {
        ...common,
        kindId: 'pull-request' as const,
        connection: 'threadReplies' as const,
        threadId: request.threadId,
      }
      : {
        ...common,
        kindId: 'pull-request' as const,
        connection: request.connection,
      };
  const result = await readGithubFeedbackConnection(
    connectionInput,
    { client: admitted.client, now: Date.now, signal: admitted.signal },
  );

  if (result.kind === 'unavailable') return result;
  const shapeComment = (row: GithubFeedbackCommentV1) => ({
    id: row.id,
    body: row.body,
    ...(row.author !== null ? { author: row.author } : {}),
    ...(row.createdAtMs !== null ? { createdAtMs: row.createdAtMs } : {}),
    ...(row.url !== null ? { url: row.url } : {}),
    ...(row.truncated === true ? { truncated: true as const } : {}),
  });
  if (result.kind === 'requests') {
    return GithubFeedbackResultV1Schema.parse(fitActionResultPageV1(
      result.rows,
      result.nextCursor ?? undefined,
      (rows, omittedRowCount, nextCursor, continuationOmitted) => Object.freeze({
        kind: 'requests' as const,
        rows: rows.map((row) => ({ ...row })),
        omittedRowCount,
        projectionTruncated: omittedRowCount > 0
          || rows.some((row) => row.truncated === true),
        ...(nextCursor === undefined ? {} : { nextCursor }),
        ...(continuationOmitted ? { incomplete: 'continuationUnavailable' as const } : {}),
      }),
    ).result);
  }
  if (result.kind === 'reviews') {
    const projectedRows = result.rows.map((row) => ({
        id: row.id,
        body: row.body,
        state: row.state,
        ...(row.author === null ? {} : { author: row.author }),
        ...(row.submittedAtMs === null ? {} : { submittedAtMs: row.submittedAtMs }),
        ...(row.url === null ? {} : { url: row.url }),
        ...(row.truncated === true ? { truncated: true as const } : {}),
      }));
    return GithubFeedbackResultV1Schema.parse(fitActionResultPageV1(
      projectedRows,
      result.previousCursor ?? undefined,
      (rows, omittedRowCount, previousCursor, continuationOmitted) => Object.freeze({
        kind: 'reviews' as const,
        rows,
        ...(result.reviewDecision === null ? {} : { reviewDecision: result.reviewDecision }),
        omittedRowCount,
        projectionTruncated: omittedRowCount > 0
          || rows.some((row) => row.truncated === true),
        ...(previousCursor === undefined ? {} : { previousCursor }),
        ...(continuationOmitted ? { incomplete: 'continuationUnavailable' as const } : {}),
      }),
    ).result);
  }
  if (result.kind === 'threads') {
    const projectedRows = result.rows.map((row) => ({
        id: row.id,
        isResolved: row.isResolved,
        ...(row.firstReply === null ? {} : { firstReply: shapeComment(row.firstReply) }),
        replyCount: row.replyCount,
        replies: row.replies.map(shapeComment),
        ...(row.path === null ? {} : { path: row.path }),
        ...(row.line === null ? {} : { line: row.line }),
        ...(row.previousRepliesCursor === null ? {} : { previousRepliesCursor: row.previousRepliesCursor }),
        ...(row.truncated === true ? { truncated: true as const } : {}),
      }));
    return GithubFeedbackResultV1Schema.parse(fitActionResultPageV1(
      projectedRows,
      result.previousCursor ?? undefined,
      (rows, omittedRowCount, previousCursor, continuationOmitted) => Object.freeze({
        kind: 'threads' as const,
        rows,
        omittedRowCount,
        projectionTruncated: omittedRowCount > 0
          || rows.some((row) => row.truncated === true),
        ...(previousCursor === undefined ? {} : { previousCursor }),
        ...(continuationOmitted ? { incomplete: 'continuationUnavailable' as const } : {}),
      }),
    ).result);
  }
  const projectedRows = result.rows.map(shapeComment);
  return GithubFeedbackResultV1Schema.parse(fitActionResultPageV1(
    projectedRows,
    result.previousCursor ?? undefined,
    (rows, omittedRowCount, previousCursor, continuationOmitted) => Object.freeze({
      kind: result.kind,
      ...('threadId' in result ? { threadId: result.threadId } : {}),
      rows,
      omittedRowCount,
      projectionTruncated: omittedRowCount > 0
        || rows.some((row) => row.truncated === true),
      ...(previousCursor === undefined ? {} : { previousCursor }),
      ...(continuationOmitted ? { incomplete: 'continuationUnavailable' as const } : {}),
    }),
  ).result);
}

/* --------------------------------------------------------------------- checks */

/**
 * The whole check surface of one pull request, at its current head revision.
 *
 * The two provider collections are read together because their rollup is one
 * answer: one of them failing renders the other's rows beside a failure that
 * names which read could not be made, and neither is ever presented as "no
 * checks configured".
 */
export async function readGithubChecks(
  input: unknown,
  context: PluginInvocationContext,
): Promise<GithubChecksResultV1> {
  const parsed = GithubChecksInputV1Schema.safeParse(input);
  if (!parsed.success) return unavailable(INVALID_INPUT_FAILURE);
  const request = parsed.data;

  const admitted = await admitGithubDetailInvocation({
    instance: request.instance,
    localRef: request.localRef,
    routingToken: request.routingToken,
    admissibleKinds: ['pull-request'],
  }, context);
  if (!admitted.ok) return unavailable(admitted.failure);

  const read = await readGithubChecksSurface({
    route: admitted.route,
    entryNumber: admitted.entryNumber,
  }, { client: admitted.client, now: Date.now, signal: admitted.signal });
  if (!read.ok) return unavailable(toTriageFailure(read.failure));

  const { headRevision, surface } = read.value;
  const projected = projectGithubCheckRows(surface.observations, GITHUB_DETAIL_BOUNDS_V1);
  return fitActionResultSequenceV1(projected.rows, (rows, omittedByEnvelope) => Object.freeze({
    kind: 'checks' as const,
    headRevision,
    state: surface.state,
    // The row-fact state this suite projects to, computed by `checks.ts` over
    // EVERY observation it read. Publishing it is what lets the detail surface
    // say what GitHub reports as wrong in the same words the list row uses,
    // without deriving a second answer from the bounded rows below.
    ...(surface.rowState === null ? {} : { rowState: surface.rowState }),
    rows,
    // A count is omitted rather than zeroed wherever a per-job breakdown is
    // unavailable: a rendered `0 failing` on a suite nobody could read is a
    // fabricated fact, not a conservative one.
    ...(surface.failingCount === null ? {} : { failingCount: surface.failingCount }),
    ...(surface.runningCount === null ? {} : { runningCount: surface.runningCount }),
    ...(surface.passingCount === null ? {} : { passingCount: surface.passingCount }),
    ...(surface.checkRunsFailure === null
      ? {}
      : { checkRunsFailure: toTriageFailure(surface.checkRunsFailure) }),
    ...(surface.commitStatusFailure === null
      ? {}
      : { commitStatusFailure: toTriageFailure(surface.commitStatusFailure) }),
    omittedRowCount: projected.omittedRowCount + omittedByEnvelope,
    projectionTruncated: projected.projectionTruncated || omittedByEnvelope > 0,
  })).result;
}

/* -------------------------------------------------------------------- reviews */
