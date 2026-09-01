import type { BitbucketPullRequestNativeState } from './entries.js';

/** Provider-local capability truth used by Bitbucket affordances and write admission. */
export type BitbucketTriageOperationV1 =
  | 'pull-request/merge'
  | 'pull-request/close'
  | 'pull-request/reopen'
  | 'pull-request/mark-ready'
  | 'pull-request/update-branch'
  | 'pull-request/reviewer-change'
  | 'pull-request/label'
  | 'pull-request/submit-review'
  | 'pull-request/review-comment-create'
  | 'pull-request/thread-reply'
  | 'pull-request/thread-resolution'
  | 'issue/comment'
  | 'issue/close'
  | 'issue/reopen'
  | 'issue/assignee-add'
  | 'issue/assignee-remove'
  | 'issue/label-add'
  | 'issue/label-remove';

export type BitbucketCapabilityUnavailableCodeV1 =
  | 'api_not_exposed'
  | 'provider_lacks_feature'
  | 'unsafe_replacement'
  | 'out_of_scope_removed'
  | 'not_declared';

type BitbucketCapabilityV1 =
  | Readonly<{ state: 'available' }>
  | Readonly<{ state: 'unavailable'; code: BitbucketCapabilityUnavailableCodeV1 }>
  | Readonly<{ state: 'unknown'; code: 'requires_live_characterization' }>;

const AVAILABLE = Object.freeze({ state: 'available' as const });

/**
 * The closed Bitbucket capability record. It stays private to this provider: these outcomes are
 * native REST facts and scoped product decisions, not a source-neutral policy engine.
 */
export const BITBUCKET_TRIAGE_CAPABILITIES_V1 = Object.freeze({
  operations: Object.freeze({
    'pull-request/merge': AVAILABLE,
    'pull-request/close': AVAILABLE,
    'pull-request/reopen': Object.freeze({ state: 'unavailable', code: 'api_not_exposed' }),
    'pull-request/mark-ready': Object.freeze({
      state: 'unknown',
      code: 'requires_live_characterization',
    }),
    'pull-request/update-branch': Object.freeze({ state: 'unavailable', code: 'not_declared' }),
    'pull-request/reviewer-change': Object.freeze({
      state: 'unavailable',
      code: 'unsafe_replacement',
    }),
    'pull-request/label': Object.freeze({
      state: 'unavailable',
      code: 'provider_lacks_feature',
    }),
    'pull-request/submit-review': AVAILABLE,
    'pull-request/review-comment-create': AVAILABLE,
    'pull-request/thread-reply': AVAILABLE,
    'pull-request/thread-resolution': AVAILABLE,
    'issue/comment': Object.freeze({ state: 'unavailable', code: 'out_of_scope_removed' }),
    'issue/close': Object.freeze({ state: 'unavailable', code: 'out_of_scope_removed' }),
    'issue/reopen': Object.freeze({ state: 'unavailable', code: 'out_of_scope_removed' }),
    'issue/assignee-add': Object.freeze({ state: 'unavailable', code: 'out_of_scope_removed' }),
    'issue/assignee-remove': Object.freeze({ state: 'unavailable', code: 'out_of_scope_removed' }),
    'issue/label-add': Object.freeze({ state: 'unavailable', code: 'out_of_scope_removed' }),
    'issue/label-remove': Object.freeze({ state: 'unavailable', code: 'out_of_scope_removed' }),
  } satisfies Readonly<Record<BitbucketTriageOperationV1, BitbucketCapabilityV1>>),
});

export type BitbucketMutationCapabilityPreflightV1 =
  | Readonly<{ ok: true }>
  | Readonly<{
    ok: false;
    code: BitbucketCapabilityUnavailableCodeV1 | 'requires_live_characterization';
  }>;

export function preflightBitbucketMutationCapabilityV1(
  operation: BitbucketTriageOperationV1,
): BitbucketMutationCapabilityPreflightV1 {
  const capability = BITBUCKET_TRIAGE_CAPABILITIES_V1.operations[operation];
  return capability.state === 'available'
    ? Object.freeze({ ok: true as const })
    : Object.freeze({ ok: false as const, code: capability.code });
}

export function projectBitbucketPullRequestAffordancesV1(
  state: BitbucketPullRequestNativeState | null,
): Readonly<{
  merge: boolean;
  decline: boolean;
  reopen: boolean;
  reviewerChange: boolean;
  labelChange: boolean;
}> {
  const open = state === 'OPEN';
  return Object.freeze({
    merge: open && preflightBitbucketMutationCapabilityV1('pull-request/merge').ok,
    decline: open && preflightBitbucketMutationCapabilityV1('pull-request/close').ok,
    reopen: state === 'DECLINED'
      && preflightBitbucketMutationCapabilityV1('pull-request/reopen').ok,
    reviewerChange: open
      && preflightBitbucketMutationCapabilityV1('pull-request/reviewer-change').ok,
    labelChange: open
      && preflightBitbucketMutationCapabilityV1('pull-request/label').ok,
  });
}
