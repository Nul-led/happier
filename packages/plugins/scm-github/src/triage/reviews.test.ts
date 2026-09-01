import { describe, expect, it } from 'vitest';

import {
  createStubGithubTransport,
  createTestGithubApiClient,
  fixedClock,
} from './testkit/githubTriage.test-support.js';
import {
  readGithubPullRequestReviewPublicationRecords,
} from './reviews.js';

const ROUTE = Object.freeze({ owner: 'octo-org', name: 'example-app' });

describe('GitHub review publication marker reconciliation', () => {
  it('retains a marker with a deleted author and future review state beside malformed rows', async () => {
    const transport = createStubGithubTransport({
      respond: () => ({
        status: 200,
        body: [
          { nope: true },
          {
            id: 991,
            body: 'kept <!-- happier-review-verdict:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA -->',
            user: null,
            state: 'FUTURE_GITHUB_STATE',
          },
        ],
      }),
    });
    const client = await createTestGithubApiClient(transport);
    const read = await readGithubPullRequestReviewPublicationRecords(
      { route: ROUTE, number: '1284' },
      { client, now: fixedClock(1_000), signal: transport.context.signal },
    );
    expect(read.failure).toBeNull();
    expect(read.incomplete).toBe(false);
    expect(read.reviews).toEqual([{
      providerId: '991',
      body: 'kept <!-- happier-review-verdict:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA -->',
    }]);
  });
});
