import { describe, expect, it } from 'vitest';
import { readGithubPullRequestChecks } from './checks.js';
import { createStubGithubTransport, createTestGithubApiClient, fixedClock } from './testkit/githubTriage.test-support.js';

const sha = 'a'.repeat(40);
// Synthetic response shapes from GitHub GraphQL Checks/Commits documentation,
// consulted 2026-10-02. Only HTTP/Connected Account boundaries are faked.
function page(nodes: readonly unknown[], head = sha, next: string | null = null) {
  return { data: { repository: { pullRequest: { headRefOid: head, commits: { nodes: [{ commit: {
    oid: head, statusCheckRollup: { contexts: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } } },
  } }] } } } } };
}
function check(conclusion: string | null, required = true) {
  return { __typename: 'CheckRun', id: 'check-1', name: 'build', isRequired: required,
    status: conclusion === null ? 'IN_PROGRESS' : 'COMPLETED', conclusion,
    detailsUrl: null, startedAt: null, completedAt: null, checkSuite: { createdAt: '2026-08-10T11:59:59Z' } };
}
async function observe(nodes: readonly unknown[], selection: 'all' | 'required' = 'all', head = sha) {
  const transport = createStubGithubTransport({ respond: (request) => request.url.endsWith('/graphql')
    ? { status: 200, body: page(nodes, head) }
    : { status: 200, body: request.url.includes('/check-runs') ? { total_count: 0, check_runs: [] } : { statuses: [] } } });
  const client = await createTestGithubApiClient(transport);
  const input = { route: { owner: 'octo-org', name: 'example-app' }, headSha: sha,
    observation: { pullRequestNumber: 7, selection } };
  const surface = await readGithubPullRequestChecks(input, { client, now: fixedClock(1000), signal: transport.context.signal });
  return { snapshot: surface.observation, transport };
}

describe('PR checks conditions at the GitHub checks reader', () => {
  it.each([
    ['SUCCESS', 'passed', true, true], ['FAILURE', 'failed', true, false],
    [null, 'pending', false, false], ['CANCELLED', 'neutral', true, false],
  ] as const)('observes %s without confusing completed with passed', async (conclusion, state, complete, passed) => {
    expect((await observe([check(conclusion)])).snapshot).toMatchObject({ headSha: sha, currentHeadSha: sha, selection: 'all', state, complete, passed });
  });
  it('returns explicit none, never vacuous success', async () => {
    expect((await observe([])).snapshot).toMatchObject({ state: 'none', complete: false, passed: false });
  });
  it('uses provider-required evidence for both check runs and legacy statuses', async () => {
    const nodes = [check('FAILURE', false), { __typename: 'StatusContext', id: 'status-1',
      context: 'legacy', state: 'SUCCESS', isRequired: true, targetUrl: null, createdAt: null, updatedAt: null }];
    expect((await observe(nodes, 'required')).snapshot).toMatchObject({ state: 'passed', complete: true, passed: true });
    expect((await observe(nodes, 'all')).snapshot).toMatchObject({ state: 'failed', passed: false });
    expect((await observe([check('SUCCESS', false)], 'required')).snapshot).toMatchObject({ state: 'none', passed: false });
  });
  it('supersedes the chosen head when the PR moves instead of accepting its green checks', async () => {
    expect((await observe([check('SUCCESS')], 'all', 'b'.repeat(40))).snapshot).toMatchObject({
      state: 'superseded', headSha: sha, currentHeadSha: 'b'.repeat(40), complete: false, passed: false,
    });
  });
  it('reads every page and refuses a head change between pages', async () => {
    let count = 0;
    const transport = createStubGithubTransport({ respond: (request) => request.url.endsWith('/graphql')
      ? { status: 200, body: ++count === 1 ? page([check('SUCCESS')], sha, 'next') : page([check('FAILURE')], 'b'.repeat(40)) }
      : { status: 200, body: { statuses: [], check_runs: [] } } });
    const client = await createTestGithubApiClient(transport);
    const input = { route: { owner: 'octo-org', name: 'example-app' }, headSha: sha,
      observation: { pullRequestNumber: 7, selection: 'all' as const } };
    const result = await readGithubPullRequestChecks(input, { client, now: fixedClock(1000), signal: transport.context.signal });
    expect(result.observation).toMatchObject({ state: 'superseded', passed: false });
    expect(count).toBe(2);
  });
  it('carries withheld permission as unknown evidence instead of a green or no-checks observation', async () => {
    const transport = createStubGithubTransport({ respond: () => ({ status: 403, body: { message: 'Resource not accessible' } }) });
    const client = await createTestGithubApiClient(transport);
    const result = await readGithubPullRequestChecks({ route: { owner: 'octo-org', name: 'example-app' }, headSha: sha,
      observation: { pullRequestNumber: 7, selection: 'all' } }, { client, now: fixedClock(1000), signal: transport.context.signal });
    expect(result.observation).toMatchObject({ state: 'unknown', passed: false, failure: { class: 'permission' } });
  });
  it('does not preserve green evidence when the provider transport fails', async () => {
    const transport = createStubGithubTransport({ respond: () => { throw new Error('offline'); } });
    const client = await createTestGithubApiClient(transport);
    const result = await readGithubPullRequestChecks({ route: { owner: 'octo-org', name: 'example-app' }, headSha: sha,
      observation: { pullRequestNumber: 7, selection: 'all' } }, { client, now: fixedClock(1000), signal: transport.context.signal });
    expect(result.observation).toMatchObject({ state: 'unknown', passed: false, failure: { class: 'transient' } });
  });
  it('does not reuse green evidence after an undecodable provider answer', async () => {
    const transport = createStubGithubTransport({ respond: () => ({ status: 200, rawBody: new TextEncoder().encode('{') }) });
    const client = await createTestGithubApiClient(transport);
    const result = await readGithubPullRequestChecks({ route: { owner: 'octo-org', name: 'example-app' }, headSha: sha,
      observation: { pullRequestNumber: 7, selection: 'all' } }, { client, now: fixedClock(1000), signal: transport.context.signal });
    expect(result.observation).toMatchObject({ state: 'unknown', passed: false });
  });
  it('includes later-page failures instead of deciding from a green first page', async () => {
    let count = 0;
    const transport = createStubGithubTransport({ respond: () => ({ status: 200,
      body: ++count === 1 ? page([check('SUCCESS')], sha, 'next')
        : page([{ ...check('FAILURE'), id: 'check-2' }]),
    }) });
    const client = await createTestGithubApiClient(transport);
    const result = await readGithubPullRequestChecks({ route: { owner: 'octo-org', name: 'example-app' }, headSha: sha,
      observation: { pullRequestNumber: 7, selection: 'all' } }, { client, now: fixedClock(1000), signal: transport.context.signal });
    expect(result.observation).toMatchObject({ state: 'failed', passed: false, complete: true });
    expect(count).toBe(2);
  });
});
