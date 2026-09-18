import { readAzureChangeEntryRows, readAzureCollectionRows } from '../decode.js';
import { createAzureDevOpsFailure } from '../failures.js';
import type {
  AzureDevOpsApiClient,
  AzureDevOpsFailure,
  AzureDevOpsRoute,
} from '../types.js';

import {
  AZURE_DETAIL_BOUNDS_V1,
  projectAzureCommitRows,
  projectAzureIterationChanges,
  projectAzureIterationRows,
  projectAzurePolicyEvaluationRows,
  projectAzureStatusRows,
  projectAzureThreadRows,
  type AzureChangesProjectionV1,
  type AzurePageProjectionV1,
  type AzureProjectedCommitRowV1,
  type AzureProjectedIterationRowV1,
  type AzureProjectedPolicyEvaluationRowV1,
  type AzureProjectedStatusRowV1,
  type AzureProjectedThreadRowV1,
} from './projection.js';

/**
 * The bounded reads behind the Azure DevOps detail planes.
 *
 * Two provider facts shape everything here, and neither is shared with the other
 * three forges:
 *
 * - **the iteration list is read ONCE, by the detail root.** Every push to the
 *   source branch produces an iteration, and `Activity` and `Files` both need to
 *   know which one is current. Two readers would answer from two different
 *   snapshots, so there is one read and one projection passed to both;
 * - **paging positions are provider-issued, never computed.** The commits
 *   collection hands back a continuation token in a response header; the
 *   iteration-changes collection hands back `nextSkip` and `nextTop` in the
 *   body. A self-incremented `$skip` is how a caller silently re-reads or skips
 *   files, so this source never computes one.
 *
 * This is also where the strict/tolerant split of `sources/SCM.md` §2.9 is
 * decided: every external response is proved to BE a collection here, through
 * the same envelope owner the scan pages and the publication anchor reads use,
 * before its rows are handed to the tolerant projector. An unrecognized body is
 * an attributed failure, never a healthy, complete, empty plane.
 */

export type AzureDetailReadResultV1<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: AzureDevOpsFailure }>;

export type AzureDetailReadDependenciesV1 = Readonly<{
  client: AzureDevOpsApiClient;
  signal: AbortSignal;
}>;

export const AZURE_CONTINUATION_TOKEN_HEADER_V1 = 'x-ms-continuationtoken';

/** One page of pull-request commits. Azure's own default window for this tab. */
export const AZURE_COMMITS_PAGE_SIZE_V1 = 30;
/** One page of iteration changes. The provider decides every following window. */
export const AZURE_CHANGES_PAGE_SIZE_V1 = 100;
/** One bounded policy-evaluation page. A short page ends the provider walk. */
export const AZURE_POLICY_EVALUATIONS_PAGE_SIZE_V1 = 100;

function malformed(detail: string): AzureDevOpsFailure {
  return createAzureDevOpsFailure({ failureClass: 'malformedResponse', detail });
}

/** The one strict-envelope gate every `{ count, value }` detail read passes through. */
function readCollection(
  body: unknown,
  resource: string,
): AzureDetailReadResultV1<readonly unknown[]> {
  const rows = readAzureCollectionRows(body);
  return rows === null
    ? { ok: false, failure: malformed(`Azure DevOps returned an unusable ${resource} collection.`) }
    : { ok: true, value: rows };
}

async function requestJson(
  dependencies: AzureDetailReadDependenciesV1,
  route: AzureDevOpsRoute,
  query?: Readonly<Record<string, string | number | undefined>>,
): Promise<AzureDetailReadResultV1<Readonly<{
  body: unknown;
  headers: Readonly<Record<string, string>>;
}>>> {
  const response = await dependencies.client.request({
    route,
    ...(query === undefined ? {} : { query }),
    signal: dependencies.signal,
  });
  return response.ok
    ? { ok: true, value: { body: response.body, headers: response.headers } }
    : { ok: false, failure: response.failure };
}

/* ---------------------------------------------------------------- iterations */

