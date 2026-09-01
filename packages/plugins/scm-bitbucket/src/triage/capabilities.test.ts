import { describe, expect, it } from 'vitest';

import {
  BITBUCKET_TRIAGE_CAPABILITIES_V1,
  preflightBitbucketMutationCapabilityV1,
  projectBitbucketPullRequestAffordancesV1,
} from './capabilities.js';

describe('Bitbucket private capability projection', () => {
  it('keeps provider-unavailable mutations explicit in one closed record', () => {
    expect(BITBUCKET_TRIAGE_CAPABILITIES_V1.operations).toMatchObject({
      'pull-request/reopen': { state: 'unavailable', code: 'api_not_exposed' },
      'pull-request/label': { state: 'unavailable', code: 'provider_lacks_feature' },
      'pull-request/reviewer-change': { state: 'unavailable', code: 'unsafe_replacement' },
      'issue/comment': { state: 'unavailable', code: 'out_of_scope_removed' },
      'issue/close': { state: 'unavailable', code: 'out_of_scope_removed' },
      'issue/reopen': { state: 'unavailable', code: 'out_of_scope_removed' },
      'issue/assignee-add': { state: 'unavailable', code: 'out_of_scope_removed' },
      'issue/assignee-remove': { state: 'unavailable', code: 'out_of_scope_removed' },
      'issue/label-add': { state: 'unavailable', code: 'out_of_scope_removed' },
      'issue/label-remove': { state: 'unavailable', code: 'out_of_scope_removed' },
    });
  });

  it('projects only callable pull-request affordances for the current provider state', () => {
    expect(projectBitbucketPullRequestAffordancesV1('OPEN')).toEqual({
      merge: true,
      decline: true,
      reopen: false,
      reviewerChange: false,
      labelChange: false,
    });
    expect(projectBitbucketPullRequestAffordancesV1('DECLINED')).toEqual({
      merge: false,
      decline: false,
      reopen: false,
      reviewerChange: false,
      labelChange: false,
    });
  });

  it('preflights callable and unavailable mutations from that same record', () => {
    expect(preflightBitbucketMutationCapabilityV1('pull-request/merge')).toEqual({ ok: true });
    expect(preflightBitbucketMutationCapabilityV1('pull-request/reopen')).toEqual({
      ok: false,
      code: 'api_not_exposed',
    });
  });
});
