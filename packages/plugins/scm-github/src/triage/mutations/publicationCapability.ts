import type { TriageSourceFailureV1 } from '@happier-dev/triage-protocol/v1';

import { projectGithubRepositoryCapabilities } from '../capabilities.js';
import { GITHUB_ROUTE_BODY_MISMATCH_FAILURE } from '../errors.js';
import type { GithubGetDependenciesV1 } from '../get.js';
import { buildGithubCollisionScope } from '../identity.js';
import type { GithubRepositoryRouteV1 } from '../locator.js';
import { toTriageFailure } from '../mapping/protocol.js';
import { createGithubRepositoryReader } from '../repositories.js';
import type { GithubTriageEntryLocalRefV1 } from '../types.js';

type GithubPublicationOperationV1 =
  | 'pullRequestSubmitReview'
  | 'pullRequestReviewCommentCreate'
  | 'pullRequestThreadReply'
  | 'issueComment';

type GithubPublicationCapabilityPreflightV1 =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; failure: TriageSourceFailureV1 }>;

/**
 * Fresh decisive repository facts immediately before a Reviews dispatch claim.
 *
 * This deliberately does not predict permissions from repository roles. The
 * provider operation remains the permission authority unless GitHub states one
 * of the two decisive repository facts it exposes here: archived repositories
 * deny every write, and `has_issues: false` makes an issue comment unsupported.
 */
export async function preflightGithubPublicationCapability(
  input: Readonly<{
    localRef: GithubTriageEntryLocalRefV1;
    route: GithubRepositoryRouteV1;
    operation: GithubPublicationOperationV1;
  }>,
  dependencies: GithubGetDependenciesV1,
): Promise<GithubPublicationCapabilityPreflightV1> {
  // A fresh reader is intentional. The entity reread may have resolved identity
  // from its response body; it cannot stand in for the required current archive
  // and capability facts immediately before the durable Reviews claim.
  const repository = await createGithubRepositoryReader({
    client: dependencies.client,
    now: dependencies.now,
  }).read(input.route);
  if (repository.kind !== 'readable') {
    return Object.freeze({ ok: false as const, failure: toTriageFailure(repository.failure) });
  }
  if (buildGithubCollisionScope(repository.repositoryId) !== input.localRef.collisionScope) {
    return Object.freeze({
      ok: false as const,
      failure: toTriageFailure(GITHUB_ROUTE_BODY_MISMATCH_FAILURE),
    });
  }

  const availability = projectGithubRepositoryCapabilities(repository).operations[input.operation];
  if (availability.kind === 'available') return Object.freeze({ ok: true as const });
  return Object.freeze({
    ok: false as const,
    failure: availability.code === 'repository_archived'
      ? Object.freeze({ class: 'permission' as const, code: availability.code })
      : Object.freeze({ class: 'unsupportedContract' as const, code: availability.code }),
  });
}