export type AzureIterationsReadV1 = Readonly<{
  rows: readonly AzureProjectedIterationRowV1[];
  /**
   * The real 1-based iteration `Files` compares against, or `null` when Azure
   * returned none. `null` is not iteration `0`: `0` is the documented
   * `compareTo` baseline and is never a path id.
   */
  currentIterationId: number | null;
  omittedRowCount: number;
  projectionTruncated: boolean;
}>;

/**
 * The one shared iteration read.
 *
 * It exists exactly once per mounted detail body. `Activity` and `Files` consume
 * its projection rather than reading the list again, so the two tabs can never
 * disagree about which iteration is current.
 */
export async function readAzureIterations(
  input: Readonly<{ project: string; repositoryId: string; pullRequestId: number }>,
  dependencies: AzureDetailReadDependenciesV1,
): Promise<AzureDetailReadResultV1<AzureIterationsReadV1>> {
  const response = await requestJson(dependencies, {
    resource: 'iterations',
    project: input.project,
    repositoryId: input.repositoryId,
    pullRequestId: input.pullRequestId,
  });
  if (!response.ok) return response;
  const collection = readCollection(response.value.body, 'iteration');
  if (!collection.ok) return collection;

  const projected = projectAzureIterationRows(collection.value, AZURE_DETAIL_BOUNDS_V1);
  // The current iteration is the highest real id Azure returned. A pull request
  // whose iteration list is empty has none, and saying so beats guessing `1`.
  const currentIterationId = projected.rows.reduce<number | null>(
    (highest, row) => (highest === null || row.id > highest ? row.id : highest),
    null,
  );
  return {
    ok: true,
    value: Object.freeze({
      rows: projected.rows,
      currentIterationId,
      omittedRowCount: projected.omittedRowCount,
      projectionTruncated: projected.projectionTruncated,
    }),
  };
}

/* ------------------------------------------------------------------- commits */

export type AzureCommitsReadV1 =
  AzurePageProjectionV1<AzureProjectedCommitRowV1> & Readonly<{
    /** Azure's own continuation token, from the response header, or `null`. */
    continuationToken: string | null;
  }>;

export async function readAzureCommitsPage(
  input: Readonly<{
    project: string;
    repositoryId: string;
    pullRequestId: number;
    continuationToken: string | null;
  }>,
  dependencies: AzureDetailReadDependenciesV1,
): Promise<AzureDetailReadResultV1<AzureCommitsReadV1>> {
  const response = await requestJson(
    dependencies,
    {
      resource: 'commits',
      project: input.project,
      repositoryId: input.repositoryId,
      pullRequestId: input.pullRequestId,
    },
    {
      $top: AZURE_COMMITS_PAGE_SIZE_V1,
      ...(input.continuationToken === null
        ? {}
        : { continuationToken: input.continuationToken }),
    },
  );
  if (!response.ok) return response;
  const collection = readCollection(response.value.body, 'commit');
  if (!collection.ok) return collection;

  const projected = projectAzureCommitRows(collection.value, AZURE_DETAIL_BOUNDS_V1);
  const header = response.value.headers[AZURE_CONTINUATION_TOKEN_HEADER_V1];
  const continuationToken = typeof header === 'string' && header.trim() !== ''
    ? header.trim()
    : null;
  return { ok: true, value: Object.freeze({ ...projected, continuationToken }) };
}

/* --------------------------------------------------------- iteration changes */

/**
 * One page of one iteration's changed files.
 *
 * `$compareTo=0` is the documented comparison BASELINE — the state before the
 * first iteration — while `iterationId` is a real 1-based iteration in the path.
 * Passing `0` as the path id asks for a resource that does not exist.
 */
export async function readAzureIterationChangesPage(
  input: Readonly<{
    project: string;
    repositoryId: string;
    pullRequestId: number;
    iterationId: number;
    skip: number;
    top: number;
  }>,
  dependencies: AzureDetailReadDependenciesV1,
): Promise<AzureDetailReadResultV1<AzureChangesProjectionV1>> {
  if (!Number.isSafeInteger(input.iterationId) || input.iterationId < 1) {
    return { ok: false, failure: malformed('An Azure DevOps iteration id must be 1-based.') };
  }
  const response = await requestJson(
    dependencies,
    {
      resource: 'iterationChanges',
      project: input.project,
      repositoryId: input.repositoryId,
      pullRequestId: input.pullRequestId,
      iterationId: input.iterationId,
    },
    { $compareTo: 0, $skip: input.skip, $top: input.top },
  );
  if (!response.ok) return response;
  // The iteration-changes model publishes its rows under `changeEntries`, and its position under
  // `nextSkip`/`nextTop`, so the envelope is proved here while the projector still owns both.
  if (readAzureChangeEntryRows(response.value.body) === null) {
    return {
      ok: false,
      failure: malformed('Azure DevOps returned an unusable iteration-changes collection.'),
    };
  }
  const projected = projectAzureIterationChanges(response.value.body, AZURE_DETAIL_BOUNDS_V1);
  if (projected.continuationMalformed) {
    return {
      ok: false,
      failure: malformed('Azure DevOps returned an incomplete iteration-changes position.'),
    };
  }
  return { ok: true, value: projected };
}

/* ------------------------------------------------------------------ policies */

export type AzurePoliciesReadV1 = Readonly<{
  statuses: readonly AzureProjectedStatusRowV1[];
  evaluations: readonly AzureProjectedPolicyEvaluationRowV1[];
  /**
   * True when the evaluation read failed after the statuses succeeded.
   *
   * Only the evaluation half is marked partial. The statuses are real and stay,
   * and a reader is told which half is short rather than losing both.
   */
  evaluationsPartial: boolean;
  omittedRowCount: number;
  projectionTruncated: boolean;
}>;

/**
 * The whole policy surface of one pull request.
 *
 * Statuses and policy evaluations are separate resources with separate scopes:
 * a status hangs off the Git pull request, while an evaluation is project-scoped
 * and selects the item through an `artifactId`. They are read together because
 * their rendered answer is one section, and because a status is INFORMATIONAL
 * until a returned evaluation's `configuration.isBlocking` establishes
 * enforcement.
 */
export async function readAzurePoliciesSurface(
  input: Readonly<{
    project: string;
    repositoryId: string;
    pullRequestId: number;
    projectId: string;
  }>,
  dependencies: AzureDetailReadDependenciesV1,
): Promise<AzureDetailReadResultV1<AzurePoliciesReadV1>> {
  const statuses = await requestJson(dependencies, {
    resource: 'statuses',
    project: input.project,
    repositoryId: input.repositoryId,
    pullRequestId: input.pullRequestId,
  });
  if (!statuses.ok) return statuses;
  const statusCollection = readCollection(statuses.value.body, 'status');
  if (!statusCollection.ok) return statusCollection;
  const projectedStatuses = projectAzureStatusRows(statusCollection.value, AZURE_DETAIL_BOUNDS_V1);

  const artifactId =
    `vstfs:///CodeReview/CodeReviewId/${input.projectId}/${String(input.pullRequestId)}`;
  const projectedEvaluationRows: AzureProjectedPolicyEvaluationRowV1[] = [];
  const seenEvaluationIds = new Set<string>();
  let evaluationOmissions = 0;
  let evaluationProjectionTruncated = false;
  let skip = 0;
  const surface = (
    evaluationsPartial: boolean,
  ): AzureDetailReadResultV1<AzurePoliciesReadV1> => ({
    ok: true,
    value: Object.freeze({
      statuses: projectedStatuses.rows,
      evaluations: Object.freeze([...projectedEvaluationRows]),
      evaluationsPartial,
      omittedRowCount: projectedStatuses.omittedRowCount + evaluationOmissions,
      projectionTruncated: projectedStatuses.projectionTruncated || evaluationProjectionTruncated,
    }),
  });

  for (;;) {
    const evaluations = await requestJson(
      dependencies,
      { resource: 'policyEvaluations', project: input.project },
      {
        // The documented artifact identifier for a pull request's code review.
        artifactId,
        $top: AZURE_POLICY_EVALUATIONS_PAGE_SIZE_V1,
        $skip: skip,
      },
    );
    if (!evaluations.ok) {
      // A cancellation/deadline invalidates the entire mounted invocation. Retaining the status
      // section is useful only for an ordinary evaluation failure while the panel remains current;
      // otherwise it would publish a stale partial result after navigation or timeout.
      if (dependencies.signal.aborted) {
        return { ok: false, failure: evaluations.failure };
      }
      // The statuses are real evidence and are kept; only the evaluation half is
      // reported short. Failing both would hide policy state the reader can see.
      return surface(true);
    }

    // An unrecognized evaluation envelope is a failed page, not an empty one: it neither proves
    // this pull request has no evaluations nor licenses ending the walk as complete.
    const evaluationRows = readAzureCollectionRows(evaluations.value.body);
    if (evaluationRows === null) return surface(true);

    const projectedPage = projectAzurePolicyEvaluationRows(
      evaluationRows,
      AZURE_DETAIL_BOUNDS_V1,
    );
    let addedRows = 0;
    for (const row of projectedPage.rows) {
      if (seenEvaluationIds.has(row.evaluationId)) continue;
      seenEvaluationIds.add(row.evaluationId);
      projectedEvaluationRows.push(row);
      addedRows += 1;
    }
    evaluationOmissions += projectedPage.omittedRowCount;
    evaluationProjectionTruncated = evaluationProjectionTruncated
      || projectedPage.projectionTruncated;

    // The approved source contract owns one bounded native page and stops on Azure's short-page
    // signal. Issuing an extra empty-page request after a short page spends quota and can turn a
    // complete answer into a false partial failure when the unnecessary request fails.
    if (evaluationRows.length < AZURE_POLICY_EVALUATIONS_PAGE_SIZE_V1) break;
    if (addedRows === 0) {
      // A Server that ignores `$skip` can legally keep returning a successful page. The
      // invocation-local identity set is only a progress witness: it neither persists provider
      // data nor invents a retry count. Retain the rows already proved and report the plane short
      // instead of spinning until the panel deadline and then discarding the whole result.
      return surface(true);
    }
    skip += evaluationRows.length;
  }

  return surface(false);
}

/* ------------------------------------------------------------------- threads */

export type AzureThreadsReadV1 = AzurePageProjectionV1<AzureProjectedThreadRowV1>;

/**
 * Every review thread on one pull request, in one read.
 *
 * The documented list endpoint returns them all and exposes no `$top`, `$skip`,
 * continuation token or next link. Its only optional arguments are the iteration
 * lens, so the reader's 18-thread and 2-reply windows are client-local over this
 * one response — never an invented cursor.
 */
export async function readAzureThreads(
  input: Readonly<{
    project: string;
    repositoryId: string;
    pullRequestId: number;
    /** Both are supplied together or not at all: a lens is a comparison. */
    iterationLens: Readonly<{ iteration: number; baseIteration: number }> | null;
  }>,
  dependencies: AzureDetailReadDependenciesV1,
): Promise<AzureDetailReadResultV1<AzureThreadsReadV1>> {
  const response = await requestJson(
    dependencies,
    {
      resource: 'threads',
      project: input.project,
      repositoryId: input.repositoryId,
      pullRequestId: input.pullRequestId,
    },
    input.iterationLens === null
      ? undefined
      : {
        // The literal `$` matters: dropping it is how every thread comes back
        // unfiltered while the caller believes the lens was applied.
        $iteration: input.iterationLens.iteration,
        $baseIteration: input.iterationLens.baseIteration,
      },
  );
  if (!response.ok) return response;
  const collection = readCollection(response.value.body, 'thread');
  if (!collection.ok) return collection;
  return { ok: true, value: projectAzureThreadRows(collection.value, AZURE_DETAIL_BOUNDS_V1) };
}
